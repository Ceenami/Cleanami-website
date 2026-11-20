import "server-only";
import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { eq, sql } from "drizzle-orm";
import { assignmentExceptionsEnrollment, ASSIGNMENT_AUTOMATION_POLICY } from "./exception-settings";
import { enrollOfferJob, queryRows, type AssignmentOffer } from "./offers.service";
import { priorityTransaction } from "./priority-transitions";

/** Enroll only the specific future, unstarted duty encountered by priority.
 * Existing pay/membership/acceptances and already stamped deadlines survive.
 * Only previously untimed pending offers are explicitly reissued. */
export async function prepareFuturePriorityJob(jobId: string, actorId = "priority-future-enrollment") {
  if (!assignmentExceptionsEnrollment()) return false;
  return priorityTransaction(async tx => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!job?.checkInTime || +job.checkInTime <= Date.now() || !["assigned", "unassigned"].includes(job.status ?? "")) return false;
    if (queryRows(await tx.execute(sql`select id from evidence_packets where job_id=${jobId}::uuid and gps_check_in_timestamp is not null`)).length) return false;
    if (queryRows(await tx.execute(sql`select id from phase3a_priority_plans where state='pending' and (donor_job_id=${jobId}::uuid or target_job_id=${jobId}::uuid)`)).length) return false;
    if (!await enrollOfferJob(tx, jobId)) return false;
    const [version] = queryRows<{ automation_policy: string | null; schedule_version: number }>(await tx.execute(sql`select automation_policy,schedule_version from phase3a_offer_jobs where job_id=${jobId}::uuid`));
    await tx.execute(sql`select set_config('cleannami.assignment_actor',${actorId},true)`);
    if (version.automation_policy !== ASSIGNMENT_AUTOMATION_POLICY) {
      await tx.execute(sql`update phase3a_offer_jobs set automation_policy=${ASSIGNMENT_AUTOMATION_POLICY},lifecycle_enabled=true where job_id=${jobId}::uuid`);
      const pending = queryRows<AssignmentOffer>(await tx.execute(sql`select * from phase3a_assignment_offers where job_id=${jobId}::uuid and state='pending' order by version`));
      for (const offer of pending) {
        if (offer.response_due_at) continue; // Never renew an existing/missed timer.
        await tx.execute(sql`update phase3a_assignment_offers set state='revoked',revoked_at=clock_timestamp(),reason='automation_policy_reissued' where id=${offer.id}::uuid`);
        await tx.execute(sql`insert into phase3a_assignment_offers(job_id,cleaner_id,role,paired_worker_id,replaces_cleaner_id,swap_request_id,schedule_version)
          values(${jobId}::uuid,${offer.cleaner_id}::uuid,${offer.role},${offer.paired_worker_id}::uuid,${offer.replaces_cleaner_id}::uuid,${offer.swap_request_id}::uuid,${version.schedule_version})`);
      }
    }
    await tx.execute(sql`insert into phase3a_assignment_offers(job_id,cleaner_id,role,schedule_version)
      select x.job_id,x.cleaner_id,x.role::text,${version.schedule_version} from jobs_to_cleaners x
      where x.job_id=${jobId}::uuid and x.role::text in ('primary','laundry_lead') and not exists(
        select 1 from phase3a_assignment_offers o where o.job_id=x.job_id and o.cleaner_id=x.cleaner_id and o.role=x.role::text and o.schedule_version=${version.schedule_version})`);
    return true;
  });
}

export async function canUpgradeFutureAssignment(jobId: string) {
  if (!assignmentExceptionsEnrollment()) return false;
  return queryRows(await db.execute(sql`select j.id from jobs j left join phase3a_offer_jobs v on v.job_id=j.id
    where j.id=${jobId}::uuid and j.status::text in ('assigned','unassigned') and j.check_in_time>clock_timestamp() and v.automation_policy is null
      and not exists(select 1 from evidence_packets e where e.job_id=j.id and e.gps_check_in_timestamp is not null)
      and not exists(select 1 from phase3a_priority_plans p where p.state='pending' and (p.target_job_id=j.id or p.donor_job_id=j.id))`)).length>0;
}
