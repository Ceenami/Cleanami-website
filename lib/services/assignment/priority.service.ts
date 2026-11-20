import "server-only";
import { db } from "@/db";
import { jobs, jobsToCleaners } from "@/db/schemas";
import { dispatchPriorityNotices } from "./priority-notices.service";
export { dispatchPriorityNotices } from "./priority-notices.service";
import { eq, sql } from "drizzle-orm";
import { buildCandidates, type Candidate } from "./candidates.service";
import { selectCompleteTeam } from "./policy";
import { dispatchJobOffers, enrollOfferJob, offerPairedPromotionInTransaction, repairPairedBackups } from "./offers.service";
import { assertPriorityPlan, failPriorityPlan, lockPriorityJobs, priorityRetryable, priorityTransaction, recordPriorityMoveResponse, rows, type PriorityPlan } from "./priority-transitions";
import { priorityEnrollmentEnabled, prioritySchemaReady } from "./priority-settings";
import { notifyAdmins } from "@/lib/queries/admin-notifications";
import { assignmentExceptionsEnrollment, assignmentExceptionsReady } from "./exception-settings";
import { prepareFuturePriorityJob } from "./priority-preparation";
import { cappedResponseTimes } from "./lifecycle-policy";
import type { PriorityMoveApproval } from "./priority-approvals";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Only M6's empty reviewed targets may re-enter ordinary automatic assignment. */
export async function canAssignPriorityFallback(jobId: string, tx: Tx | typeof db = db) {
  if (!priorityEnrollmentEnabled()) return false;
  return rows(await tx.execute(sql`select j.id from jobs j where j.id=${jobId}::uuid and j.status::text='unassigned'
    and (exists(select 1 from phase3a_coverage_alerts a where a.job_id=j.id and a.identity like 'property_priority_review:%')
      or exists(select 1 from phase3a_priority_plans p where p.target_job_id=j.id and p.state in ('failed','canceled')))
    and not exists(select 1 from jobs_to_cleaners x where x.job_id=j.id)
    and not exists(select 1 from phase3a_assignment_offers o where o.job_id=j.id and o.state in ('pending','accepted'))
    and not exists(select 1 from phase3a_priority_plans p where (p.target_job_id=j.id or p.donor_job_id=j.id) and p.state='pending')`)).length > 0;
}

export async function readPriorityPlans(jobId: string) {
  if (!prioritySchemaReady()) return [];
  return rows<PriorityPlan>(await db.execute(sql`select p.*,${assignmentExceptionsReady() ? sql`(select to_jsonb(a) from phase3a_priority_move_approvals a where a.plan_id=p.id)` : sql`null`} incoming_approval,coalesce((select jsonb_agg(jsonb_build_object('state',n.state,'dispatch_state',n.dispatch_state,'audience',n.audience)) from phase3a_priority_notices n where n.plan_id=p.id),'[]'::jsonb) notices
    from phase3a_priority_plans p where target_job_id=${jobId}::uuid or donor_job_id=${jobId}::uuid order by created_at desc limit 30`));
}

