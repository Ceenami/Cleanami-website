import "server-only";
import { notificationWorkflowCutoff } from "@/lib/services/notifications/workflow-settings";

import { db } from "@/db";
import { cleaners, jobs, jobsToCleaners, swapRequests } from "@/db/schemas";
import { and, eq, inArray, sql } from "drizzle-orm";
import { notifyCleaner } from "@/lib/services/notifications/notify";
import { notifyAdmins } from "@/lib/queries/admin-notifications";
import { sendTransactionalEmail } from "@/lib/services/email.service";
import { getAppBaseUrl } from "@/lib/app-url";
import { recalculateJobRolesInTransaction } from "./team-roles";
import { buildCandidates } from "./candidates.service";
import { pairQualifiedBackups } from "./offer-policy";
import { lifecycleEnrollmentEnabled, lifecycleSchemaReady } from "./lifecycle-settings";
import { readLifecycle } from "./lifecycle-read.service";
import type { LifecycleAction, Reconfirmation } from "./lifecycle-policy";
import { respondToPriorityOffer } from "./priority-transitions";
import { prioritySchemaReady } from "./priority-settings";
import { dispatchPriorityNotices } from "./priority-notices.service";
import { assignmentExceptionsEnrollment, ASSIGNMENT_AUTOMATION_POLICY } from "./exception-settings";
import { readPriorityMoveApprovals, type PriorityMoveApproval } from "./priority-approvals";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const offerSchemaReady = () => process.env.ASSIGNMENT_OFFERS_SCHEMA_READY === "true";
export const offerEnrollmentEnabled = () => offerSchemaReady() && process.env.ASSIGNMENT_OFFERS_ENROLLMENT === "true";
export function queryRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}
export type AssignmentOffer = {
  id: string; version: number; job_id: string; cleaner_id: string;
  role: "primary" | "laundry_lead" | "backup";
  paired_worker_id: string | null; replaces_cleaner_id: string | null;
  swap_request_id: string | null;
  schedule_version: number; state: "pending" | "accepted" | "declined" | "revoked";
  offered_at: string; responded_at: string | null; revoked_at: string | null;
  reason: string | null; dispatch_state: string;
  response_due_at?: string | null; response_reminder_at?: string | null; deadline_gate?: string | null;
};
export class OfferConflict extends Error {}
export type OfferCoverage = { offers: AssignmentOffer[]; events: unknown[]; names: Record<string, string>; issues: string[]; complete: boolean; label: string; reconfirmations: Reconfirmation[]; actions: LifecycleAction[]; lifecycleWarnings: string[] };

export async function isOfferJob(jobId: string, tx: Tx | typeof db = db) {
  if (!offerSchemaReady()) return false;
  return queryRows(await tx.execute(sql`select job_id from phase3a_offer_jobs where job_id=${jobId}::uuid`)).length > 0;
}
export async function enrollOfferJob(tx: Tx, jobId: string) {
  if (!offerEnrollmentEnabled()) return false;
  // Called by the engine while holding the job lock, before new memberships.
  if (assignmentExceptionsEnrollment() && lifecycleEnrollmentEnabled()) await tx.execute(sql`insert into phase3a_offer_jobs(job_id,lifecycle_enabled,automation_policy) values(${jobId}::uuid,true,${ASSIGNMENT_AUTOMATION_POLICY}) on conflict do nothing`);
  else if (lifecycleEnrollmentEnabled()) await tx.execute(sql`insert into phase3a_offer_jobs(job_id,lifecycle_enabled) values(${jobId}::uuid,true) on conflict do nothing`);
  else await tx.execute(sql`insert into phase3a_offer_jobs(job_id) values(${jobId}::uuid) on conflict do nothing`);
  return true;
}
export async function createBackupOffer(tx: Tx, jobId: string, cleanerId: string, workerId: string) {
  const [worker] = await tx.select({ role: jobsToCleaners.role }).from(jobsToCleaners)
    .where(and(eq(jobsToCleaners.jobId, jobId), eq(jobsToCleaners.cleanerId, workerId)));
  if (!worker) throw new OfferConflict("Working assignment changed");
  await tx.execute(sql`select phase3a_assert_candidate(${jobId}::uuid,${cleanerId}::uuid,${workerId}::uuid,${worker.role}::text)`);
  await tx.execute(sql`insert into phase3a_assignment_offers(job_id,cleaner_id,role,paired_worker_id,schedule_version)
    select job_id,${cleanerId}::uuid,'backup',${workerId}::uuid,schedule_version from phase3a_offer_jobs where job_id=${jobId}::uuid`);
}

