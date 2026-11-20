import "server-only";

import { db } from "@/db";
import { cleaners, jobs, jobsToCleaners } from "@/db/schemas";
import { and, eq, sql } from "drizzle-orm";
import { getAppBaseUrl } from "@/lib/app-url";
import { notifyCleaner } from "@/lib/services/notifications/notify";
import { notifyAdmins } from "@/lib/queries/admin-notifications";
import { sendTransactionalEmail } from "@/lib/services/email.service";
import { lifecycleSchemaReady } from "./lifecycle-settings";
import type { LifecycleAction, Reconfirmation } from "./lifecycle-policy";
import { type AssignmentOffer, OfferConflict, offerPairedPromotionInTransaction, queryRows, repairPairedBackups } from "./offers.service";
import { assignmentExceptionsReady, ASSIGNMENT_AUTOMATION_POLICY } from "./exception-settings";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const HOUR = 3_600_000;

async function enqueue(tx: Tx, offerId: string, kind: string, now: Date, details = {}, reconfirmationId: string | null = null) {
  await tx.execute(sql`insert into phase3a_lifecycle_actions(offer_id,kind,occurred_at,details,reconfirmation_id)
    values(${offerId}::uuid,${kind},${now.toISOString()}::timestamptz,${JSON.stringify(details)}::jsonb,${reconfirmationId}::uuid)
    on conflict(offer_id,kind) do nothing`);
}

