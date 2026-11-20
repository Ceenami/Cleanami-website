import "server-only";
import { db } from "@/db";
import { jobs, jobsToCleaners } from "@/db/schemas";
import { and, eq, sql } from "drizzle-orm";
import { recalculateJobRolesInTransaction } from "./team-roles";
import { prioritySchemaReady } from "./priority-settings";
import type { AssignmentOffer } from "./offers.service";
import { assignmentExceptionsReady } from "./exception-settings";
import type { PriorityMoveApproval } from "./priority-approvals";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PriorityPlan = {
  id: string; target_job_id: string; donor_job_id: string; cleaner_id: string;
  replacement_offer_id: string; donor_offer_id: string; target_team: Array<{ cleanerId: string; role: "primary" | "laundry_lead" }>;
  target_fingerprint: unknown; donor_fingerprint: unknown;
  state: "pending" | "completed" | "failed" | "canceled"; reason: string | null;
  created_at: string; resolved_at: string | null; actor_id: string;
};
export function rows<T>(result: unknown): T[] { return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[]; }
export function priorityRetryable(error: unknown) {
  const value = error as { code?: string; cause?: { code?: string } };
  return ["40001", "40P01"].includes(value.code ?? value.cause?.code ?? "");
}
export async function priorityTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.transaction(work, { isolationLevel: "serializable" }); }
    catch (error) { if (attempt >= 2 || !priorityRetryable(error)) throw error; }
  }
}

// Every cross-job transition acquires job locks in the same order, before offers.
export async function lockPriorityJobs(tx: Tx, ids: string[], proposedTeam: string[] = []) {
  for (const id of [...new Set(ids)].sort()) await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, id)).for("update");
  const jobIds = sql.join(ids.map(id => sql`${id}::uuid`), sql`, `);
  const properties = rows<{ id: string }>(await tx.execute(sql`select id from properties where id in (select property_id from jobs where id in (${jobIds})) order by id for update`));
  for (const property of properties) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`property:${property.id}`},0))`);
  const keys = rows<{ key: string }>(await tx.execute(sql`select distinct 'cleaner:'||c.cleaner_id::text||':'||(j.check_in_time at time zone 'America/New_York')::date::text key
    from jobs j cross join (select cleaner_id from jobs_to_cleaners where job_id in(${jobIds})
      union select (m->>'cleanerId')::uuid from phase3a_priority_plans p cross join lateral jsonb_array_elements(p.target_team) m where p.state='pending' and (p.target_job_id in(${jobIds}) or p.donor_job_id in(${jobIds}))
      ${proposedTeam.length ? sql`union select unnest(array[${sql.join(proposedTeam.map(id => sql`${id}::uuid`), sql`, `)}])` : sql``}) c
    where j.id in(${jobIds}) and j.check_in_time is not null order by key`));
  for (const { key } of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`);
}
export async function failPriorityPlan(tx: Tx, plan: PriorityPlan, reason: string, state = "failed") {
  const changed = rows(await tx.execute(sql`update phase3a_priority_plans set state=${state},reason=${reason},resolved_at=clock_timestamp() where id=${plan.id}::uuid and state='pending' returning id`));
  if (!changed.length) return;
  await tx.execute(sql`update phase3a_assignment_offers set state='revoked',reason='priority_plan_closed',revoked_at=clock_timestamp() where id=${plan.replacement_offer_id}::uuid and (state='pending' ${assignmentExceptionsReady() ? sql`or state='accepted' and exists(select 1 from phase3a_priority_move_approvals a where a.plan_id=${plan.id}::uuid)` : sql``})`);
  if (assignmentExceptionsReady()) await tx.execute(sql`update phase3a_priority_move_approvals set state='revoked',reason=${reason} where plan_id=${plan.id}::uuid and state in ('pending','accepted')`);
}