/** Eligibility is re-evaluated, so an old acceptance cannot disguise lost qualification. */
export function readOfferCoverage(jobId: string): Promise<OfferCoverage | null>;
export function readOfferCoverage(jobId: string, cleanerId: string): Promise<{ offers: AssignmentOffer[]; reconfirmations: Reconfirmation[]; priorityMoves: PriorityMoveApproval[]; priorityWaiting: boolean } | null>;
export async function readOfferCoverage(jobId: string, cleanerId?: string) {
  if (!(await isOfferJob(jobId))) return null;
  const offers = queryRows<AssignmentOffer>(await db.execute(sql`select * from phase3a_assignment_offers where job_id=${jobId}::uuid order by version desc`));
  const lifecycle = await readLifecycle(jobId, cleanerId);
  if (cleanerId) {
    const priorityMoves = await readPriorityMoveApprovals(jobId,cleanerId);
    const priorityWaiting = prioritySchemaReady() && queryRows(await db.execute(sql`select p.id from phase3a_priority_plans p join phase3a_assignment_offers o on o.id=p.replacement_offer_id where p.donor_job_id=${jobId}::uuid and o.cleaner_id=${cleanerId}::uuid and o.state='accepted' and p.state='pending'`)).length > 0;
    return { offers: offers.filter(o => o.cleaner_id === cleanerId), reconfirmations: lifecycle.reconfirmations, priorityMoves, priorityWaiting };
  }
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId), with: { cleaners: true } });
  if (!job) throw new OfferConflict("Job no longer exists");
  const ids = [...new Set(offers.map(o => o.cleaner_id))];
  const profiles = ids.length ? await db.select({ id: cleaners.id, name: cleaners.fullName }).from(cleaners).where(inArray(cleaners.id, ids)) : [];
  const names = Object.fromEntries(profiles.map(p => [p.id, p.name]));
  const current = offers.filter(o => o.state !== "revoked");
  const workers = job.cleaners.filter(a => ["primary", "laundry_lead"].includes(a.role));
  const issues: string[] = [];
  const lifecycleWarnings: string[] = [];
  if (prioritySchemaReady()) {
    const plans = queryRows<{ state: string }>(await db.execute(sql`select state from phase3a_priority_plans where target_job_id=${jobId}::uuid and state='pending'`));
    if (plans.length) {
      if (job.status === "assigned" && workers.length) lifecycleWarnings.push("Property priority move pending; current working coverage retained");
      else issues.push("Property priority replacement pending; donor working assignment retained");
    }
  }
  for (const offer of offers) {
    if (offer.reason === "response_deadline_expired" && job.cleaners.some(x => x.cleanerId === offer.cleaner_id && x.role === offer.role) && !current.some(x => x.cleaner_id === offer.cleaner_id && x.version > offer.version)) lifecycleWarnings.push(`Assignment response expired: ${names[offer.cleaner_id] ?? "Cleaner"}`);
  }
  for (const offer of current) {
    const name = names[offer.cleaner_id] ?? "Cleaner";
    if (offer.state === "pending" && offer.response_due_at && +new Date(offer.response_due_at) <= Date.now()) lifecycleWarnings.push(`Assignment response overdue: ${name}`);
    if (offer.state === "pending" && offer.deadline_gate) lifecycleWarnings.push(`Offer timing requires admin review: ${name}`);
  }
  for (const reconfirmation of lifecycle.reconfirmations) {
    const offer = current.find(o => o.id === reconfirmation.offer_id);
    if (!offer || offer.state !== "accepted") continue;
    const name = names[offer.cleaner_id] ?? "Cleaner";
    if (reconfirmation.state === "cannot_fulfill") issues.push(`Cleaner cannot fulfil reconfirmed duty: ${name}`);
    else if (reconfirmation.state === "pending" && +new Date(reconfirmation.escalate_at) <= Date.now()) lifecycleWarnings.push(`Reconfirmation overdue at T-12: ${name}`);
  }
  if (lifecycle.actions.some(a => ["failed", "claimed"].includes(a.dispatch_state))) lifecycleWarnings.push("Assignment reminder or escalation dispatch needs review");
  for (const action of lifecycle.actions) {
    const offer = current.find(o => o.id === action.offer_id && o.state === "accepted");
    if (offer && action.kind === "reconfirmation_policy_review") lifecycleWarnings.push(`Reconfirmation timing requires admin review: ${names[offer.cleaner_id] ?? "Cleaner"}`);
  }
  if (job.addonsSnapshot?.requiresManualStaffing || job.addonsSnapshot?.teamSize === null || workers.length !== (job.addonsSnapshot?.teamSize ?? 1)) issues.push("Working team incomplete");
  for (const worker of workers) {
    if (!current.some(o => o.cleaner_id === worker.cleanerId && o.role === worker.role && o.state === "accepted")) issues.push(`Working confirmation missing: ${names[worker.cleanerId] ?? "Cleaner"}`);
    const backup = current.find(o => o.role === "backup" && o.paired_worker_id === worker.cleanerId && o.state === "accepted");
    if (!backup) issues.push(`Confirmed backup missing: ${names[worker.cleanerId] ?? "Cleaner"}`);
    if (["assigned", "unassigned"].includes(job.status ?? "")) {
      for (const candidate of [worker.cleanerId, ...(backup ? [backup.cleaner_id] : [])]) {
        try {
          await db.execute(sql`select phase3a_assert_candidate(${jobId}::uuid,${candidate}::uuid,${worker.cleanerId}::uuid,${worker.role}::text)`);
        } catch { issues.push(`Qualification or availability needs review: ${names[candidate] ?? "Cleaner"}`); }
      }
    }
  }
  const events = queryRows(await db.execute(sql`select e.* from phase3a_offer_events e join phase3a_assignment_offers o on o.id=e.offer_id where o.job_id=${jobId}::uuid order by e.id desc limit 200`));
  return { offers, events, names, issues, complete: issues.length === 0, label: issues.length ? "Coverage Incomplete" : "Coverage Complete", ...lifecycle, lifecycleWarnings };
}