/** Called before ordinary assignment, and by the authenticated admin/worker paths. */
export async function planPropertyPriority(targetJobId: string, actorId = "assignment-engine") {
  if (!priorityEnrollmentEnabled()) return null;
  const [active] = rows<PriorityPlan>(await db.execute(sql`select * from phase3a_priority_plans where target_job_id=${targetJobId}::uuid and state='pending'`));
  if (active) return active;
  const target = await db.query.jobs.findFirst({ where: eq(jobs.id, targetJobId) });
  const extended = assignmentExceptionsEnrollment();
  if (!target?.propertyId || !(target.status === "unassigned" || extended && target.status === "assigned") || !target.checkInTime || +target.checkInTime <= Date.now()) return null;
  const [designation] = rows<{ cleaner_id: string; donor_job_id: string }>(await db.execute(sql`select r.cleaner_id,x.job_id donor_job_id from property_cleaners r
    join jobs_to_cleaners x on x.cleaner_id=r.cleaner_id and x.role::text in ('primary','laundry_lead')
    join jobs d on d.id=x.job_id
    where r.property_id=${target.propertyId}::uuid and r.tier::text='main_primary' and d.id<>${targetJobId}::uuid and d.status::text<>'canceled'
    and not exists(select 1 from jobs_to_cleaners own where own.job_id=${targetJobId}::uuid and own.cleaner_id=r.cleaner_id and own.role::text in ('primary','laundry_lead'))
    and ((d.check_in_time at time zone 'America/New_York')::date=(${target.checkInTime.toISOString()}::timestamptz at time zone 'America/New_York')::date
      or (d.check_in_time<case when ${target.serviceType}='residential_one_time' then greatest(${target.checkOutTime?.toISOString() ?? null}::timestamptz,${target.checkInTime.toISOString()}::timestamptz+coalesce(${target.expectedHours}::numeric,4)*interval '1 hour') else ${target.checkInTime.toISOString()}::timestamptz+coalesce(${target.expectedHours}::numeric,4)*interval '1 hour' end
      and case when d.service_type='residential_one_time' then greatest(d.check_out_time,d.check_in_time+coalesce(d.expected_hours,4)*interval '1 hour') else d.check_in_time+coalesce(d.expected_hours,4)*interval '1 hour' end>${target.checkInTime.toISOString()}::timestamptz)) order by d.id limit 1`));
  if (!designation) return null;
  if (extended) {
    // If both properties are main, retain the existing booking rather than
    // repeatedly displacing the cleaner between equally preferred properties.
    const incumbentMain = rows(await db.execute(sql`select r.id from property_cleaners r join jobs d on d.property_id=r.property_id where d.id=${designation.donor_job_id}::uuid and r.cleaner_id=${designation.cleaner_id}::uuid and r.tier::text='main_primary'`));
    if (incumbentMain.length) return null;
    if (!await prepareFuturePriorityJob(targetJobId)) return null;
    if (!await prepareFuturePriorityJob(designation.donor_job_id)) {
      await recordPriorityReview(targetJobId,"The main cleaner's current job cannot be displaced. Keep its coverage and use eligible fallback for the priority property.");
      return null;
    }
    await repairPairedBackups(designation.donor_job_id);
    await dispatchJobOffers(designation.donor_job_id);
  }
  const incumbents = await db.select().from(jobsToCleaners).where(eq(jobsToCleaners.jobId, targetJobId));
  const working = incumbents.filter(x => ["primary", "laundry_lead"].includes(x.role));
  // Frozen/manual staffing is never silently reduced to one person.
  const size = target.addonsSnapshot?.teamSize;
  if (target.addonsSnapshot?.requiresManualStaffing || size === null) {
    // A manual staffing hold is an existing hard constraint, not permission to
    // guess scope or rewrite frozen staffing terms from today's team count.
    if (extended) await recordPriorityReview(targetJobId,"Manual staffing or an unknown required team size must be resolved before automatic assignment. Existing coverage was retained.");
    return null;
  }
  const pool = await buildCandidates(target.propertyId, target.serviceType === "residential_one_time" ? { requirePetComfortable: !!target.addonsSnapshot?.petsAllowed } : null);
  const eligible: Candidate[] = [];
  for (const candidate of pool) {
    try {
      await db.execute(sql`select phase3a_assert_priority_candidate(${targetJobId}::uuid,${candidate.cleanerId}::uuid,null,'primary',${candidate.cleanerId === designation.cleaner_id ? designation.donor_job_id : null}::uuid)`);
      eligible.push(candidate);
    } catch { /* Existing constraints and priority ties remain hard gates. */ }
  }
  const preferred = eligible.find(c => c.cleanerId === designation.cleaner_id);
  const requirements = target.checklistSnapshot as { capabilityRequirements?: { hotTub?: boolean; laundryLead?: boolean } } | null;
  const hot = !!requirements?.capabilityRequirements?.hotTub || (!!target.addonsSnapshot?.hotTubServiceLevel && target.addonsSnapshot.hotTubServiceLevel !== "none");
  const laundry = !!requirements?.capabilityRequirements?.laundryLead || target.addonsSnapshot?.laundryType === "off_site";
  // Require the main cleaner in the full proposed team; preserve ranked fallback order.
  const requiredSize = size ?? 1;
  const rest = preferred && selectCompleteTeam(eligible.filter(c => c.cleanerId !== preferred.cleanerId), requiredSize - 1, hot && !preferred.hotTubCapable, laundry && !preferred.laundryLeadCapable);
  let team = preferred && (requiredSize === 1 ? ((!hot || preferred.hotTubCapable) && (!laundry || preferred.laundryLeadCapable) ? [preferred] : null) : rest ? [preferred, ...rest] : null);
  let replacedTarget: string | null = null;
  let retainedRoles: Map<string, "primary" | "laundry_lead"> | null = null;
  if (extended && working.length) {
    team = null;
    // Replace exactly one working slot, retaining the remaining accepted duties
    // and Laundry Lead. Qualification checks run for the whole proposed team.
    for (const displaced of [...working].sort((a,b) => b.cleanerId.localeCompare(a.cleanerId))) {
      const candidateTeam = preferred ? [...working.filter(x => x.cleanerId !== displaced.cleanerId).map(x => eligible.find(c => c.cleanerId === x.cleanerId)), preferred] : [];
      if (working.length !== requiredSize || candidateTeam.length !== requiredSize || candidateTeam.some(x => !x) || !preferred || displaced.role === "laundry_lead" && !preferred.laundryLeadCapable) continue;
      const complete = candidateTeam as Candidate[];
      if (hot && !complete.some(x => x.hotTubCapable) || laundry && !complete.some(x => x.laundryLeadCapable)) continue;
      team = complete; replacedTarget = displaced.cleanerId;
      retainedRoles = new Map(working.filter(x => x.cleanerId !== displaced.cleanerId).map(x => [x.cleanerId,x.role as "primary" | "laundry_lead"]));
      retainedRoles.set(preferred.cleanerId, displaced.role as "primary" | "laundry_lead");
      break;
    }
  }
  if (!team) {
    await recordPriorityReview(targetJobId, "Priority candidate, complete team or designation needs review");
    return null;
  }
  const lead = laundry ? team.find(c => c.laundryLeadCapable) : null;
  try {
    const plan = await priorityTransaction(async tx => {
      await lockPriorityJobs(tx, [targetJobId, designation.donor_job_id], team.map(c => c.cleanerId));
      const [existing] = rows<PriorityPlan>(await tx.execute(sql`select * from phase3a_priority_plans where target_job_id=${targetJobId}::uuid and state='pending'`));
      if (existing) return existing;
      const overlaps = rows(await tx.execute(sql`select id from phase3a_priority_plans where state='pending' and (target_job_id in(${targetJobId}::uuid,${designation.donor_job_id}::uuid) or donor_job_id in(${targetJobId}::uuid,${designation.donor_job_id}::uuid))`));
      if (overlaps.length) throw new Error("Another plan owns one of these jobs");
      const [fresh] = await tx.select().from(jobs).where(eq(jobs.id, targetJobId));
      if (JSON.stringify(fresh) !== JSON.stringify(target)) throw new Error("Target changed");
      if (!await enrollOfferJob(tx, targetJobId)) throw new Error("Offer enrollment unavailable");
      const [donor] = rows<{ id: string }>(await tx.execute(sql`select o.id from phase3a_assignment_offers o join phase3a_offer_jobs j on j.job_id=o.job_id and j.schedule_version=o.schedule_version
        where o.job_id=${designation.donor_job_id}::uuid and o.cleaner_id=${designation.cleaner_id}::uuid and o.state='accepted' and o.role in ('primary','laundry_lead')`));
      if (!donor) throw new Error("Donor needs accepted current working duty");
      const promotion = await offerPairedPromotionInTransaction(tx, designation.donor_job_id, designation.cleaner_id, actorId);
      if (promotion.swap_request_id) throw new Error("Existing swap owns this offer");
      const [created] = rows<PriorityPlan>(await tx.execute(sql`insert into phase3a_priority_plans(target_job_id,donor_job_id,cleaner_id,donor_offer_id,replacement_offer_id,target_team,target_fingerprint,donor_fingerprint,actor_id)
        values(${targetJobId}::uuid,${designation.donor_job_id}::uuid,${designation.cleaner_id}::uuid,${donor.id}::uuid,${promotion.id}::uuid,
        ${JSON.stringify(team.map(c => ({ cleanerId: c.cleanerId, role: retainedRoles?.get(c.cleanerId) ?? (c.cleanerId === lead?.cleanerId ? "laundry_lead" : "primary") })))}::jsonb,
        phase3a_priority_fingerprint(${targetJobId}::uuid),phase3a_priority_fingerprint(${designation.donor_job_id}::uuid),${actorId}) returning *`));
      if (replacedTarget) {
        const previous = rows(await tx.execute(sql`select a.plan_id from phase3a_priority_move_approvals a join phase3a_priority_plans p on p.id=a.plan_id where p.target_job_id=${targetJobId}::uuid and p.cleaner_id=${designation.cleaner_id}::uuid and a.state='declined' and p.target_fingerprint=phase3a_priority_fingerprint(${targetJobId}::uuid)`));
        if (previous.length) throw new Error("Cleaner declined this unchanged priority proposal");
        const [schedule] = rows<{ schedule_version: number; rate_cents: number; address: string; donor_start: string }>(await tx.execute(sql`select v.schedule_version,p.address,d.check_in_time donor_start,
          case when j.addons_snapshot->'residentialPricing'->>'ruleVersion'='residential-v2' then 1900 else coalesce(nullif(c.hourly_rate_cents,0),1700) end rate_cents
          from phase3a_offer_jobs v join jobs j on j.id=v.job_id join properties p on p.id=j.property_id cross join cleaners c cross join jobs d
          where v.job_id=${targetJobId}::uuid and c.id=${designation.cleaner_id}::uuid and d.id=${designation.donor_job_id}::uuid`));
        const offeredAt = new Date();
        const window = cappedResponseTimes(offeredAt,target.checkInTime!);
        const dueAt = new Date(Math.max(+offeredAt,Math.min(+window.dueAt,+new Date(schedule.donor_start))));
        const timing = {dueAt,reminderAt:new Date(+offeredAt+(+dueAt-+offeredAt)/2)};
        await tx.execute(sql`insert into phase3a_priority_move_approvals(plan_id,cleaner_id,target_schedule_version,details,offered_at,response_due_at,reminder_at)
          values(${created.id}::uuid,${designation.cleaner_id}::uuid,${schedule.schedule_version},${JSON.stringify({address:schedule.address,plannedStart:target.checkInTime!.toISOString(),plannedEnd:target.checkOutTime?.toISOString() ?? null,expectedHours:target.expectedHours,role:retainedRoles!.get(designation.cleaner_id),rateCents:schedule.rate_cents})}::jsonb,${offeredAt.toISOString()}::timestamptz,${timing.dueAt.toISOString()}::timestamptz,${timing.reminderAt.toISOString()}::timestamptz)`);
        await tx.execute(sql`insert into phase3a_priority_notices(plan_id,state,job_id,audience,cleaner_id) values(${created.id}::uuid,'pending',${designation.donor_job_id}::uuid,'cleaner',${designation.cleaner_id}::uuid) on conflict do nothing`);
      }
      await assertPriorityPlan(tx, created);
      return created;
    });
    await dispatchJobOffers(plan.donor_job_id).catch(error => console.error("[priority] offer dispatch needs review", error));
    await dispatchPriorityNotices().catch(error => console.error("[priority] plan notice dispatch needs review", error));
    return plan;
  } catch (error) {
    console.warn("[priority] plan not created; donor retained", (error as { cause?: { code?: string } }).cause?.code ?? (error instanceof Error ? error.message : "unknown error"));
    // Retain donor coverage and expose the target gap for review.
    await repairPairedBackups(designation.donor_job_id).catch(() => {});
    await dispatchJobOffers(designation.donor_job_id);
    await recordPriorityReview(targetJobId, "Replacement could not be secured; existing donor coverage retained");
    return null;
  }
}