/** Expiry and its escalation intent commit together. No memberships/pay are removed by a timer. */
async function processJob(jobId: string, now: Date) {
  return db.transaction(async tx => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!job?.checkInTime || !["assigned", "unassigned"].includes(job.status ?? "")) return false;
    if (queryRows(await tx.execute(sql`select id from evidence_packets where job_id=${jobId}::uuid and gps_check_in_timestamp is not null`)).length) return false;
    await tx.execute(sql`select set_config('cleannami.assignment_actor','assignment-lifecycle-worker',true)`);
    const completePolicy = assignmentExceptionsReady() && queryRows(await tx.execute(sql`select job_id from phase3a_offer_jobs where job_id=${jobId}::uuid and automation_policy=${ASSIGNMENT_AUTOMATION_POLICY}`)).length > 0;
    const pending = queryRows<AssignmentOffer>(await tx.execute(sql`
      select o.* from phase3a_assignment_offers o join phase3a_offer_jobs j on j.job_id=o.job_id and j.schedule_version=o.schedule_version
      join jobs_to_cleaners x on x.job_id=o.job_id and x.cleaner_id=o.cleaner_id and (x.role::text=o.role or (o.replaces_cleaner_id is not null and x.role::text='backup'))
      where o.job_id=${jobId}::uuid and j.lifecycle_enabled and o.state='pending' and o.response_due_at is not null order by o.version`));
    let expired = false;
    for (const offer of pending) {
      if (+new Date(offer.response_due_at!) <= +now) {
        await tx.execute(sql`update phase3a_assignment_offers set state='revoked',revoked_at=${now.toISOString()}::timestamptz,reason='response_deadline_expired' where id=${offer.id}::uuid and state='pending'`);
        let promotionOfferId: string | null = null;
        try {
          if (+job.checkInTime <= +now || offer.role === "backup" || offer.replaces_cleaner_id) throw new OfferConflict("No automatic promotion for expired standby/proposal or past start");
          // A SQL eligibility failure rolls back only this savepoint, preserving the miss and alert.
          promotionOfferId = await tx.transaction(async savepoint =>
            (await offerPairedPromotionInTransaction(savepoint, jobId, offer.cleaner_id, "assignment-lifecycle-worker")).id);
        } catch { /* A guard refusal is an uncovered slot, never a reason to lose the expiry audit. */ }
        if (completePolicy && (offer.role === "backup" || offer.replaces_cleaner_id)) {
          // Retire unpaid standby only. An accepted working membership is never
          // removed for missed reconfirmation or an expired replacement proposal.
          await tx.delete(jobsToCleaners).where(and(eq(jobsToCleaners.jobId, jobId), eq(jobsToCleaners.cleanerId, offer.cleaner_id), eq(jobsToCleaners.role, "backup")));
        }
        await enqueue(tx, offer.id, "offer_expired", now, { promotionOfferId, coverage: promotionOfferId ? "working_offer_pending" : +job.checkInTime <= +now ? "past_start_admin_review" : "no_confirmed_eligible_backup" });
        expired = true;
      } else if (offer.response_reminder_at && +new Date(offer.response_reminder_at) <= +now) {
        await enqueue(tx, offer.id, "initial_reminder", now);
      }
    }

    if (+job.checkInTime <= +now) return expired;

    // Re-read after promotion intents: revoked standby offers must not receive reconfirmation.
    const accepted = queryRows<AssignmentOffer>(await tx.execute(sql`
      select o.* from phase3a_assignment_offers o join phase3a_offer_jobs j on j.job_id=o.job_id and j.schedule_version=o.schedule_version
      join jobs_to_cleaners x on x.job_id=o.job_id and x.cleaner_id=o.cleaner_id and x.role::text=o.role
      where o.job_id=${jobId}::uuid and j.lifecycle_enabled and o.state='accepted' order by o.version`));
    const requestDue = +job.checkInTime - 24 * HOUR;
    const escalationDue = +job.checkInTime - 12 * HOUR;
    if (+now >= requestDue) for (const offer of accepted) {
      if (offer.role !== "backup" && +now >= +job.checkInTime - HOUR) {
        await enqueue(tx, offer.id, "eta_prompt", now);
      }
      if (!completePolicy && (offer.schedule_version !== 1 || offer.replaces_cleaner_id || !offer.responded_at || +new Date(offer.responded_at) > requestDue)) {
        await enqueue(tx, offer.id, "reconfirmation_policy_review", now, { reason: "rescheduled_promoted_or_inside_24h_confirmation" });
        continue;
      }
      if (completePolicy && offer.responded_at && +new Date(offer.responded_at) >= requestDue) {
        // Fresh acceptance already confirms this exact role/schedule inside T-24.
        // Reuse response audit and skip obsolete request/reminder/escalation.
        const acceptedAt = new Date(offer.responded_at);
        await tx.execute(sql`insert into phase3a_reconfirmations(offer_id,schedule_version,planned_start,requested_at,reminder_at,escalate_at)
          values(${offer.id}::uuid,${offer.schedule_version},${job.checkInTime.toISOString()}::timestamptz,${acceptedAt.toISOString()}::timestamptz,${new Date(+acceptedAt + 2 * HOUR).toISOString()}::timestamptz,${new Date(escalationDue).toISOString()}::timestamptz) on conflict(offer_id) do nothing`);
        await tx.execute(sql`update phase3a_reconfirmations set state='confirmed',responded_at=${acceptedAt.toISOString()}::timestamptz where offer_id=${offer.id}::uuid and state='pending'`);
        continue;
      }
      await tx.execute(sql`insert into phase3a_reconfirmations(offer_id,schedule_version,planned_start,requested_at,reminder_at,escalate_at)
        values(${offer.id}::uuid,${offer.schedule_version},${job.checkInTime.toISOString()}::timestamptz,${now.toISOString()}::timestamptz,${new Date(+now + 2 * HOUR).toISOString()}::timestamptz,${new Date(escalationDue).toISOString()}::timestamptz)
        on conflict(offer_id) do nothing`);
      const [reconfirmation] = queryRows<Reconfirmation>(await tx.execute(sql`select * from phase3a_reconfirmations where offer_id=${offer.id}::uuid`));
      if (reconfirmation.state !== "pending") continue;
      if (+now >= escalationDue) {
        await tx.execute(sql`update phase3a_lifecycle_actions set dispatch_state='skipped' where reconfirmation_id=${reconfirmation.id}::uuid and kind in ('reconfirmation_request','reconfirmation_reminder') and dispatch_state='pending'`);
        await enqueue(tx, offer.id, "reconfirmation_escalation", now, {}, reconfirmation.id);
      } else if (+now >= +new Date(reconfirmation.reminder_at)) {
        await enqueue(tx, offer.id, "reconfirmation_reminder", now, {}, reconfirmation.id);
      }
    }
    return expired;
  });
}

function retryable(error: unknown): boolean {
  const value = error as { code?: string; cause?: { code?: string } };
  return ["40001", "40P01"].includes(value.code ?? value.cause?.code ?? "");
}