/** A role change is an offer, with the current worker retained until explicit acceptance. */
export async function offerPairedPromotion(jobId: string, workerId: string, actorId: string, swapRequestId?: string) {
  const offer = await db.transaction(tx => offerPairedPromotionInTransaction(tx, jobId, workerId, actorId, swapRequestId));
  await dispatchJobOffers(jobId);
  return offer;
}

/** Caller owns the transaction; no provider work here. M5 uses a savepoint on guard failure. */
export async function offerPairedPromotionInTransaction(tx: Tx, jobId: string, workerId: string, actorId: string, swapRequestId?: string) {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!job || !(await isOfferJob(jobId, tx))) throw new OfferConflict("Offer workflow unavailable");
    await tx.execute(sql`select set_config('cleannami.assignment_actor',${actorId},true)`);
    const [existing] = queryRows<AssignmentOffer>(await tx.execute(sql`select * from phase3a_assignment_offers where job_id=${jobId}::uuid and replaces_cleaner_id=${workerId}::uuid and state='pending'`));
    if (existing) return existing;
    const [backup] = queryRows<AssignmentOffer>(await tx.execute(sql`select * from phase3a_assignment_offers where job_id=${jobId}::uuid and paired_worker_id=${workerId}::uuid and role='backup' and state='accepted' for update`));
    const [worker] = await tx.select().from(jobsToCleaners).where(and(eq(jobsToCleaners.jobId, jobId), eq(jobsToCleaners.cleanerId, workerId)));
    if (!backup || !worker) throw new OfferConflict("No confirmed paired backup; admin coverage review required");
    await tx.execute(sql`select phase3a_assert_candidate(${jobId}::uuid,${backup.cleaner_id}::uuid,${workerId}::uuid,${worker.role}::text)`);
    await tx.execute(sql`update phase3a_assignment_offers set state='revoked',revoked_at=now(),reason='working_role_offered' where id=${backup.id}::uuid`);
    return queryRows<AssignmentOffer>(await tx.execute(sql`insert into phase3a_assignment_offers(job_id,cleaner_id,role,replaces_cleaner_id,schedule_version,swap_request_id)
      values(${jobId}::uuid,${backup.cleaner_id}::uuid,${worker.role},${workerId}::uuid,${backup.schedule_version},${swapRequestId ?? null}::uuid) returning *`))[0];
}

