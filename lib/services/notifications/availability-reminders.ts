import "server-only";
import { db } from "@/db";
import {
  cleaners,
  cleanerAvailabilitySubmissions,
  reminderDeliveries,
} from "@/db/schemas";
import { and, eq, gte, lte } from "drizzle-orm";
import { getUpcomingAvailabilityWindow, availabilityGraceEnabled } from "@/lib/cleaner/availability-deadline";
import { availabilityReminderStage } from "@/lib/scheduling/reminder-stage";
import { notifyCleaner } from "./notify";
import { sendTransactionalEmail } from "@/lib/services/email.service";
import { getAppBaseUrl } from "@/lib/app-url";
export async function sendStagedAvailabilityReminders(now = new Date()) {
  const stage = availabilityReminderStage(now);
  if (!stage) return { reminded: 0, skipped: 0, failed: 0 };
  const { period } = getUpcomingAvailabilityWindow(now);
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
    skipped = 0,
    failed = 0;
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
        ? availabilityGraceEnabled() ? "The 7 PM ET grace period has ended. If you have not submitted, one catch-up is available for this 14-day block. Assigned coverage stays protected; no reliability or pay penalty applies." : "Your first week is locked. You may still add available days; coverage is not assumed until you submit."
        : `Please confirm all fourteen dates for ${period.start}–${period.end}. The deadline is Sunday at 6 PM ET${availabilityGraceEnabled() ? ", with grace until 7 PM ET" : ""}, including if all days are unavailable.`;
    const errors: string[] = [];
    try {
      // Dispatch claim is at-most-once; a crash in 'sending' needs manual review,
      // not automatic replay of an uncertain external send. Channel logs prove
      // actual accepted/skipped/failed outcomes; 'sent' means dispatch completed.
      await notifyCleaner({
        cleanerId: cleaner.id,
        type: "availability_reminder",
        title,
        message,
        url: `/cleaner/availability?periodStart=${period.start}`,
        // New SMS cadence is confirmed only for the three pre-deadline stages.
        sms: stage !== "missed",
        metadata: { periodStart: period.start, stage },
      });
    } catch {
      errors.push("Cleaner dispatch failed; inspect channel logs before retry");
    }
    // Email is independent: inbox/push/SMS failures must not suppress it.
    try {
      const email = await sendTransactionalEmail(
        cleaner.email,
        title,
        {
          heading: title,
          previewText: message,
          bodyLines: [message],
          ctaLabel: "Submit availability",
          ctaUrl: `${getAppBaseUrl()}/cleaner/availability?periodStart=${period.start}`,
        },
        { trigger: `availability_${stage}`, recipient: cleaner.email },
      );
      if (!email.success) errors.push(email.error ?? "Email dispatch failed");
    } catch {
      errors.push("Email dispatch failed; inspect channel logs before retry");
    }
    await db
      .update(reminderDeliveries)
      .set({
        status: errors.length ? "failed" : "sent",
        error: errors.length ? errors.join("; ") : null,
        updatedAt: new Date(),
      })
      .where(eq(reminderDeliveries.id, claim.id));
    if (errors.length) failed++;
    else reminded++;
  }
  return { reminded, skipped, failed };
}
