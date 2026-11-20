const HOUR = 3_600_000;
export const ASSIGNMENT_ISSUES = ["all", "missing_confirmation", "coverage_incomplete", "response_overdue", "reconfirmation_overdue", "notification_attention", "arrival_overdue"] as const;
export type AssignmentIssue = typeof ASSIGNMENT_ISSUES[number];

/** Elapsed instants, never host calendar dates. Exact 24h/72h belong to the 2h tier. */
export function initialResponseWindowMs(leadMs: number): number {
  return leadMs > 72 * HOUR ? 12 * HOUR : leadMs >= 24 * HOUR ? 2 * HOUR : HOUR / 2;
}

/** Scope windows are maxima: an offer must not remain actionable after start. */
export function cappedResponseTimes(offeredAt: Date, plannedStart: Date) {
  const window = Math.max(0, Math.min(initialResponseWindowMs(+plannedStart - +offeredAt), +plannedStart - +offeredAt));
  return { dueAt: new Date(+offeredAt + window), reminderAt: new Date(+offeredAt + window / 2) };
}

export type Reconfirmation = {
  id: string; offer_id: string; schedule_version: number; planned_start: string;
  requested_at: string; reminder_at: string; escalate_at: string;
  state: "pending" | "confirmed" | "cannot_fulfill" | "revoked";
  responded_at: string | null;
};
export type LifecycleAction = {
  id: string; offer_id: string; reconfirmation_id: string | null; kind: string;
  occurred_at: string; dispatch_state: string; details: Record<string, unknown>;
};