export async function respondToOffer(input: { jobId: string; cleanerId: string; offerId: string; version: number; scheduleVersion: number; role: string; response: "accepted" | "declined" }) {
  const priority = await respondToPriorityOffer(input);
  if (priority) {
    for (const jobId of [priority.plan.donor_job_id, priority.plan.target_job_id]) {
      try { await repairPairedBackups(jobId); } catch (error) { console.error("[priority] backup search needs review", error); }
      await dispatchJobOffers(jobId);
    }
    await dispatchPriorityNotices();
    if (!priority.offer) throw new OfferConflict("Priority move stopped because coverage or job details changed. Existing donor working coverage was retained.");
    return priority.offer;
  }
  const result = await db.transaction(async tx => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, input.jobId)).for("update");
    if (!job || !(await isOfferJob(input.jobId, tx))) throw new OfferConflict("Offer unavailable");
    const [offer] = queryRows<AssignmentOffer>(await tx.execute(sql`select o.* from phase3a_assignment_offers o join phase3a_offer_jobs j on j.job_id=o.job_id and j.schedule_version=o.schedule_version
      where o.id=${input.offerId}::uuid and o.job_id=${input.jobId}::uuid and o.cleaner_id=${input.cleanerId}::uuid and o.version=${input.version} and o.schedule_version=${input.scheduleVersion} and o.role=${input.role} for update of o`));
    if (!offer || offer.state === "revoked") throw new OfferConflict("This offer changed. Refresh before responding.");
    if (offer.state === input.response) return offer; // Same exact request is idempotent.
    if (offer.state !== "pending") throw new OfferConflict("A response is already recorded for this version");
    if (offer.swap_request_id) {
      const [swap] = await tx.select().from(swapRequests).where(eq(swapRequests.id, offer.swap_request_id)).for("update");
      if (!swap || swap.jobId !== input.jobId || swap.originalCleanerId !== offer.replaces_cleaner_id || swap.status !== "pending" || +swap.expiresAt <= Date.now()) throw new OfferConflict("The swap changed or expired");
    }
    await tx.execute(sql`select set_config('cleannami.assignment_actor',${input.cleanerId},true)`);
    // Even a decline must be for a current, unstarted assignment.
    if (!["assigned", "unassigned"].includes(job.status ?? "")) throw new OfferConflict("Job is no longer open for responses");
    const member = await tx.query.jobsToCleaners.findFirst({ where: and(eq(jobsToCleaners.jobId, input.jobId), eq(jobsToCleaners.cleanerId, input.cleanerId)) });
    if (!member || (!offer.replaces_cleaner_id && member.role !== offer.role) || (offer.replaces_cleaner_id && member.role !== "backup")) throw new OfferConflict("Assignment changed");
    if (input.response === "accepted") await tx.execute(sql`select phase3a_assert_candidate(${input.jobId}::uuid,${input.cleanerId}::uuid,${offer.paired_worker_id ?? offer.replaces_cleaner_id}::uuid,${offer.role === "backup" ? "primary" : offer.role}::text)`);
    const [updated] = queryRows<AssignmentOffer>(await tx.execute(sql`update phase3a_assignment_offers set state=${input.response},responded_at=now() where id=${offer.id}::uuid returning *`));
    if (input.response === "accepted" && offer.replaces_cleaner_id) {
      const [original] = await tx.select().from(jobsToCleaners).where(and(eq(jobsToCleaners.jobId, input.jobId), eq(jobsToCleaners.cleanerId, offer.replaces_cleaner_id)));
      if (!original || original.role !== offer.role) throw new OfferConflict("Working slot changed");
      await tx.execute(sql`select set_config('cleannami.accepting_offer',${offer.id},true)`);
      await tx.execute(sql`select set_config('cleannami.assignment_source','phase3a_accepted_promotion',true)`);
      await tx.delete(jobsToCleaners).where(and(eq(jobsToCleaners.jobId, input.jobId), eq(jobsToCleaners.cleanerId, offer.replaces_cleaner_id)));
      // Existing DB guards issue the replacement's own frozen pay; never copy the former worker's rate.
      if (offer.role === "backup") throw new OfferConflict("Invalid promotion role");
      await tx.update(jobsToCleaners).set({ role: offer.role, urgentBonus: !!job.checkInTime && +job.checkInTime - Date.now() <= 24 * 3600000, updatedAt: new Date() }).where(and(eq(jobsToCleaners.jobId, input.jobId), eq(jobsToCleaners.cleanerId, input.cleanerId)));
      // The replacement is now an ordinary accepted working membership.
      // replaces_cleaner_id remains immutable history; coverage/arrival match current membership.
      await recalculateJobRolesInTransaction(tx, input.jobId);
      if (offer.swap_request_id) await tx.update(swapRequests).set({ status: "accepted", replacementCleanerId: input.cleanerId, updatedAt: new Date() }).where(eq(swapRequests.id, offer.swap_request_id));
    }
    return updated;
  });
  if (result.state === "accepted" && result.replaces_cleaner_id) {
    try { await repairPairedBackups(input.jobId); } catch (error) { console.error("[offers] replacement backup search failed", error); }
    const claimed = queryRows(await db.execute(sql`insert into phase3a_coverage_alerts(job_id,identity) values(${input.jobId}::uuid,${`released:${result.id}`}) on conflict do nothing returning job_id`));
    if (claimed.length && !notificationWorkflowCutoff()) {
      try { await notifyCleaner({ cleanerId: result.replaces_cleaner_id, type: "assignment", title: "Working replacement confirmed", message: "Your replacement accepted the working role. You are no longer assigned to this job.", jobId: input.jobId, url: "/cleaner/jobs" }); } catch (error) { console.error("[offers] release notification failed", error); }
    }
  } else if (result.state === "declined" && result.role !== "backup") {
    try { await offerPairedPromotion(input.jobId, input.cleanerId, input.cleanerId); } catch { /* Alert remaining coverage without removing the reserved worker. */ }
  } else if (result.state === "accepted" && result.role === "backup" && result.paired_worker_id) {
    const declined = queryRows(await db.execute(sql`select old.id from phase3a_assignment_offers old
      where old.job_id=${input.jobId}::uuid and old.cleaner_id=${result.paired_worker_id}::uuid and old.schedule_version=${result.schedule_version}
      and (old.state='declined' or old.reason in ('replacement_requested','response_deadline_expired'))
      and not exists(select 1 from phase3a_assignment_offers newer where newer.job_id=old.job_id and newer.cleaner_id=old.cleaner_id and newer.version>old.version and newer.role in ('primary','laundry_lead') and newer.state in ('pending','accepted'))`));
    if (declined.length) try { await offerPairedPromotion(input.jobId, result.paired_worker_id, input.cleanerId); } catch { /* Retain incomplete coverage for review. */ }
  }
  if (result.state === "declined") {
    try { await repairPairedBackups(input.jobId); } catch (error) { console.error("[offers] backup search failed", error); }
  }
  await dispatchJobOffers(input.jobId);
  return result;
}

