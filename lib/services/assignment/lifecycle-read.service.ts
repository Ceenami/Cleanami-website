import "server-only";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { jobs } from "@/db/schemas";
import { lifecycleSchemaReady } from "./lifecycle-settings";
import { prioritySchemaReady } from "./priority-settings";
import { overdueArrivalFilter } from "@/lib/jobs/operations-filter";
import type { AssignmentIssue, LifecycleAction, Reconfirmation } from "./lifecycle-policy";
import { assignmentExceptionsReady } from "./exception-settings";

function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

export async function readLifecycle(jobId: string, cleanerId?: string) {
  if (!lifecycleSchemaReady()) return { reconfirmations: [] as Reconfirmation[], actions: [] as LifecycleAction[] };
  const reconfirmations = rows<Reconfirmation>(await db.execute(sql`
    select r.* from phase3a_reconfirmations r join phase3a_assignment_offers o on o.id=r.offer_id
    where o.job_id=${jobId}::uuid ${cleanerId ? sql`and o.cleaner_id=${cleanerId}::uuid` : sql``}
    order by r.requested_at desc`));
  const actions = cleanerId ? [] : rows<LifecycleAction>(await db.execute(sql`
    select a.* from phase3a_lifecycle_actions a join phase3a_assignment_offers o on o.id=a.offer_id
    where o.job_id=${jobId}::uuid order by a.occurred_at desc,a.id limit 200`));
  return { reconfirmations, actions };
}

export async function isLifecycleJob(jobId: string) {
  if (!lifecycleSchemaReady()) return false;
  return rows(await db.execute(sql`select job_id from phase3a_offer_jobs where job_id=${jobId}::uuid and lifecycle_enabled`)).length > 0;
}

