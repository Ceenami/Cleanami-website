import "server-only";

import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { eq } from "drizzle-orm";

/** Annual raise (§7/§8/§13): +$0.50/hr/yr while reliability ≥95%, capped at $20/hr. */
export const RAISE_PER_YEAR_CENTS = 50;
export const RAISE_CAP_CENTS = 2000;
export const RAISE_MIN_RELIABILITY = 95;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type RaiseSummary = {
  reviewed: number;
  raised: number;
  details: Array<{ cleanerId: string; from: number; to: number }>;
};

/**
 * Evaluate anniversary raises for all cleaners. A cleaner is raised at most once
 * per year: when a full year has elapsed since their last review (or hire /
 * creation date) AND their reliability score is ≥95, up to the $20/hr cap.
 * Run on a schedule (e.g. daily) or via an admin action.
 */
export async function applyAnnualRaises(): Promise<RaiseSummary> {
  const now = new Date();
  const summary: RaiseSummary = { reviewed: 0, raised: 0, details: [] };

  const all = await db.query.cleaners.findMany({
    columns: {
      id: true,
      hourlyRateCents: true,
      hireDate: true,
      rateReviewedAt: true,
      reliabilityScore: true,
      createdAt: true,
    },
  });

  for (const c of all) {
    const anchor = c.rateReviewedAt
      ? new Date(c.rateReviewedAt)
      : c.hireDate
        ? new Date(c.hireDate)
        : new Date(c.createdAt);

    if (now.getTime() - anchor.getTime() < ONE_YEAR_MS) continue;
    summary.reviewed += 1;

    const score = parseFloat(c.reliabilityScore ?? "100");
    const today = now.toISOString().slice(0, 10);

    if (score >= RAISE_MIN_RELIABILITY && c.hourlyRateCents < RAISE_CAP_CENTS) {
      const to = Math.min(c.hourlyRateCents + RAISE_PER_YEAR_CENTS, RAISE_CAP_CENTS);
      await db
        .update(cleaners)
        .set({ hourlyRateCents: to, rateReviewedAt: today, updatedAt: now })
        .where(eq(cleaners.id, c.id));
      summary.raised += 1;
      summary.details.push({ cleanerId: c.id, from: c.hourlyRateCents, to });
    } else {
      // Missed this year's raise (below threshold or already capped); reset the
      // clock so the next evaluation is a year out.
      await db
        .update(cleaners)
        .set({ rateReviewedAt: today, updatedAt: now })
        .where(eq(cleaners.id, c.id));
    }
  }

  return summary;
}