/** No uncertain-send replay. The existing adapters retain per-channel attempt outcomes. */
export async function dispatchJobOffers(jobId: string) {
  if (!(await isOfferJob(jobId))) return;
  const [revision] = queryRows<{ change_version: number }>(await db.execute(sql`select change_version from phase3a_offer_jobs where job_id=${jobId}::uuid`));
  const offers = queryRows<AssignmentOffer>(await db.execute(sql`update phase3a_assignment_offers set dispatch_state='claimed',dispatch_at=now()
    where job_id=${jobId}::uuid and state='pending' and dispatch_state='pending' returning *`));
  for (const offer of offers) {
    const active = queryRows(await db.execute(sql`select o.id from phase3a_assignment_offers o join jobs j on j.id=o.job_id where o.id=${offer.id}::uuid and o.state='pending' and j.status::text in ('assigned','unassigned') ${lifecycleSchemaReady() ? sql`and (o.response_due_at is null or o.response_due_at>clock_timestamp())` : sql``}`));
    if (!active.length) continue;
    const url = `/cleaner/jobs/${jobId}?offerId=${offer.id}&version=${offer.version}&role=${offer.role}`;
    const backup = offer.role === "backup";
    const timing = offer.response_due_at ? ` Respond by ${new Date(offer.response_due_at).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}.` : "";
    let failed = false;
    try { await notifyCleaner({ cleanerId: offer.cleaner_id, type: "assignment", title: backup ? "Confirm backup duty" : "Confirm working assignment", message: (backup ? "Please confirm or decline your designated standby role. Standby is unpaid unless you accept a working role." : "Please confirm or select Cannot Fulfill for this assignment.") + timing, jobId, url, sms: true, metadata: { offerId: offer.id, version: String(offer.version) } }); }
    catch { failed = true; }
    try {
      const cleaner = await db.query.cleaners.findFirst({ where: eq(cleaners.id, offer.cleaner_id) });
      if (cleaner?.email) {
        const result = await sendTransactionalEmail(cleaner.email, backup ? "Confirm backup duty" : "Confirm working assignment", {
          previewText: "Please review and respond to your CleanNami assignment offer.",
          heading: backup ? "Confirm backup duty" : "Confirm working assignment", greeting: `Hi ${cleaner.fullName},`,
          bodyLines: [(backup ? "You have been offered unpaid standby duty for a designated working cleaner. Please confirm or decline in your portal." : "Please review the current job schedule and confirm or select Cannot Fulfill in your portal.") + timing],
          ctaLabel: "Review assignment", ctaUrl: `${getAppBaseUrl()}${url}`,
        }, { trigger: "assignment_offer", jobId });
        if (!result.success) failed = true;
      } else failed = true;
    } catch { failed = true; }
    await db.execute(sql`update phase3a_assignment_offers set dispatch_state=${failed ? "failed" : "sent"} where id=${offer.id}::uuid and dispatch_state='claimed'`);
  }
  if (lifecycleSchemaReady()) await dispatchImmediateAwareness(jobId);
  // One alert identity per response/schedule/assignment state, retained durably.
  await alertIncompleteCoverage(jobId);
  await db.execute(sql`update phase3a_offer_jobs set needs_dispatch=false where job_id=${jobId}::uuid and change_version=${revision.change_version}`);
}