export async function assertPriorityPlan(tx: Tx, plan: PriorityPlan) {
  const valid = rows(await tx.execute(sql`select p.id from phase3a_priority_plans p
    join jobs t on t.id=p.target_job_id join jobs d on d.id=p.donor_job_id
    join phase3a_assignment_offers o on o.id=p.donor_offer_id
    where p.id=${plan.id}::uuid and p.state='pending' and (t.status::text='unassigned' ${assignmentExceptionsReady() ? sql`or t.status::text='assigned' and exists(select 1 from phase3a_priority_move_approvals a where a.plan_id=p.id)` : sql``}) and d.status::text='assigned'
    and t.check_in_time>clock_timestamp() and d.check_in_time>clock_timestamp()
    and o.state='accepted' and o.role in ('primary','laundry_lead')
    and not exists(select 1 from jobs_to_cleaners x where x.job_id=d.id and x.role::text in ('primary','laundry_lead') and not exists(
      select 1 from phase3a_assignment_offers a join phase3a_offer_jobs v on v.job_id=a.job_id and v.schedule_version=a.schedule_version
      where a.job_id=d.id and a.cleaner_id=x.cleaner_id and a.role=x.role::text and a.state='accepted'))
    and p.target_fingerprint=phase3a_priority_fingerprint(t.id) and p.donor_fingerprint=phase3a_priority_fingerprint(d.id)
    and not exists(select 1 from evidence_packets e where e.job_id in(t.id,d.id) and e.gps_check_in_timestamp is not null)`));
  if (!valid.length) throw new Error("Priority plan changed or work started");
  const workers = rows<{ cleaner_id: string; role: string }>(await tx.execute(sql`select cleaner_id,role::text from jobs_to_cleaners where job_id=${plan.donor_job_id}::uuid and role::text in ('primary','laundry_lead') order by cleaner_id`));
  for (const worker of workers) await tx.execute(sql`select phase3a_assert_candidate(${plan.donor_job_id}::uuid,${worker.cleaner_id}::uuid,null,${worker.role})`);
  for (const member of [...plan.target_team].sort((a, b) => a.cleanerId.localeCompare(b.cleanerId))) {
    await tx.execute(sql`select phase3a_assert_priority_candidate(${plan.target_job_id}::uuid,${member.cleanerId}::uuid,null,${member.role},${member.cleanerId === plan.cleaner_id ? plan.donor_job_id : null}::uuid)`);
  }
}

/** A linked promotion cannot be accepted through the ordinary one-job path. */
export async function respondToPriorityOffer(input: { jobId: string; cleanerId: string; offerId: string; version: number; scheduleVersion: number; role: string; response: "accepted" | "declined" }) {
  if (!prioritySchemaReady()) return null;
  const [found] = rows<PriorityPlan>(await db.execute(sql`select * from phase3a_priority_plans where replacement_offer_id=${input.offerId}::uuid`));
  if (!found) return null;
  const result = await priorityTransaction(async tx => {
    await lockPriorityJobs(tx, [found.target_job_id, found.donor_job_id]);
    const [plan] = rows<PriorityPlan>(await tx.execute(sql`select * from phase3a_priority_plans where id=${found.id}::uuid for update`));
    const [offer] = rows<AssignmentOffer>(await tx.execute(sql`select * from phase3a_assignment_offers where id=${input.offerId}::uuid for update`));
    // A forged or stale identity must never cancel someone else's plan.
    if (!offer || offer.job_id !== input.jobId || offer.cleaner_id !== input.cleanerId || offer.version !== input.version || offer.schedule_version !== input.scheduleVersion || offer.role !== input.role) throw new Error("Offer changed");
    if ((plan.state === "completed" || (plan.state === "failed" && plan.reason === "replacement_declined")) && offer.state === input.response) return { plan, offer };
    if (plan.state === "pending" && offer.state === "accepted" && input.response === "accepted") return { plan, offer };
    if (plan.state !== "pending" || offer.state !== "pending") throw new Error("Priority offer is no longer pending");
    await tx.execute(sql`select set_config('cleannami.assignment_actor',${input.cleanerId},true)`);
    if (input.response === "declined") {
      const [declined] = rows<AssignmentOffer>(await tx.execute(sql`update phase3a_assignment_offers set state='declined',responded_at=clock_timestamp() where id=${offer.id}::uuid returning *`));
      await failPriorityPlan(tx, plan, "replacement_declined");
      return { plan: { ...plan, state: "failed" as const }, offer: declined };
    }
    try {
      // On any final guard failure, roll back both teams, pay terms and acceptance.
      return await tx.transaction(async savepoint => {
        await assertPriorityPlan(savepoint, plan);
        await savepoint.execute(sql`select phase3a_assert_candidate(${plan.donor_job_id}::uuid,${input.cleanerId}::uuid,${plan.cleaner_id}::uuid,${offer.role})`);
        await savepoint.execute(sql`select set_config('cleannami.accepting_priority_plan',${plan.id},true)`);
        const [accepted] = rows<AssignmentOffer>(await savepoint.execute(sql`update phase3a_assignment_offers set state='accepted',responded_at=clock_timestamp() where id=${offer.id}::uuid returning *`));
        const [approval] = assignmentExceptionsReady() ? rows<PriorityMoveApproval>(await savepoint.execute(sql`select * from phase3a_priority_move_approvals where plan_id=${plan.id}::uuid for update`)) : [];
        if (approval?.state === "pending") return { plan, offer: accepted };
        if (approval && approval.state !== "accepted") throw new Error("Incoming main cleaner did not confirm");
        return commitPriorityMove(savepoint, plan, accepted, approval);
      });
    } catch (error) {
      if (priorityRetryable(error)) throw error;
      await failPriorityPlan(tx, plan, "final_coverage_or_version_check_failed");
      return { plan: { ...plan, state: "failed" as const }, offer: null };
    }
  });
  return result;
}