async function recordPriorityReview(jobId: string, message: string) {
  // Enroll only the otherwise eligible new target to expose the real gap to admin.
  const enrolled = await db.transaction(async tx => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (job?.status === "assigned" && assignmentExceptionsEnrollment()) return enrollOfferJob(tx,jobId);
    if (job?.status !== "unassigned") return false;
    const occupied = rows(await tx.execute(sql`select cleaner_id from jobs_to_cleaners where job_id=${jobId}::uuid`));
    if (occupied.length) return false;
    return enrollOfferJob(tx, jobId);
  });
  if (!enrolled) return;
  const [claim] = rows<{identity:string}>(await db.execute(sql`insert into phase3a_coverage_alerts(job_id,identity) select job_id,'property_priority_review:'||schedule_version::text from phase3a_offer_jobs where job_id=${jobId}::uuid on conflict do nothing returning identity`));
  if (claim) await notifyAdmins({ type: "assignment", title: "Property priority needs review", message, jobId, url: `/admin/job-oversight/${jobId}`, email: true,eventIdentity:`priority-review:${jobId}:${claim.identity}` });
}

/** Recheck waiting plans after reschedules, cancellation, eligibility edits or missed replies. */
export async function processPriorityPlans() {
  if (!prioritySchemaReady()) return;
  const pending = rows<PriorityPlan>(await db.execute(sql`select * from phase3a_priority_plans where state='pending' order by created_at limit 50`));
  for (const found of pending) {
    await priorityTransaction(async tx => {
      await lockPriorityJobs(tx, [found.target_job_id, found.donor_job_id]);
      const [plan] = rows<PriorityPlan>(await tx.execute(sql`select * from phase3a_priority_plans where id=${found.id}::uuid for update`));
      if (plan.state !== "pending") return;
      await tx.execute(sql`select set_config('cleannami.assignment_actor','priority-worker',true)`);
      try {
        await tx.transaction(async nested => {
          await assertPriorityPlan(nested, plan);
          const [approval] = assignmentExceptionsReady() ? rows<PriorityMoveApproval>(await nested.execute(sql`select * from phase3a_priority_move_approvals where plan_id=${plan.id}::uuid`)) : [];
          const [offer] = rows(await nested.execute(sql`select id from phase3a_assignment_offers where id=${plan.replacement_offer_id}::uuid and (state='pending' ${approval ? sql`or state='accepted'` : sql``})`));
          if (!offer) throw new Error("Replacement offer changed");
          if (approval?.state === "pending") {
            const now = new Date(rows<{now:string}>(await nested.execute(sql`select clock_timestamp() now`))[0].now);
            if (+new Date(approval.response_due_at) <= +now) throw new Error("Incoming priority confirmation expired");
            if (+new Date(approval.reminder_at) <= +now) await nested.execute(sql`insert into phase3a_priority_notices(plan_id,state,job_id,audience,cleaner_id)
              values(${plan.id}::uuid,'approval_reminder',${plan.donor_job_id}::uuid,'cleaner',${plan.cleaner_id}::uuid) on conflict do nothing`);
          }
        });
      } catch (error) {
        if (priorityRetryable(error)) throw error;
        await failPriorityPlan(tx, plan, error instanceof Error && error.message === "Incoming priority confirmation expired" ? "priority_move_response_expired" : "waiting_plan_invalidated");
      }
    });
    await repairPairedBackups(found.donor_job_id).catch(() => {});
    await dispatchJobOffers(found.donor_job_id);
  }
}

