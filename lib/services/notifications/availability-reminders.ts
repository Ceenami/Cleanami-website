import "server-only";
import { db } from "@/db";
import {
  cleaners,
  cleanerAvailabilitySubmissions,
  reminderDeliveries,
} from "@/db/schemas";
import { and, eq, gte, lte } from "drizzle-orm";
import { getAvailabilityWindow } from "@/lib/cleaner/availability-deadline";
import { availabilityReminderStage } from "@/lib/scheduling/reminder-stage";
import { notifyCleaner } from "./notify";
import { sendTransactionalEmail } from "@/lib/services/email.service";
export async function sendStagedAvailabilityReminders(now = new Date()) {
  const stage = availabilityReminderStage(now);
  if (!stage) return { reminded: 0, skipped: 0 };
  const { period } = getAvailabilityWindow(now);
  const active = await db.query.cleaners.findMany({
    where: and(
      eq(cleaners.accountStatus, "active"),
      eq(cleaners.eligibleForAssignments, true),
    ),
    columns: { id: true, email: true, fullName: true },
  });
  const submissions = await db
    .select()
    .from(cleanerAvailabilitySubmissions)
    .where(
      and(
        lte(cleanerAvailabilitySubmissions.periodStart, period.start),
        gte(cleanerAvailabilitySubmissions.periodEnd, period.end),
      ),
    );
  const submitted = new Set(submissions.map((s) => s.cleanerId));
  let reminded = 0,
    skipped = 0;
  for (const cleaner of active) {
    if (submitted.has(cleaner.id)) {
      await db
        .insert(reminderDeliveries)
        .values({
          cleanerId: cleaner.id,
          periodStart: period.start,
          stage,
          status: "skipped",
          attempts: 0,
          error: "Acknowledgement already recorded",
        })
        .onConflictDoNothing();
      skipped++;
      continue;
    }
    const [claim] = await db
      .insert(reminderDeliveries)
      .values({
        cleanerId: cleaner.id,
        periodStart: period.start,
        stage,
        status: "sending",
        attempts: 1,
        claimedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!claim) {
      skipped++;
      continue;
    }
    const title =
      stage === "missed"
        ? "Availability deadline missed"
        : stage === "last_call"
          ? "Availability closes at 6 PM ET"
          : "Submit your availability";
    const message =
      stage === "missed"
        ? "Your first week is locked. You may still add available days; coverage is not assumed until you submit."
        : `Please confirm all fourteen dates for ${period.start}–${period.end}. The first week locks Sunday at 6 PM ET, including if all days are unavailable.`;
    try {
      // Dispatch claim is at-most-once; a crash in 'sending' needs manual review,
      // not automatic replay of an uncertain external send. Channel logs prove
      // actual accepted/skipped/failed outcomes; 'sent' means dispatch completed.
      await notifyCleaner({
        cleanerId: cleaner.id,
        type: "availability_reminder",
        title,
        message,
        url: "/cleaner/availability",
      });
      const email = await sendTransactionalEmail(
        cleaner.email,
        title,
        { heading: title, previewText: message, bodyLines: [message] },
        { trigger: `availability_${stage}`, recipient: cleaner.email },
      );
      await db
        .update(reminderDeliveries)
        .set({
          status: email.success ? "sent" : "failed",
          error: email.error ?? null,
          updatedAt: new Date(),
        })
        .where(eq(reminderDeliveries.id, claim.id));
      reminded++;
    } catch {
      await db
        .update(reminderDeliveries)
        .set({
          status: "failed",
          error: "Dispatch failed; inspect channel logs before retry",
          updatedAt: new Date(),
        })
        .where(eq(reminderDeliveries.id, claim.id));
    }
  }
  return { reminded, skipped };
}
