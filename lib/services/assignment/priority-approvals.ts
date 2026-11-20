import "server-only";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { assignmentExceptionsReady } from "./exception-settings";

export type PriorityMoveApproval = {
  plan_id: string; cleaner_id: string; target_schedule_version: number;
  details: { address: string; plannedStart: string; plannedEnd: string | null; role: "primary" | "laundry_lead"; expectedHours: string | null; rateCents: number };
  offered_at: string; response_due_at: string; reminder_at: string;
  state: "pending" | "accepted" | "declined" | "revoked";
  responded_at: string | null; reason: string | null;
};
export async function readPriorityMoveApprovals(sourceJobId: string, cleanerId: string) {
  if (!assignmentExceptionsReady()) return [] as PriorityMoveApproval[];
  const result = await db.execute(sql`select a.* from phase3a_priority_move_approvals a join phase3a_priority_plans p on p.id=a.plan_id
    where p.donor_job_id=${sourceJobId}::uuid and a.cleaner_id=${cleanerId}::uuid order by a.offered_at desc limit 30`);
  return (Array.isArray(result) ? result : (result as { rows: PriorityMoveApproval[] }).rows) as PriorityMoveApproval[];
}