/** Short-notice awareness is attempted with initial dispatch rather than waiting for cron. */
async function dispatchImmediateAwareness(jobId: string) {
  const claimed = queryRows<{ id: string }>(await db.execute(sql`
    update phase3a_lifecycle_actions a set dispatch_state='claimed',claimed_at=clock_timestamp()
    where a.dispatch_state='pending' and a.kind in ('immediate_admin','deadline_policy_review') and exists(
      select 1 from phase3a_assignment_offers o join phase3a_offer_jobs j on j.job_id=o.job_id and j.schedule_version=o.schedule_version
      join jobs job on job.id=o.job_id join jobs_to_cleaners x on x.job_id=o.job_id and x.cleaner_id=o.cleaner_id
      where o.id=a.offer_id and o.job_id=${jobId}::uuid and o.state in ('pending','accepted')
      and job.status::text in ('assigned','unassigned') and job.check_in_time<o.offered_at+interval '24 hours'
      and not exists(select 1 from evidence_packets e where e.job_id=o.job_id and e.gps_check_in_timestamp is not null)) returning a.id`));
  for (const action of claimed) {
    let failed = false;
    try {
      failed = !(await notifyAdmins({ type: "assignment", title: "Short-notice assignment under 24 hours", message: "An assignment was created less than 24 hours before the clean. Review current responses, any timing decisions and coverage in job oversight.", jobId, url: `/admin/job-oversight/${jobId}`, email: true, eventIdentity: `assignment-lifecycle:${action.id}` }));
    } catch { failed = true; }
    await db.execute(sql`update phase3a_lifecycle_actions set dispatch_state=${failed ? "failed" : "sent"} where id=${action.id}::uuid and dispatch_state='claimed'`);
  }
}

