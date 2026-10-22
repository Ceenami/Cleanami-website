import "server-only";
import { createHash } from "node:crypto";
import { db, type Database } from "@/db";
import {
  cleaners,
  evidencePackets,
  evidenceUploadManifest,
  jobEvidenceDrafts,
  jobScheduleRevisions,
  jobScheduleNotices,
  jobs,
  jobsToCleaners,
  notifications,
  properties,
} from "@/db/schemas";
import { and, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import * as ical from "node-ical";
import { getEventCompositeUid } from "./iCal/ical.service";
import {
  normalizedPropertyTimes,
  planPropertySchedules,
  type CalendarScheduleEntry,
  type PropertyTimes,
  type SchedulePlan,
} from "@/lib/jobs/property-schedule";
import { sendPushToCleaner } from "./push.service";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Property = typeof properties.$inferSelect;
export class ScheduleUpdateError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

async function calendarEntries(
  url: string | null,
): Promise<Map<string, CalendarScheduleEntry>> {
  if (!url)
    throw new ScheduleUpdateError(
      "This property needs a calendar URL before its upcoming calendar bookings can be updated.",
    );
  let raw: string;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (
      !response.ok ||
      Number(response.headers.get("content-length")) > 2 * 1024 * 1024
    )
      throw new Error("Calendar unavailable");
    // Bound streamed feeds as well as responses with a Content-Length header.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty calendar response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) throw new Error("Calendar too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    raw = Buffer.concat(chunks).toString("utf8");
    if (!raw.includes("BEGIN:VCALENDAR")) throw new Error("Invalid calendar");
  } catch {
    throw new ScheduleUpdateError(
      "The property calendar could not be verified. Nothing was changed; try again when the calendar is available.",
    );
  }
  try {
    const events = Object.values(await ical.async.parseICS(raw))
      .filter((entry): entry is ical.VEvent => entry.type === "VEVENT")
      .sort((a, b) => +a.start - +b.start);
    const result = new Map<string, CalendarScheduleEntry>();
    for (const [index, event] of events.entries()) {
      const key = getEventCompositeUid(event);
      if (result.has(key)) throw new Error("Ambiguous calendar event");
      result.set(key, { event, next: events[index + 1] });
    }
    return result;
  } catch {
    throw new ScheduleUpdateError(
      "The calendar contains invalid or ambiguous bookings. Nothing was changed; review the calendar first.",
    );
  }
}

async function snapshot(
  database: Database | Tx,
  propertyId: string,
  now: Date,
  lock = false,
) {
  const query = database
    .select()
    .from(jobs)
    .where(and(eq(jobs.propertyId, propertyId), gt(jobs.checkInTime, now)))
    .orderBy(jobs.id);
  const rows = lock ? await query.for("update") : await query;
  if (!rows.length) return { candidates: [], overrides: new Set<string>() };
  const ids = rows.map((j) => j.id);
  // Pooler-safe: every database query is awaited sequentially.
  const packets = await database
    .select()
    .from(evidencePackets)
    .where(inArray(evidencePackets.jobId, ids));
  const uploads = await database
    .select({ jobId: evidenceUploadManifest.jobId })
    .from(evidenceUploadManifest)
    .where(
      and(
        inArray(evidenceUploadManifest.jobId, ids),
        ne(evidenceUploadManifest.state, "removed"),
      ),
    );
  const drafts = await database
    .select()
    .from(jobEvidenceDrafts)
    .where(inArray(jobEvidenceDrafts.jobId, ids));
  const overridden = await database
    .select({ jobId: jobScheduleRevisions.jobId })
    .from(jobScheduleRevisions)
    .where(
      and(
        inArray(jobScheduleRevisions.jobId, ids),
        eq(jobScheduleRevisions.source, "manual"),
      ),
    );
  const evidence = new Set([
    ...packets
      .filter(
        (p) =>
          p.gpsCheckInTimestamp ||
          p.gpsCheckOutTimestamp ||
          p.finalEvidenceSubmittedAt ||
          p.isChecklistComplete ||
          p.photoUrls?.length,
      )
      .map((p) => p.jobId),
    ...uploads.map((u) => u.jobId),
    ...drafts
      .filter((d) => d.notes || d.items.some((item) => item.completed))
      .map((d) => d.jobId),
  ]);
  return {
    candidates: rows.map((j) => ({ ...j, hasEvidence: evidence.has(j.id) })),
    overrides: new Set(overridden.map((r) => r.jobId)),
  };
}

