import "server-only";

import { db } from "@/db";
import { cleaners, reliabilityEvents } from "@/db/schemas";
import { and, eq, gte } from "drizzle-orm";

/** Rolling window (days) over which the reliability score is computed. */
export const RELIABILITY_WINDOW_DAYS = 90;

/**
 * Penalty points recorded on a late arrival, tiered by lateness. Informational
 * (the score itself is a honored/assigned ratio); mirrors the spec's tiers.
 */
export function latenessPenaltyPoints(delayMinutes: number): number {
  if (delayMinutes < 30) return 5;
  if (delayMinutes < 60) return 15;
  return 25;
}

export type ArrivalEventType = "on_time" | "early_arrival" | "late_arrival";

export function classifyArrival(
  delayMinutes: number,
  graceMinutes: number
): ArrivalEventType {
  if (delayMinutes < 0) return "early_arrival";
  if (delayMinutes <= graceMinutes) return "on_time";
  return "late_arrival";
}

/**
 * Record an arrival reliability event and recompute the cleaner's score.
 * Returns the event type recorded and the fresh score.
 */
export async function recordArrivalEvent(input: {
  cleanerId: string;
  jobId: string;
  delayMinutes: number;
  graceMinutes: number;
}): Promise<{ eventType: ArrivalEventType; score: number }> {
  const eventType = classifyArrival(input.delayMinutes, input.graceMinutes);
  const penaltyPoints =
    eventType === "late_arrival"
      ? latenessPenaltyPoints(input.delayMinutes)
      : 0;

  await db.insert(reliabilityEvents).values({
    cleanerId: input.cleanerId,
    jobId: input.jobId,
    eventType,
    penaltyPoints,
    notes:
      eventType === "late_arrival"
        ? `Arrived ${input.delayMinutes} min late`
        : eventType === "early_arrival"
          ? `Arrived ${Math.abs(input.delayMinutes)} min early`
          : "Arrived on time",
  });

  const score = await recomputeReliabilityScore(input.cleanerId);
  return { eventType, score };
}

/**
 * Reliability score = honored ÷ assigned × 100 over the rolling window, where
 * honored = on_time + early_arrival events. Defaults to 100 with no events.
 * Writes the result back to `cleaners.reliabilityScore` (previously never
 * recomputed). Returns the score.
 */
export async function recomputeReliabilityScore(
  cleanerId: string
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - RELIABILITY_WINDOW_DAYS);

  const events = await db
    .select({ eventType: reliabilityEvents.eventType })
    .from(reliabilityEvents)
    .where(
      and(
        eq(reliabilityEvents.cleanerId, cleanerId),
        gte(reliabilityEvents.createdAt, since)
      )
    );

  let score = 100;
  if (events.length > 0) {
    const honored = events.filter(
      (e) => e.eventType === "on_time" || e.eventType === "early_arrival"
    ).length;
    score = Math.round((honored / events.length) * 100);
  }

  await db
    .update(cleaners)
    .set({ reliabilityScore: score.toFixed(2), updatedAt: new Date() })
    .where(eq(cleaners.id, cleanerId));

  return score;
}
