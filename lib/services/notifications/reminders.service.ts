import "server-only";

import { db } from "@/db";
import { jobs, jobsToCleaners, notifications } from "@/db/schemas";
import { notifyCleaner } from "@/lib/services/notifications/notify";
import { getCleanerUserId } from "@/lib/queries/cleaner-notifications";
import { sendStagedAvailabilityReminders } from "./availability-reminders";
import { and, eq, gt, lte, ne, sql } from "drizzle-orm";

/** Window ahead of the scheduled start in which the T-60 reminder fires. */
const JOB_REMINDER_LEAD_MINUTES = 60;

function formatEt(date: Date | null): string {
  if (!date) return "soon";
  return date.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

/**
 * Task 1.20 — upcoming-job reminder (spec §16.2 "Pre-Arrival ETA Prompt", ~1h
 * before arrival). Notifies each working cleaner (not shadow backups) of a job
 * whose scheduled start is within the next hour.
 *
 * Idempotent per recipient and scheduled start: dedupes on existing reminders
 * for each working cleaner, so a partial dispatch does not suppress the team on a
 * frequent schedule and a job is reminded once.
 */
export async function sendUpcomingJobReminders(
  now: Date = new Date(),
): Promise<{ scanned: number; reminded: number; skipped: number }> {
  const windowEnd = new Date(
    now.getTime() + JOB_REMINDER_LEAD_MINUTES * 60_000,
  );

  const upcoming = await db.query.jobs.findMany({
    where: and(
      eq(jobs.status, "assigned"),
      gt(jobs.checkInTime, now),
      lte(jobs.checkInTime, windowEnd),
    ),
    columns: { id: true, checkInTime: true },
    with: { property: { columns: { address: true } } },
  });

  let reminded = 0;
  let skipped = 0;
  const failures: unknown[] = [];

  for (const job of upcoming) {
    // Working cleaners only — a shadow backup does not need a T-60 ETA prompt.
    const assignments = await db.query.jobsToCleaners.findMany({
      where: and(eq(jobsToCleaners.jobId, job.id), ne(jobsToCleaners.role, "backup")),
      columns: { cleanerId: true },
    });
    let sentForJob = false;
    for (const cleanerId of new Set(assignments.map((a) => a.cleanerId))) {
      try {
        const userId = await getCleanerUserId(cleanerId);
        if (!userId) continue;
        // Scoped to rows this function itself created (`notifyCleaner` stamps
        // `metadata.source = "notify"`). A legacy DB trigger used to write
        // untagged `job_reminder` rows immediately on job creation; matching on
        // type + jobId alone would treat those as "already sent" and permanently
        // block the real T-60 reminder for that job.
        const alreadySent = await db.query.notifications.findFirst({
          where: and(
            eq(notifications.type, "job_reminder"),
            eq(notifications.jobId, job.id),
            eq(notifications.userId, userId),
            sql`${notifications.metadata}->>'source' = 'notify'`,
            // An old reminder must not suppress the reminder for a revised start.
            // Untagged pre-upgrade reminders remain valid until a schedule changes.
            sql`(${notifications.metadata}->>'scheduleStart' = ${job.checkInTime!.toISOString()} OR ${notifications.metadata}->>'scheduleStart' IS NULL)`
          ),
          columns: { id: true },
        });
        if (alreadySent) {
          continue;
        }

        const address = job.property?.address ?? "your assigned property";
        const when = formatEt(job.checkInTime);

        await notifyCleaner({
          cleanerId,
          type: "job_reminder",
          title: "Confirm your ETA",
          message: `Your clean at ${address} starts around ${when}. Tap to confirm your ETA or report a delay.`,
          jobId: job.id,
          url: `/cleaner/jobs/${job.id}`,
          sms: true, // time-critical (spec §4 "Log ETA now" nudge)
          metadata: { scheduleStart: job.checkInTime!.toISOString() },
        });
        sentForJob = true;
      } catch (error) {
        failures.push(error);
        console.error("[job-reminders] recipient dispatch failed:", error);
      }
    }
    if (sentForJob) reminded += 1;
    else skipped += 1;
  }

  if (failures.length) throw new AggregateError(failures, "Some job reminders failed");
  return { scanned: upcoming.length, reminded, skipped };
}

/**
 * Task 1.20 — availability reminder (spec §2 / §16.2). Nudges every active
 * cleaner to submit availability for the next 2 weeks. Deduping is by schedule
 * (this runs on the Friday/Sunday pre-deadline cron), not per-run.
 */
export async function sendAvailabilityReminders(): Promise<{
  reminded: number;
}> {
  return sendStagedAvailabilityReminders();
}