export async function processAssignmentLifecycle(now?: Date) {
  const summary = { scanned: 0, errors: [] as string[] };
  if (!lifecycleSchemaReady()) return summary;
  now ??= new Date(queryRows<{ now: string }>(await db.execute(sql`select clock_timestamp() as now`))[0].now);
  const due = queryRows<{ job_id: string }>(await db.execute(sql`
    select distinct o.job_id from phase3a_assignment_offers o
    join phase3a_offer_jobs j on j.job_id=o.job_id and j.lifecycle_enabled and j.schedule_version=o.schedule_version
    join jobs job on job.id=o.job_id
    left join phase3a_reconfirmations r on r.offer_id=o.id
    where job.status::text in ('assigned','unassigned') and job.check_in_time is not null
    and not exists(select 1 from evidence_packets e where e.job_id=job.id and e.gps_check_in_timestamp is not null) and (
      (o.state='pending' and (o.response_due_at<=${now.toISOString()}::timestamptz or
        (o.response_reminder_at<=${now.toISOString()}::timestamptz and not exists(select 1 from phase3a_lifecycle_actions a where a.offer_id=o.id and a.kind='initial_reminder')))) or
      (o.state='accepted' and job.check_in_time>${now.toISOString()}::timestamptz and o.role in ('primary','laundry_lead') and job.check_in_time<=${new Date(+now + HOUR).toISOString()}::timestamptz and
        not exists(select 1 from phase3a_lifecycle_actions a where a.offer_id=o.id and a.kind='eta_prompt')) or
      (o.state='accepted' and job.check_in_time>${now.toISOString()}::timestamptz and job.check_in_time<=${new Date(+now + 24 * HOUR).toISOString()}::timestamptz and
        not exists(select 1 from phase3a_lifecycle_actions a where a.offer_id=o.id and a.kind='reconfirmation_policy_review') and
        (r.id is null or (r.state='pending' and (
          (r.escalate_at<=${now.toISOString()}::timestamptz and not exists(select 1 from phase3a_lifecycle_actions a where a.offer_id=o.id and a.kind='reconfirmation_escalation')) or
          (r.reminder_at<=${now.toISOString()}::timestamptz and r.escalate_at>${now.toISOString()}::timestamptz and not exists(select 1 from phase3a_lifecycle_actions a where a.offer_id=o.id and a.kind='reconfirmation_reminder')))))))
    order by o.job_id limit 100`));
  for (const { job_id: jobId } of due) {
    summary.scanned++;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const expired = await processJob(jobId, now);
        if (expired) {
          try { await repairPairedBackups(jobId); }
          catch { summary.errors.push(`Replacement backup search needs review: ${jobId}`); }
        }
        break;
      } catch (error) {
        if (attempt === 0 && retryable(error)) continue;
        summary.errors.push(`Lifecycle processing failed: ${jobId}`);
        break;
      }
    }
  }
  return summary;
}

export async function respondToReconfirmation(input: {
  jobId: string; cleanerId: string; reconfirmationId: string; offerId: string;
  version: number; scheduleVersion: number; role: string; response: "confirmed" | "cannot_fulfill";
}) {
  if (!lifecycleSchemaReady()) throw new OfferConflict("Reconfirmation is unavailable");
  return db.transaction(async tx => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, input.jobId)).for("update");
    if (!job || !["assigned", "unassigned"].includes(job.status ?? "")) throw new OfferConflict("Job is no longer open for reconfirmation");
    const [record] = queryRows<Reconfirmation>(await tx.execute(sql`
      select r.* from phase3a_reconfirmations r join phase3a_assignment_offers o on o.id=r.offer_id
      join phase3a_offer_jobs j on j.job_id=o.job_id and j.schedule_version=o.schedule_version and j.lifecycle_enabled
      join jobs_to_cleaners x on x.job_id=o.job_id and x.cleaner_id=o.cleaner_id and x.role::text=o.role
      where r.id=${input.reconfirmationId}::uuid and o.id=${input.offerId}::uuid and o.job_id=${input.jobId}::uuid and o.cleaner_id=${input.cleanerId}::uuid
      and o.version=${input.version} and o.role=${input.role} and r.schedule_version=${input.scheduleVersion} and o.state='accepted' for update of r`));
    if (!record || record.state === "revoked" || !job.checkInTime || +new Date(record.planned_start) !== +job.checkInTime) throw new OfferConflict("This reconfirmation changed");
    if (record.state === input.response) return record;
    if (record.state !== "pending") throw new OfferConflict("A reconfirmation response is already recorded");
    if (queryRows(await tx.execute(sql`select id from evidence_packets where job_id=${input.jobId}::uuid and gps_check_in_timestamp is not null`)).length) throw new OfferConflict("This job has already started");
    await tx.execute(sql`select set_config('cleannami.assignment_actor',${input.cleanerId},true)`);
    return queryRows<Reconfirmation>(await tx.execute(sql`update phase3a_reconfirmations set state=${input.response},responded_at=clock_timestamp() where id=${record.id}::uuid returning *`))[0];
  });
}