/** Applied before COUNT/LIMIT; filtering one already-paginated page would hide overdue jobs. */
export function assignmentIssueFilter(issue: AssignmentIssue) {
  if (issue === "all") return undefined;
  if (issue === "arrival_overdue") return overdueArrivalFilter();
  const open = sql`${jobs.status}::text in ('assigned','unassigned')`;
  const offerReady = process.env.ASSIGNMENT_OFFERS_SCHEMA_READY === "true";
  if (issue === "notification_attention") {
    const initial = offerReady ? sql`exists(select 1 from phase3a_assignment_offers o
      where o.job_id=${jobs.id} and o.dispatch_state in ('failed','claimed') and o.state in ('pending','accepted'))` : sql`false`;
    const lifecycle = lifecycleSchemaReady() ? sql`exists(select 1 from phase3a_lifecycle_actions a join phase3a_assignment_offers o on o.id=a.offer_id
      where o.job_id=${jobs.id} and a.dispatch_state in ('failed','claimed') and o.state in ('pending','accepted','revoked'))` : sql`false`;
    const priority = prioritySchemaReady() ? sql`exists(select 1 from phase3a_priority_notices n where n.job_id=${jobs.id} and n.dispatch_state in ('failed','claimed'))` : sql`false`;
    const workflows = process.env.NOTIFICATION_WORKFLOWS_SCHEMA_READY === "true" ? sql`exists(select 1 from phase3a_notification_events n where n.job_id=${jobs.id} and n.state in ('failed','claimed','unknown'))
      or exists(select 1 from notification_log n join phase3a_message_status s on s.message_sid=n.provider_message_id where n.job_id=${jobs.id} and s.status in ('failed','undelivered','canceled'))` : sql`false`;
    // A later success supersedes an observed failure only for the same recipient/channel/event.
    const channels = sql`exists(select 1 from notification_log n where n.job_id=${jobs.id} and (n.status='failed'
      or n.status='skipped' and (n.error ilike '%not configured%' or n.error ilike '%no phone%' or n.error ilike '%sender%configured%'))
      and not exists(select 1 from notification_log ok where ok.job_id=n.job_id and ok.channel=n.channel and ok.trigger=n.trigger
        and ok.recipient is not distinct from n.recipient and ok.status='sent' and ok.created_at>n.created_at))`;
    return sql`(${initial} or ${lifecycle} or ${priority} or ${workflows} or ${channels})`;
  }
  if (issue === "coverage_incomplete" || issue === "missing_confirmation") {
    if (!offerReady) return issue === "coverage_incomplete" ? sql`${jobs.status}::text='unassigned'` : sql`false`;
    const missing = sql`exists(select 1 from jobs_to_cleaners x where x.job_id=${jobs.id} and x.role::text in ('primary','laundry_lead') and (
      not exists(select 1 from phase3a_assignment_offers o join phase3a_offer_jobs v on v.job_id=o.job_id and v.schedule_version=o.schedule_version
        where o.job_id=x.job_id and o.cleaner_id=x.cleaner_id and o.role=x.role::text and o.state='accepted')
      or not exists(select 1 from phase3a_assignment_offers b join phase3a_offer_jobs v on v.job_id=b.job_id and v.schedule_version=b.schedule_version
        where b.job_id=x.job_id and b.paired_worker_id=x.cleaner_id and b.role='backup' and b.state='accepted')))`;
    const qualification = process.env.NOTIFICATION_WORKFLOWS_SCHEMA_READY === "true" ? sql`exists(
      select 1 from phase3a_assignment_offers o where o.job_id=${jobs.id} and o.state='accepted'
      and not phase3a_candidate_is_eligible(o.job_id,o.cleaner_id,o.paired_worker_id,o.role))` : sql`false`;
    const proposed = issue === "missing_confirmation" && assignmentExceptionsReady() ? sql`exists(select 1 from phase3a_priority_move_approvals a join phase3a_priority_plans p on p.id=a.plan_id where p.state='pending' and a.state='pending' and (${jobs.id}=p.target_job_id or ${jobs.id}=p.donor_job_id)) or` : sql``;
    return sql`${open} and (${proposed} ${issue === "coverage_incomplete" ? sql`${jobs.status}::text='unassigned' or` : sql``}
      exists(select 1 from phase3a_offer_jobs v where v.job_id=${jobs.id}) and (${missing}
      ${issue === "coverage_incomplete" ? sql`or ${qualification} or coalesce((${jobs.addonsSnapshot}->>'requiresManualStaffing')::boolean,false)
        or (${jobs.addonsSnapshot} ? 'teamSize' and ${jobs.addonsSnapshot}->>'teamSize' is null)
        or ((${jobs.addonsSnapshot}->>'hotTubServiceLevel' is not null and ${jobs.addonsSnapshot}->>'hotTubServiceLevel'<>'none'
          or coalesce((${jobs.checklistSnapshot}->'capabilityRequirements'->>'hotTub')::boolean,false)) and not exists(
            select 1 from jobs_to_cleaners x join cleaners c on c.id=x.cleaner_id where x.job_id=${jobs.id} and x.role::text in ('primary','laundry_lead') and c.has_hot_tub_cert))
        or ((${jobs.addonsSnapshot}->>'laundryType'='off_site' or coalesce((${jobs.checklistSnapshot}->'capabilityRequirements'->>'laundryLead')::boolean,false)) and not exists(
          select 1 from jobs_to_cleaners x join cleaners c on c.id=x.cleaner_id where x.job_id=${jobs.id} and x.role::text='laundry_lead' and c.has_laundry_lead_cert))
        or (select count(*) from jobs_to_cleaners x where x.job_id=${jobs.id} and x.role::text in ('primary','laundry_lead'))<>coalesce((${jobs.addonsSnapshot}->>'teamSize')::int,1)` : sql``}))`;
  }
  const priorityReview = issue === "response_overdue" && assignmentExceptionsReady() ? sql`exists(select 1 from phase3a_priority_move_approvals a join phase3a_priority_plans p on p.id=a.plan_id where p.state='pending' and a.state='pending' and a.response_due_at<=clock_timestamp() and (${jobs.id}=p.target_job_id or ${jobs.id}=p.donor_job_id))` : sql`false`;
  if (!lifecycleSchemaReady()) return priorityReview;
  const predicate = issue === "response_overdue" ? sql`
    (o.state='pending' and o.response_due_at<=clock_timestamp() or
     o.state='revoked' and o.reason='response_deadline_expired' and
     not exists(select 1 from phase3a_assignment_offers newer where newer.job_id=o.job_id and newer.cleaner_id=o.cleaner_id and newer.version>o.version and newer.state in ('pending','accepted')))`
    : issue === "reconfirmation_overdue" ? sql`o.state='accepted' and exists(select 1 from phase3a_reconfirmations r where r.offer_id=o.id and r.state='pending' and r.escalate_at<=clock_timestamp())`
    : sql`exists(select 1 from phase3a_lifecycle_actions a where a.offer_id=o.id and a.dispatch_state in ('failed','claimed'))`;
  return sql`${jobs.status}::text in ('assigned','unassigned') and (${priorityReview} or exists(
    select 1 from phase3a_assignment_offers o join phase3a_offer_jobs j on j.job_id=o.job_id and j.schedule_version=o.schedule_version and j.lifecycle_enabled
    join jobs_to_cleaners x on x.job_id=o.job_id and x.cleaner_id=o.cleaner_id
    where o.job_id=${jobs.id} and ${predicate}))`;
}

/** null retains the legacy ETA flow. Enrolled jobs use accepted current working offers only. */
export async function acceptedEtaOffer(jobId: string, cleanerId: string) {
  if (process.env.ASSIGNMENT_OFFERS_SCHEMA_READY !== "true") return undefined;
  const enrolled = rows(await db.execute(sql`select job_id from phase3a_offer_jobs where job_id=${jobId}::uuid`));
  if (!enrolled.length) return undefined;
  const [offer] = rows<{ id: string; version: number }>(await db.execute(sql`
    select o.id,o.version from phase3a_assignment_offers o join phase3a_offer_jobs j on j.job_id=o.job_id and j.schedule_version=o.schedule_version
    join jobs_to_cleaners x on x.job_id=o.job_id and x.cleaner_id=o.cleaner_id and x.role::text=o.role
    where o.job_id=${jobId}::uuid and o.cleaner_id=${cleanerId}::uuid and o.role in ('primary','laundry_lead') and o.state='accepted'`));
  return offer ?? null;
}