async function alertIncompleteCoverage(jobId: string) {
  const coverage = await readOfferCoverage(jobId);
  if (!coverage || !("complete" in coverage) || coverage.complete) return;
  const identity = coverage.offers.map(o => `${o.version}:${o.state}`).join(",");
  const claimed = queryRows(await db.execute(sql`insert into phase3a_coverage_alerts(job_id,identity) values(${jobId}::uuid,${identity}) on conflict do nothing returning job_id`));
  if (claimed.length) await notifyAdmins({ type: "assignment", title: "Coverage Incomplete", message: "Working or paired backup coverage needs review. See assignment responses and delivery outcomes.", jobId, url: `/admin/job-oversight/${jobId}`, email: true, eventIdentity: `coverage:${jobId}:${identity}` });
}

export async function dispatchPendingOffers() {
  if (!offerSchemaReady()) return;
  const pending = queryRows<{ job_id: string }>(await db.execute(sql`select job_id from phase3a_offer_jobs where needs_dispatch=true order by created_at limit 50`));
  for (const job of pending) await dispatchJobOffers(job.job_id);
}

/** Reuses ranked roster -> on-call -> open-pool candidates; never displaces a worker. */
export async function repairPairedBackups(jobId: string) {
  if (!(await isOfferJob(jobId))) return;
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId), with: { cleaners: { with: { cleaner: true } } } });
  if (!job?.propertyId) throw new OfferConflict("Missing property");
  const current = queryRows<AssignmentOffer>(await db.execute(sql`select * from phase3a_assignment_offers where job_id=${jobId}::uuid and state<>'revoked'`));
  // A stopped discretionary move does not blacklist its willing standby cleaner.
  // Reoffer standby explicitly; an actual decline remains excluded.
  const unavailable = queryRows<{ cleaner_id: string }>(await db.execute(sql`select distinct o.cleaner_id from phase3a_assignment_offers o join phase3a_offer_jobs j on j.job_id=o.job_id and j.schedule_version=o.schedule_version where o.job_id=${jobId}::uuid and ((o.role<>'backup' and o.reason is distinct from 'priority_plan_closed') or o.reason='response_deadline_expired' or exists(select 1 from phase3a_offer_events e where e.offer_id=o.id and e.kind='declined'))`));
  const workers = job.cleaners.filter(a => ["primary", "laundry_lead"].includes(a.role) && !current.some(o => o.paired_worker_id === a.cleanerId && o.state !== "declined"));
  const candidates = (await buildCandidates(job.propertyId)).filter(c => !unavailable.some(o => o.cleaner_id === c.cleanerId) && !job.cleaners.some(a => a.cleanerId === c.cleanerId && a.role !== "backup") && !current.some(o => o.cleaner_id === c.cleanerId));
  const validPairs = new Set<string>();
  for (const worker of workers) for (const candidate of candidates) {
    try { await db.execute(sql`select phase3a_assert_candidate(${jobId}::uuid,${candidate.cleanerId}::uuid,${worker.cleanerId}::uuid,${worker.role}::text)`); validPairs.add(`${worker.cleanerId}:${candidate.cleanerId}`); } catch { /* A shortage remains visible to admin. */ }
  }
  const pairs = pairQualifiedBackups(workers.map(w => ({ cleanerId: w.cleanerId, role: w.role })), candidates.map(c => ({ ...c, role: "backup" as const })), (b, w) => validPairs.has(`${w.cleanerId}:${b.cleanerId}`));
  await db.transaction(async tx => {
    await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).for("update");
    for (const { worker, backup } of pairs) {
      await tx.execute(sql`update phase3a_assignment_offers set state='revoked',revoked_at=now(),reason='backup_reoffered' where job_id=${jobId}::uuid and cleaner_id=${backup.cleanerId}::uuid and state='declined'`);
      await tx.insert(jobsToCleaners).values({ jobId, cleanerId: backup.cleanerId, role: "backup" }).onConflictDoNothing();
      await createBackupOffer(tx, jobId, backup.cleanerId, worker.cleanerId);
    }
  });
}