/** Caller holds both job locks and a savepoint. No external work here. */
async function commitPriorityMove(tx: Tx, plan: PriorityPlan, accepted: AssignmentOffer, approval?: PriorityMoveApproval) {
  await assertPriorityPlan(tx, plan);
  if (approval) {
    const [rate] = rows<{cents:number}>(await tx.execute(sql`select case when j.addons_snapshot->'residentialPricing'->>'ruleVersion'='residential-v2' then 1900 else coalesce(nullif(c.hourly_rate_cents,0),1700) end cents from jobs j cross join cleaners c where j.id=${plan.target_job_id}::uuid and c.id=${plan.cleaner_id}::uuid for share of c`));
    if (rate.cents !== approval.details.rateCents) throw new Error("Proposed pay changed; fresh approval required");
  }
  await tx.execute(sql`select phase3a_assert_candidate(${plan.donor_job_id}::uuid,${accepted.cleaner_id}::uuid,${plan.cleaner_id}::uuid,${accepted.role})`);
  await tx.execute(sql`select set_config('cleannami.accepting_offer',${accepted.id},true)`);
  await tx.execute(sql`select set_config('cleannami.assignment_source','phase3a_property_priority',true)`);
  await tx.delete(jobsToCleaners).where(and(eq(jobsToCleaners.jobId, plan.donor_job_id), eq(jobsToCleaners.cleanerId, plan.cleaner_id)));
  await tx.update(jobsToCleaners).set({ role: accepted.role as "primary" | "laundry_lead", urgentBonus: rows<{ urgent: boolean }>(await tx.execute(sql`select check_in_time<=clock_timestamp()+interval '24 hours' as urgent from jobs where id=${plan.donor_job_id}::uuid`))[0].urgent, updatedAt: new Date() }).where(and(eq(jobsToCleaners.jobId, plan.donor_job_id), eq(jobsToCleaners.cleanerId, accepted.cleaner_id)));
  const targetMembers = await tx.select().from(jobsToCleaners).where(eq(jobsToCleaners.jobId, plan.target_job_id));
  for (const incumbent of targetMembers.filter(x => ["primary", "laundry_lead"].includes(x.role) && !plan.target_team.some(m => m.cleanerId === x.cleanerId))) {
    const paired = rows<{ cleaner_id: string }>(await tx.execute(sql`select cleaner_id from phase3a_assignment_offers where job_id=${plan.target_job_id}::uuid and paired_worker_id=${incumbent.cleanerId}::uuid and state in ('pending','accepted')`));
    await tx.delete(jobsToCleaners).where(and(eq(jobsToCleaners.jobId, plan.target_job_id), eq(jobsToCleaners.cleanerId, incumbent.cleanerId)));
    for (const backup of paired) await tx.delete(jobsToCleaners).where(and(eq(jobsToCleaners.jobId, plan.target_job_id), eq(jobsToCleaners.cleanerId, backup.cleaner_id), eq(jobsToCleaners.role,"backup")));
  }
  for (const member of plan.target_team) {
    await tx.execute(sql`select phase3a_assert_candidate(${plan.target_job_id}::uuid,${member.cleanerId}::uuid,null,${member.role})`);
    const incumbent = targetMembers.find(x => x.cleanerId === member.cleanerId);
    if (incumbent?.role === member.role) continue;
    if (incumbent) await tx.delete(jobsToCleaners).where(and(eq(jobsToCleaners.jobId,plan.target_job_id),eq(jobsToCleaners.cleanerId,member.cleanerId)));
    await tx.insert(jobsToCleaners).values({ jobId: plan.target_job_id, cleanerId: member.cleanerId, role: member.role,
      ...(approval && member.cleanerId === plan.cleaner_id ? {frozenHourlyRateCents:approval.details.rateCents} : {}) });
    if (approval && member.cleanerId === plan.cleaner_id) {
      const [issued] = await tx.select().from(jobsToCleaners).where(and(eq(jobsToCleaners.jobId,plan.target_job_id),eq(jobsToCleaners.cleanerId,member.cleanerId)));
      if (issued.frozenHourlyRateCents !== approval.details.rateCents) throw new Error("Proposed pay changed; fresh approval required");
      const [actor] = rows<{actor:string|null}>(await tx.execute(sql`select current_setting('cleannami.assignment_actor',true) actor`));
      await tx.execute(sql`select set_config('cleannami.assignment_actor',${approval.cleaner_id},true)`);
      await tx.execute(sql`update phase3a_assignment_offers set state='accepted',responded_at=${new Date(approval.responded_at!).toISOString()}::timestamptz,reason=${`priority_move_approval:${plan.id}`} where job_id=${plan.target_job_id}::uuid and cleaner_id=${member.cleanerId}::uuid and role=${member.role} and schedule_version=${approval.target_schedule_version} and state='pending'`);
      await tx.execute(sql`select set_config('cleannami.assignment_actor',${actor?.actor ?? "priority-coordinator"},true)`);
    }
  }
  await tx.update(jobs).set({ status: "assigned", updatedAt: new Date() }).where(eq(jobs.id,plan.target_job_id));
  await recalculateJobRolesInTransaction(tx,plan.donor_job_id,{preserveLaundryLead:true});
  await recalculateJobRolesInTransaction(tx,plan.target_job_id,{preserveLaundryLead:true});
  const unconfirmed = rows(await tx.execute(sql`select x.cleaner_id from jobs_to_cleaners x where x.job_id=${plan.donor_job_id}::uuid and x.role::text in ('primary','laundry_lead') and not exists(select 1 from phase3a_assignment_offers o join phase3a_offer_jobs v on v.job_id=o.job_id and v.schedule_version=o.schedule_version where o.job_id=x.job_id and o.cleaner_id=x.cleaner_id and o.role=x.role::text and o.state='accepted')`));
  if (unconfirmed.length) throw new Error("Donor working confirmation must remain secured");
  await tx.execute(sql`set constraints phase2c_working_team_guard, phase2c_job_team_guard immediate`);
  await tx.execute(sql`set constraints phase2c_working_team_guard, phase2c_job_team_guard deferred`);
  await tx.execute(sql`update phase3a_priority_plans set state='completed',resolved_at=clock_timestamp() where id=${plan.id}::uuid`);
  return { plan: {...plan,state:"completed" as const}, offer:accepted };
}