type DeliveryContext = AssignmentOffer & { job_status: string; start: string; current_role: string | null; reconfirmation_state: string | null; reminder_at: string | null; escalate_at: string | null };
async function deliveryContext(action: LifecycleAction): Promise<DeliveryContext | undefined> {
  return queryRows<DeliveryContext>(await db.execute(sql`
    select o.*,job.status::text as job_status,job.check_in_time as start,x.role::text as current_role,
      r.state as reconfirmation_state,r.reminder_at,r.escalate_at
    from phase3a_assignment_offers o join phase3a_offer_jobs j on j.job_id=o.job_id and j.schedule_version=o.schedule_version and j.lifecycle_enabled
    join jobs job on job.id=o.job_id left join jobs_to_cleaners x on x.job_id=o.job_id and x.cleaner_id=o.cleaner_id
    left join phase3a_reconfirmations r on r.offer_id=o.id and (${action.reconfirmation_id}::uuid is null or r.id=${action.reconfirmation_id}::uuid)
    where o.id=${action.offer_id}::uuid and not exists(select 1 from evidence_packets e where e.job_id=job.id and e.gps_check_in_timestamp is not null)`))[0];
}

function deliverable(action: LifecycleAction, context: DeliveryContext | undefined, now: Date): context is DeliveryContext {
  if (!context || !["assigned", "unassigned"].includes(context.job_status)) return false;
  if (action.kind === "offer_expired") return context.state === "revoked" && context.reason === "response_deadline_expired";
  const roleMatches = context.current_role === context.role || (!!context.replaces_cleaner_id && context.current_role === "backup" && context.state === "pending");
  if (!roleMatches) return false;
  if (action.kind === "eta_prompt") return context.state === "accepted" && context.role !== "backup" && context.reconfirmation_state !== "cannot_fulfill" && +new Date(context.start) > +now && +new Date(context.start) <= +now + HOUR;
  if (action.kind === "immediate_admin") return ["pending", "accepted"].includes(context.state);
  if (action.kind === "reconfirmation_policy_review") return context.state === "accepted";
  if (action.kind === "reconfirmation_response") return context.state === "accepted" && context.reconfirmation_state === "cannot_fulfill";
  if (action.kind.startsWith("reconfirmation_")) {
    if (context.state !== "accepted" || context.reconfirmation_state !== "pending" || +new Date(context.start) <= +now) return false;
    if (action.kind === "reconfirmation_escalation") return !!context.escalate_at && +new Date(context.escalate_at) <= +now;
    if (context.escalate_at && +new Date(context.escalate_at) <= +now) return false;
    return action.kind === "reconfirmation_request" || (!!context.reminder_at && +new Date(context.reminder_at) <= +now);
  }
  if (context.state !== "pending") return false;
  return action.kind !== "initial_reminder" || (!!context.response_due_at && +new Date(context.response_due_at) > +now && +new Date(context.start) > +now);
}