export async function discoverPriorityPlans() {
  if (!priorityEnrollmentEnabled()) return;
  const targets = rows<{ id: string }>(await db.execute(sql`select j.id from jobs j where ${assignmentExceptionsEnrollment() ? sql`j.status::text in ('unassigned','assigned')` : sql`j.status::text='unassigned'`} and j.check_in_time>clock_timestamp()
    and exists(select 1 from property_cleaners r where r.property_id=j.property_id and r.tier::text='main_primary')
    and not exists(select 1 from phase3a_priority_plans p where p.target_job_id=j.id ${assignmentExceptionsEnrollment() ? sql`and p.state='pending'` : sql``})
    order by j.check_in_time,j.id limit 30`));
  for (const target of targets) await planPropertyPriority(target.id);
}

export async function respondToPriorityMove(input: Parameters<typeof recordPriorityMoveResponse>[0]) {
  const result = await recordPriorityMoveResponse(input);
  for (const id of [result.plan.donor_job_id,result.plan.target_job_id]) {
    await repairPairedBackups(id).catch(() => {});
    await dispatchJobOffers(id);
  }
  await dispatchPriorityNotices();
  if (!result.approval) throw new Error("Priority proposal changed or expired; current coverage retained");
  return { state:result.plan.state,response:result.approval.state,
    ...(result.plan.state === "completed" ? {destination:`/cleaner/jobs/${result.plan.target_job_id}`} : {}) };
}

export async function cancelPriorityPlan(jobId: string, planId: string, actorId: string) {
  if (!prioritySchemaReady()) throw new Error("Priority workflow unavailable");
  const [plan] = rows<PriorityPlan>(await db.execute(sql`select * from phase3a_priority_plans where id=${planId}::uuid and (target_job_id=${jobId}::uuid or donor_job_id=${jobId}::uuid)`));
  if (!plan) throw new Error("Plan unavailable");
  await priorityTransaction(async tx => {
    await lockPriorityJobs(tx, [plan.target_job_id, plan.donor_job_id]);
    await tx.execute(sql`select set_config('cleannami.assignment_actor',${actorId},true)`);
    await failPriorityPlan(tx, plan, "admin_canceled", "canceled");
  });
  await repairPairedBackups(plan.donor_job_id);
  await dispatchJobOffers(plan.donor_job_id);
  await dispatchPriorityNotices();
}