export async function recordPriorityMoveResponse(input: {sourceJobId:string;cleanerId:string;planId:string;targetScheduleVersion:number;response:"accepted"|"declined"}) {
  if (!assignmentExceptionsReady() || !prioritySchemaReady()) throw new Error("Priority move unavailable");
  const [found] = rows<PriorityPlan>(await db.execute(sql`select * from phase3a_priority_plans where id=${input.planId}::uuid and donor_job_id=${input.sourceJobId}::uuid and cleaner_id=${input.cleanerId}::uuid`));
  if (!found) throw new Error("Priority move unavailable");
  return priorityTransaction(async tx => {
    await lockPriorityJobs(tx,[found.target_job_id,found.donor_job_id]);
    const [plan] = rows<PriorityPlan>(await tx.execute(sql`select * from phase3a_priority_plans where id=${found.id}::uuid for update`));
    const [approval] = rows<PriorityMoveApproval>(await tx.execute(sql`select * from phase3a_priority_move_approvals where plan_id=${found.id}::uuid for update`));
    if (!approval || approval.cleaner_id !== input.cleanerId || approval.target_schedule_version !== input.targetScheduleVersion) throw new Error("Proposal version changed");
    if (approval.state === input.response) return {plan,approval};
    if (plan.state !== "pending" || approval.state !== "pending") throw new Error("Proposal is no longer pending");
    await tx.execute(sql`select set_config('cleannami.assignment_actor',${input.cleanerId},true)`);
    try {
      return await tx.transaction(async nested => {
        await assertPriorityPlan(nested,plan);
        const [updated] = rows<PriorityMoveApproval>(await nested.execute(sql`update phase3a_priority_move_approvals set state=${input.response},responded_at=clock_timestamp() where plan_id=${plan.id}::uuid returning *`));
        if (input.response === "declined") { await failPriorityPlan(nested,plan,"priority_move_declined"); return {plan:{...plan,state:"failed" as const},approval:updated}; }
        const [replacement] = rows<AssignmentOffer>(await nested.execute(sql`select * from phase3a_assignment_offers where id=${plan.replacement_offer_id}::uuid for update`));
        if (!replacement || !["pending","accepted"].includes(replacement.state)) throw new Error("Replacement duty changed");
        const completed = replacement.state === "accepted" ? await commitPriorityMove(nested,plan,replacement,updated) : {plan};
        return {...completed,approval:updated};
      });
    } catch(error) {
      if (priorityRetryable(error)) throw error;
      await failPriorityPlan(tx,plan,"priority_move_changed_or_expired");
      return {plan:{...plan,state:"failed" as const},approval:null};
    }
  });
}
