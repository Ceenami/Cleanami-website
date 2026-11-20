import "server-only";
import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { eq, sql } from "drizzle-orm";
import { rows, type PriorityPlan } from "./priority-transitions";
import { prioritySchemaReady } from "./priority-settings";
import { notifyAdmins } from "@/lib/queries/admin-notifications";
import { notifyCleaner } from "@/lib/services/notifications/notify";
import { sendTransactionalEmail } from "@/lib/services/email.service";
import { getAppBaseUrl } from "@/lib/app-url";

/** Durable, independent channel attempts. Claimed/failed outcomes are never replayed. */
export async function dispatchPriorityNotices() {
  if (!prioritySchemaReady()) return;
  const notices = rows<{ id: string; plan_id: string; state: string; job_id: string; audience: string; cleaner_id: string | null }>(await db.execute(sql`update phase3a_priority_notices set dispatch_state='claimed',claimed_at=clock_timestamp() where id in(select id from phase3a_priority_notices where dispatch_state='pending' order by created_at limit 100) and dispatch_state='pending' returning *`));
  for (const notice of notices) {
    const [plan] = rows<PriorityPlan>(await db.execute(sql`select * from phase3a_priority_plans where id=${notice.plan_id}::uuid`));
    // Do not send an obsolete "waiting" notice after the plan has closed.
    const approvalReminder = notice.state === "approval_reminder" && plan.state === "pending";
    const currentReminder = !approvalReminder || rows(await db.execute(sql`select plan_id from phase3a_priority_move_approvals where plan_id=${plan.id}::uuid and state='pending' and response_due_at>clock_timestamp()`)).length > 0;
    if (notice.state !== plan.state && !approvalReminder || !currentReminder) {
      await db.execute(sql`update phase3a_priority_notices set dispatch_state='skipped' where id=${notice.id}::uuid and dispatch_state='claimed'`);
      continue;
    }
    const title = approvalReminder ? "Priority move confirmation reminder" : notice.state === "pending" ? "Property priority replacement pending" : notice.state === "completed" ? "Property priority assignments updated" : "Property priority move stopped";
    const message = approvalReminder ? "Please review and confirm or decline your proposed main-property duty before its response deadline. Keep your current assignment until the move is confirmed." : notice.state === "pending" ? "Current coverage remains in place while the proposed duties are confirmed. Review your job for any priority move proposal; a standby's working confirmation alone does not displace the current team." : notice.state === "completed" ? "Replacement working duty is confirmed. Review your current job and role; new working and backup offers require their own confirmation. Missing backups remain Coverage Incomplete." : "The move was stopped. Review your current duty and any new backup offers. No worker was displaced by this failed plan.";
    let failed = false;
    if (notice.audience === "admin") {
      try { failed = !(await notifyAdmins({ type: "assignment", title, message, jobId: notice.job_id, url: `/admin/job-oversight/${notice.job_id}`, email: true, eventIdentity: `property-priority:${notice.id}` })); } catch { failed = true; }
    } else if (notice.cleaner_id) {
      const member = await db.query.jobsToCleaners.findFirst({ where: (x, { and, eq }) => and(eq(x.jobId, notice.job_id), eq(x.cleanerId, notice.cleaner_id!)) });
      const url = member ? `/cleaner/jobs/${notice.job_id}` : "/cleaner/jobs";
      try { await notifyCleaner({ cleanerId: notice.cleaner_id, type: "assignment", title, message, jobId: notice.job_id, url, sms: true }); } catch { failed = true; }
      try {
        const profile = await db.query.cleaners.findFirst({ where: eq(cleaners.id, notice.cleaner_id) });
        if (!profile?.email || !(await sendTransactionalEmail(profile.email, title, { previewText: title, heading: title, greeting: `Hi ${profile?.fullName ?? "there"},`, bodyLines: [message], ctaLabel: "Review current assignments", ctaUrl: `${getAppBaseUrl()}${url}` }, { trigger: "property_priority", jobId: notice.job_id })).success) failed = true;
      } catch { failed = true; }
    }
    await db.execute(sql`update phase3a_priority_notices set dispatch_state=${failed ? "failed" : "sent"} where id=${notice.id}::uuid and dispatch_state='claimed'`);
  }
}
