import "server-only";

import { db } from "@/db";
import { cleaners, jobs, jobsToCleaners, notifications } from "@/db/schemas";
import { notifyCleaner } from "@/lib/services/notifications/notify";
import { and, eq, gt, lte, ne } from "drizzle-orm";

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
 * Idempotent per job: dedupes on an existing `job_reminder` notification for the
 * job (via the `notifications_type_job_idx` index), so it is safe to run on a
 * frequent schedule and a job is reminded once.
 */
export async function sendUpcomingJobReminders(
  now: Date = new Date()
): Promise<{ scanned: number; reminded: number; skipped: number }> {
  const windowEnd = new Date(now.getTime() + JOB_REMINDER_LEAD_MINUTES * 60_000);

  const upcoming = await db.query.jobs.findMany({
    where: and(
      eq(jobs.status, "assigned"),
      gt(jobs.checkInTime, now),
      lte(jobs.checkInTime, windowEnd)
    ),
    columns: { id: true, checkInTime: true },
    with: { property: { columns: { address: true } } },
  });

  let reminded = 0;
  let skipped = 0;

  for (const job of upcoming) {
    const alreadySent = await db.query.notifications.findFirst({
      where: and(
        eq(notifications.type, "job_reminder"),
        eq(notifications.jobId, job.id)
      ),
      columns: { id: true },
    });
    if (alreadySent) {
      skipped += 1;
      continue;
    }

    // Working cleaners only — a shadow backup does not need a T-60 ETA prompt.
    const assignments = await db.query.jobsToCleaners.findMany({
      where: and(
        eq(jobsToCleaners.jobId, job.id),
        ne(jobsToCleaners.role, "backup")
      ),
      columns: { cleanerId: true },
    });
    if (assignments.length === 0) {
      skipped += 1;
      continue;
    }

    const address = job.property?.address ?? "your assigned property";
    const when = formatEt(job.checkInTime);

    for (const a of assignments) {
      await notifyCleaner({
        cleanerId: a.cleanerId,
        type: "job_reminder",
        title: "Confirm your ETA",
        message: `Your clean at ${address} starts around ${when}. Tap to confirm your ETA or report a delay.`,
        jobId: job.id,
        url: `/cleaner/jobs/${job.id}`,
        sms: true, // time-critical (spec §4 "Log ETA now" nudge)
      });
    }
    reminded += 1;
  }

  return { scanned: upcoming.length, reminded, skipped };
}

/**
 * Task 1.20 — availability reminder (spec §2 / §16.2). Nudges every active
 * cleaner to submit availability for the next 2 weeks. Deduping is by schedule
 * (this runs on the Friday/Sunday pre-deadline cron), not per-run.
 */
export async function sendAvailabilityReminders(): Promise<{ reminded: number }> {
  const active = await db.query.cleaners.findMany({
    where: eq(cleaners.accountStatus, "active"),
    columns: { id: true },
  });

  for (const cleaner of active) {
    await notifyCleaner({
      cleanerId: cleaner.id,
      type: "availability_reminder",
      title: "Submit your availability",
      message:
        "Reminder: submit your availability for the next 2 weeks before Sunday 6 PM. Missed entries will limit the jobs you can be assigned.",
      url: "/cleaner/availability",
    });
  }

  return { reminded: active.length };
}