export async function dispatchLifecycleActions(now?: Date) {
  if (!lifecycleSchemaReady()) return;
  now ??= new Date(queryRows<{ now: string }>(await db.execute(sql`select clock_timestamp() as now`))[0].now);
  const claimed = queryRows<LifecycleAction>(await db.execute(sql`
    update phase3a_lifecycle_actions set dispatch_state='claimed',claimed_at=${now.toISOString()}::timestamptz
    where id in (select id from phase3a_lifecycle_actions where dispatch_state='pending' and occurred_at<=${now.toISOString()}::timestamptz order by occurred_at,id limit 100 for update skip locked)
    and dispatch_state='pending' returning *`));
  for (const action of claimed) {
    const context = await deliveryContext(action);
    if (!deliverable(action, context, now)) {
      await db.execute(sql`update phase3a_lifecycle_actions set dispatch_state='skipped' where id=${action.id}::uuid`);
      continue;
    }
    const cleanerMessage = ["initial_reminder", "reconfirmation_request", "reconfirmation_reminder", "eta_prompt"].includes(action.kind);
    const title = action.kind === "eta_prompt" ? "Confirm your ETA" : action.kind === "initial_reminder" ? "Assignment response reminder" : action.kind === "reconfirmation_reminder" ? "Reconfirmation reminder" : "Please reconfirm your assignment";
    const url = `/cleaner/jobs/${context.job_id}?offerId=${context.id}&version=${context.version}&role=${context.role}`;
    let failed = false;
    if (cleanerMessage) {
      const message = action.kind === "eta_prompt" ? "Your clean starts within the next hour. Open your job to confirm your ETA or report a delay." : action.kind === "initial_reminder" ? "Your assignment is still awaiting a response. Please confirm or decline before the deadline in your portal." : "Please reconfirm your current duty for the upcoming clean. If you cannot fulfil it, tell us in your portal.";
      try { await notifyCleaner({ cleanerId: context.cleaner_id, type: "assignment", title, message, jobId: context.job_id, url, sms: true, metadata: { offerId: context.id, lifecycleActionId: action.id } }); }
      catch { failed = true; }
      try {
        const fresh = await deliveryContext(action);
        if (deliverable(action, fresh, now)) {
          const cleaner = await db.query.cleaners.findFirst({ where: eq(cleaners.id, context.cleaner_id), columns: { fullName: true, email: true } });
          if (!cleaner?.email) failed = true;
          else {
            const result = await sendTransactionalEmail(cleaner.email, title, { previewText: title, heading: title, greeting: `Hi ${cleaner.fullName},`, bodyLines: [message], ctaLabel: "Review assignment", ctaUrl: `${getAppBaseUrl()}${url}` }, { trigger: action.kind, jobId: context.job_id });
            if (!result.success) failed = true;
          }
        }
      } catch { failed = true; }
    } else {
      const adminTitle = action.kind === "immediate_admin" ? "Short-notice assignment under 24 hours" : action.kind === "offer_expired" ? "Assignment response expired - Coverage Incomplete" : action.kind === "reconfirmation_escalation" ? "Reconfirmation unanswered at T-12" : action.kind === "reconfirmation_response" ? "Cleaner cannot fulfil upcoming duty" : "Assignment timing needs admin review";
      const message = action.kind === "offer_expired" ? (action.details.promotionOfferId ? "The unanswered offer expired. A fresh working offer was created for the eligible paired backup; confirmation is pending and replacement backup coverage is being sought." : action.details.coverage === "past_start_admin_review" ? "The unanswered offer expired and the scheduled start has passed. Review coverage now; no automatic promotion was made in this timing case." : "The unanswered offer expired. No confirmed eligible paired backup was secured; review incomplete coverage.") : action.kind === "reconfirmation_escalation" ? "An accepted cleaner has not reconfirmed. Their assignment is retained; investigate and arrange coverage if needed." : action.kind === "reconfirmation_response" ? "A cleaner explicitly reported they cannot fulfil their upcoming duty. Review coverage; no automatic removal or pay change was made." : "A short-notice assignment or unresolved timing case needs review. See current role, offer and schedule in job oversight.";
      try {
        if (!(await notifyAdmins({ type: "assignment", title: adminTitle, message, jobId: context.job_id, url: `/admin/job-oversight/${context.job_id}`, email: true, eventIdentity: `assignment-lifecycle:${action.id}` }))) failed = true;
      } catch { failed = true; }
    }
    await db.execute(sql`update phase3a_lifecycle_actions set dispatch_state=${failed ? "failed" : "sent"} where id=${action.id}::uuid and dispatch_state='claimed'`);
  }
}