function token(property: Property, plan: SchedulePlan) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        propertyId: property.id,
        customerId: property.customerId,
        updatedAt: property.updatedAt,
        times: [property.defaultCheckInTime, property.defaultCheckOutTime],
        url: property.iCalUrl,
        plan,
      }),
    )
    .digest("hex");
}
export async function preparePropertySchedule(
  property: Property,
  after: PropertyTimes = property,
) {
  const times = normalizedPropertyTimes(after);
  if (times.defaultCheckOutTime >= times.defaultCheckInTime)
    throw new ScheduleUpdateError(
      "Default guest check-in must be later than guest check-out on the same day, leaving time for cleaning.",
    );
  const now = new Date();
  const current = await snapshot(db, property.id, now);
  const needsFeed = current.candidates.some(
    (j) =>
      j.jobSource === "ical" &&
      j.serviceType === "vacation_rental_subscription" &&
      ["assigned", "unassigned"].includes(j.status ?? "") &&
      !j.hasEvidence &&
      !current.overrides.has(j.id),
  );
  const calendar = needsFeed
    ? await calendarEntries(property.iCalUrl)
    : new Map<string, CalendarScheduleEntry>();
  let plan: SchedulePlan;
  try {
    plan = planPropertySchedules({
      before: property,
      after,
      jobs: current.candidates,
      overrides: current.overrides,
      calendar,
      now,
    });
  } catch (error) {
    throw new ScheduleUpdateError(
      error instanceof Error
        ? error.message
        : "The booking schedule needs review.",
    );
  }
  return { plan, token: token(property, plan), calendar, after };
}

/** Geocoding and calendar I/O happen before this call. Lock order: property -> jobs -> cleaners. */
export async function savePropertySchedule(input: {
  property: Property;
  patch: Partial<typeof properties.$inferInsert>;
  prepared: Awaited<ReturnType<typeof preparePropertySchedule>>;
  actor: string;
}) {
  const { property, patch, prepared, actor } = input;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
      const [fresh] = await tx
        .select()
        .from(properties)
        .where(eq(properties.id, property.id))
        .for("no key update");
      if (
        !fresh ||
        fresh.customerId !== property.customerId ||
        fresh.updatedAt.getTime() !== property.updatedAt.getTime() ||
        fresh.iCalUrl !== property.iCalUrl ||
        fresh.defaultCheckInTime !== property.defaultCheckInTime ||
        fresh.defaultCheckOutTime !== property.defaultCheckOutTime
      )
        throw new ScheduleUpdateError(
          "The property changed while its bookings were checked. Refresh and save again.",
        );
      const now = new Date();
      const current = await snapshot(tx, property.id, now, true);
      let plan: SchedulePlan;
      try {
        plan = planPropertySchedules({
          before: fresh,
          after: prepared.after,
          jobs: current.candidates,
          overrides: current.overrides,
          calendar: prepared.calendar,
          now,
        });
      } catch (error) {
        throw new ScheduleUpdateError(
          error instanceof Error
            ? error.message
            : "The booking schedule needs review.",
        );
      }
      if (token(fresh, plan) !== prepared.token)
        throw new ScheduleUpdateError(
          "A booking changed while its schedule was checked. Refresh the preview and try again.",
        );
      const ids = plan.changes.map((c) => c.jobId);
      const assignments = ids.length
        ? await tx
            .select()
            .from(jobsToCleaners)
            .where(inArray(jobsToCleaners.jobId, ids))
        : [];
      const cleanerIds = [
        ...new Set(
          assignments
            .filter((a) => a.role !== "backup")
            .map((a) => a.cleanerId),
        ),
      ].sort();
      const workers = cleanerIds.length
        ? await tx
            .select({ id: cleaners.id, userId: cleaners.userId })
            .from(cleaners)
            .where(inArray(cleaners.id, cleanerIds))
            .orderBy(cleaners.id)
            .for("update")
        : [];
      const working = cleanerIds.length
        ? await tx
            .select({ job: jobs, cleanerId: jobsToCleaners.cleanerId })
            .from(jobsToCleaners)
            .innerJoin(jobs, eq(jobs.id, jobsToCleaners.jobId))
            .where(
              and(
                inArray(jobsToCleaners.cleanerId, cleanerIds),
                ne(jobsToCleaners.role, "backup"),
                ne(jobs.status, "canceled"),
                ne(jobs.status, "completed"),
              ),
            )
        : [];
      const proposed = new Map(plan.changes.map((c) => [c.jobId, c]));
      for (const change of plan.changes) {
        const start = Date.parse(change.start),
          end = start + Number(change.expectedHours) * 3600000;
        for (const assignment of assignments.filter(
          (a) => a.jobId === change.jobId && a.role !== "backup",
        )) {
          const conflict = working.find((other) => {
            if (
              other.cleanerId !== assignment.cleanerId ||
              other.job.id === change.jobId ||
              !other.job.checkInTime
            )
              return false;
            const otherStart = proposed.has(other.job.id)
              ? Date.parse(proposed.get(other.job.id)!.start)
              : +other.job.checkInTime;
            const hours = Number(other.job.expectedHours);
            return (
              otherStart < end &&
              otherStart + (hours > 0 ? hours : 4) * 3600000 > start
            );
          });
          if (conflict)
            throw new ScheduleUpdateError(
              `Booking ${change.jobId} would overlap another booking for its assigned cleaner. Review the assignment before changing the property times.`,
            );
        }
      }
      await tx
        .update(properties)
        .set(patch)
        .where(eq(properties.id, property.id));
      for (const change of plan.changes) {
        // Inserting the revision validates and applies its times through a trigger.
        const [revision] = await tx
          .insert(jobScheduleRevisions)
          .values({
            jobId: change.jobId,
            source: "property_defaults",
            beforeStart: new Date(change.beforeStart),
            beforeDeadline: new Date(change.beforeDeadline),
            plannedStart: new Date(change.start),
            plannedDeadline: new Date(change.deadline),
            actor,
          })
          .returning();
        // Keep old reminders tied to their original start so the new start can be reminded.
        await tx
          .update(notifications)
          .set({
            metadata: sql`coalesce(${notifications.metadata},'{}'::jsonb) || jsonb_build_object('scheduleStart',${change.beforeStart}::text)`,
          })
          .where(
            and(
              eq(notifications.jobId, change.jobId),
              eq(notifications.type, "job_reminder"),
              sql`${notifications.metadata}->>'source' = 'notify' AND ${notifications.metadata}->>'scheduleStart' IS NULL`,
            ),
          );
        const when = (value: string) =>
          new Date(value).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "America/New_York",
          });
        const title = "Booking time updated";
        const message = `Your clean at ${fresh.address} has changed from ${when(change.beforeStart)} to ${when(change.start)} Eastern. Finish by ${when(change.deadline)} Eastern.`;
        for (const assignment of assignments.filter(
          (a) => a.jobId === change.jobId,
        )) {
          const worker = workers.find((w) => w.id === assignment.cleanerId);
          // Backups are notified too, but never counted as working conflicts.
          const userId =
            worker?.userId ??
            (
              await tx
                .select({ userId: cleaners.userId })
                .from(cleaners)
                .where(eq(cleaners.id, assignment.cleanerId))
            )[0]?.userId;
          if (userId) {
            await tx.insert(notifications).values({
              userId,
              jobId: change.jobId,
              type: "assignment",
              title,
              message,
              metadata: {
                source: "property_schedule",
                revisionId: revision.id,
              },
            });
            await tx.insert(jobScheduleNotices).values({
              revisionId: revision.id,
              cleanerId: assignment.cleanerId,
              userId,
              title,
              message,
            });
          }
        }
      }
      return {
        propertyId: property.id,
        updatedBookings: plan.changes.length,
        preservedBookings: plan.preserved.length,
      };
    });
  } catch (error) {
    if (error instanceof ScheduleUpdateError) throw error;
    console.error("[property schedule] Transaction rolled back", error);
    throw new ScheduleUpdateError(
      "The bookings could not be safely rescheduled. Nothing was saved; refresh and try again.",
    );
  }
}

/** Durable in-app notices commit with schedules; this retryable fan-out runs without booking locks. */
export async function sendPendingScheduleNotices() {
  const expired = new Date(Date.now() - 5 * 60000);
  const available = and(
    isNull(jobScheduleNotices.sentAt),
    or(
      isNull(jobScheduleNotices.claimedAt),
      lt(jobScheduleNotices.claimedAt, expired),
    ),
  );
  const pending = await db
    .select()
    .from(jobScheduleNotices)
    .where(available)
    .orderBy(jobScheduleNotices.createdAt)
    .limit(100);
  for (const notice of pending) {
    const claimedAt = new Date();
    const [claimed] = await db
      .update(jobScheduleNotices)
      .set({ claimedAt })
      .where(and(eq(jobScheduleNotices.id, notice.id), available))
      .returning();
    if (!claimed) continue;
    try {
      const [revision] = await db
        .select()
        .from(jobScheduleRevisions)
        .where(eq(jobScheduleRevisions.id, claimed.revisionId));
      const [recipient] = await db
        .select({ userId: cleaners.userId })
        .from(cleaners)
        .where(eq(cleaners.id, claimed.cleanerId));
      const [assignment] = revision
        ? await db
            .select()
            .from(jobsToCleaners)
            .where(
              and(
                eq(jobsToCleaners.jobId, revision.jobId),
                eq(jobsToCleaners.cleanerId, claimed.cleanerId),
              ),
            )
        : [];
      if (recipient?.userId === claimed.userId && assignment)
        await sendPushToCleaner(
          claimed.cleanerId,
          {
            title: claimed.title,
            body: claimed.message,
            url: `/cleaner/jobs/${revision.jobId}`,
          },
          { trigger: "property_schedule", jobId: revision.jobId },
          { throwOnFailure: true },
        );
      await db
        .update(jobScheduleNotices)
        .set({ sentAt: new Date() })
        .where(
          and(
            eq(jobScheduleNotices.id, claimed.id),
            eq(jobScheduleNotices.claimedAt, claimedAt),
          ),
        );
    } catch {
      /* Leave pending for the scheduled job-reminders worker after the claim expires. */
    }
  }
}
