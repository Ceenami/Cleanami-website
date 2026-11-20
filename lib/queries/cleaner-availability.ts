import "server-only";
import { db } from "@/db";
import {
  availability,
  availabilityDays,
  cleanerAvailabilitySubmissions,
  jobs,
  jobsToCleaners,
  phase2cAudit,
} from "@/db/schemas";
import { and, eq, gte, lte, inArray, ne, sql } from "drizzle-orm";
import {
  getAvailabilityWindow,
  resolveAvailabilityWindow,
  formatDayLabel,
  dateAvailabilityLocked,
  easternToday,
  type AvailabilityPeriod,
  availabilityGraceEnabled,
  availabilitySubmissionPhase,
} from "@/lib/cleaner/availability-deadline";
import {
  assertAvailabilityChange,
  availabilityDaySchema,
} from "@/lib/scheduling/availability-policy";
export type AvailabilityDayInput = {
  date: string;
  isAvailable: boolean;
  onCallEligible: boolean;
  openPoolEligible?: boolean;
  revision?: number;
};
export type AvailabilityPreferenceInput = {
  date: string;
  onCallEligible: boolean;
  openPoolEligible: boolean;
  revision?: number;
};
export type AvailabilityDayState = AvailabilityDayInput & {
  label: string;
  openPoolEligible: boolean;
  locked: boolean;
  assigned: boolean;
  late: boolean;
  revision: number;
  acknowledged: boolean;
};
export async function countCleanerAvailabilityInPeriod(
  cleanerId: string,
  period: AvailabilityPeriod,
) {
  const rows = await db
    .select()
    .from(cleanerAvailabilitySubmissions)
    .where(
      and(
        eq(cleanerAvailabilitySubmissions.cleanerId, cleanerId),
        lte(cleanerAvailabilitySubmissions.periodStart, period.start),
        gte(cleanerAvailabilitySubmissions.periodEnd, period.end),
      ),
    );
  return rows.length;
}
export async function getCleanerAvailability(
  cleanerId: string,
  periodStart?: string | null,
) {
  const window = resolveAvailabilityWindow(periodStart);
  const rows = await db
    .select()
    .from(availabilityDays)
    .where(
      and(
        eq(availabilityDays.cleanerId, cleanerId),
        gte(availabilityDays.date, window.period.start),
        lte(availabilityDays.date, window.period.end),
      ),
    );
  const legacy = await db
    .select()
    .from(availability)
    .where(
      and(
        eq(availability.cleanerId, cleanerId),
        gte(availability.date, window.period.start),
        lte(availability.date, window.period.end),
      ),
    );
  const assigned = await db
    .select({
      date: sql<string>`(${jobs.checkInTime} at time zone 'America/New_York')::date::text`,
    })
    .from(jobsToCleaners)
    .innerJoin(jobs, eq(jobs.id, jobsToCleaners.jobId))
    .where(
      and(
        eq(jobsToCleaners.cleanerId, cleanerId),
        inArray(jobsToCleaners.role, ["primary", "laundry_lead"]),
        ne(jobs.status, "canceled"),
      ),
    );
  const assignedDates = new Set(assigned.map((r) => r.date));
  const gracePolicy = availabilityGraceEnabled();
  const phase = availabilitySubmissionPhase(window.period.start);
  const [acknowledgement] = gracePolicy ? await db.select().from(cleanerAvailabilitySubmissions).where(and(eq(cleanerAvailabilitySubmissions.cleanerId, cleanerId), eq(cleanerAvailabilitySubmissions.periodStart, window.period.start))) : [];
  const catchUp = gracePolicy && phase.catchUp && !acknowledgement;
  const message = gracePolicy
    ? "Sunday deadline: 6 PM ET, with grace until 7 PM. After grace, one catch-up submission is available per 14-day block. Assigned coverage stays protected. Availability timing does not affect reliability or pay."
    : "Weeks lock Sunday at 6 PM ET. Locked dates permit positive additions only; assigned coverage cannot be removed.";
  return {
    ...window,
    ...(gracePolicy ? { displayMode: catchUp ? "override" as const : "submit" as const,
      deadline: { ...window.deadline, canSubmitRegular: !phase.catchUp || !!acknowledgement } } : {}),
    days: window.period.dates.map((date) => {
      const row = rows.find((r) => r.date === date),
        old = legacy.find((r) => r.date === date);
      return {
        date,
        label: formatDayLabel(date),
        isAvailable: row?.isAvailable ?? !!old,
        onCallEligible: row?.onCallEligible ?? old?.onCallEligible ?? false,
        openPoolEligible:
          row?.openPoolEligible ?? old?.openPoolEligible ?? false,
        revision: row?.revision ?? 0,
        acknowledged: !!row,
        locked:
          assignedDates.has(date) ||
          (dateAvailabilityLocked(date) && !(gracePolicy && (phase.grace || catchUp)) &&
            !(row?.reopenedUntil && row.reopenedUntil > new Date())),
        assigned: assignedDates.has(date),
        late: row?.late ?? false,
      };
    }),
    closedMessage: message,
    canLateOverride: catchUp,
    overrideMessage: catchUp ? "This is your one catch-up submission for this 14-day block. Later edits retain the normal weekly locks and positive-addition rules." : null,
  };
}
export async function saveCleanerAvailability(
  cleanerId: string,
  inputs: AvailabilityDayInput[],
  options?: {
    actorId?: string;
    period?: AvailabilityPeriod;
    additionsOnly?: boolean;
    lateCatchUp?: boolean;
    /** Set only by the authenticated admin edit route. Does not acknowledge a fortnight. */
    adminEditReason?: string;
  },
) {
  const period = options?.period ?? getAvailabilityWindow().period,
    now = new Date();
  const days = inputs.map((d) => availabilityDaySchema.parse(d));
  if (
    (options?.adminEditReason
      ? days.length !== 1
      : days.length !== period.dates.length) ||
    new Set(days.map((d) => d.date)).size !== days.length ||
    days.some((d) => !period.dates.includes(d.date))
  )
    throw new Error("Submit exactly the fourteen displayed dates");
  await db.transaction(async (tx) => {
    const gracePolicy = availabilityGraceEnabled();
    const phase = availabilitySubmissionPhase(period.start, now);
    // One serial acknowledgement is the durable allowance; a rolled-back save consumes nothing.
    if (gracePolicy) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`availability:${cleanerId}:${period.start}`},0))`);
    const [ack] = gracePolicy ? await tx.select().from(cleanerAvailabilitySubmissions).where(and(eq(cleanerAvailabilitySubmissions.cleanerId, cleanerId), eq(cleanerAvailabilitySubmissions.periodStart, period.start))) : [];
    const catchUp = gracePolicy && phase.catchUp && !ack && !options?.adminEditReason && !options?.additionsOnly;
    if (gracePolicy && options?.lateCatchUp && (!phase.catchUp || ack)) throw new Error("The catch-up allowance is unavailable or already used. Reload availability for ordinary edits.");
    for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date)))
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`cleaner:${cleanerId}:${day.date}`},0))`,
      );
    for (const day of days) {
      const [row] = await tx
        .select()
        .from(availabilityDays)
        .where(
          and(
            eq(availabilityDays.cleanerId, cleanerId),
            eq(availabilityDays.date, day.date),
          ),
        );
      if (row && day.revision === undefined)
        throw new Error(
          "Version required: reload or update your app before saving",
        );
      if (day.revision !== undefined && day.revision !== (row?.revision ?? 0))
        throw new Error("Version conflict: reload availability before saving");
      const old = await tx.query.availability.findFirst({
        where: and(
          eq(availability.cleanerId, cleanerId),
          eq(availability.date, day.date),
        ),
      });
      const before = {
        isAvailable: row?.isAvailable ?? !!old,
        onCallEligible: row?.onCallEligible ?? old?.onCallEligible ?? false,
        openPoolEligible:
          row?.openPoolEligible ?? old?.openPoolEligible ?? false,
      };
      const assignments = await tx
        .select({ id: jobs.id })
        .from(jobsToCleaners)
        .innerJoin(jobs, eq(jobs.id, jobsToCleaners.jobId))
        .where(
          and(
            eq(jobsToCleaners.cleanerId, cleanerId),
            inArray(jobsToCleaners.role, ["primary", "laundry_lead"]),
            ne(jobs.status, "canceled"),
            sql`(${jobs.checkInTime} at time zone 'America/New_York')::date=${day.date}::date`,
          ),
        )
        .limit(1);
      const after = {
        isAvailable: day.isAvailable,
        onCallEligible: day.onCallEligible,
        openPoolEligible: day.openPoolEligible,
      };
      if (
        options?.additionsOnly &&
        ((before.isAvailable && !after.isAvailable) ||
          (before.onCallEligible && !after.onCallEligible) ||
          (before.openPoolEligible && !after.openPoolEligible))
      )
        throw new Error(
          "Positive additions cannot remove existing availability or pool opt-ins",
        );
      const change = assertAvailabilityChange({
        date: day.date,
        before,
        after,
        assigned: assignments.length > 0,
        reopened:
          !!options?.adminEditReason ||
          (gracePolicy && (phase.grace || catchUp)) ||
          (!!row?.reopenedUntil && row.reopenedUntil > now),
        now,
      });
      const late = gracePolicy && phase.grace ? false : change.late;
      if (day.date < easternToday(now)) continue;
      await tx
        .insert(availabilityDays)
        .values({
          cleanerId,
          date: day.date,
          ...after,
          revision: (row?.revision ?? 0) + 1,
          late: row?.late || late,
          actorId: options?.actorId ?? cleanerId,
        })
        .onConflictDoUpdate({
          target: [availabilityDays.cleanerId, availabilityDays.date],
          set: {
            ...after,
            revision: (row?.revision ?? 0) + 1,
            late: row?.late || late,
            actorId: options?.actorId ?? cleanerId,
            updatedAt: now,
          },
        });
      await tx
        .delete(availability)
        .where(
          and(
            eq(availability.cleanerId, cleanerId),
            eq(availability.date, day.date),
          ),
        );
      if (day.isAvailable)
        await tx.insert(availability).values({
          cleanerId,
          date: day.date,
          availabilityType: "vacation_rental",
          startTime: "09:00:00",
          endTime: "16:00:00",
          onCallEligible: day.onCallEligible,
          openPoolEligible: day.openPoolEligible,
          isGracePeriod: gracePolicy ? phase.grace : late,
          submissionStatus: late ? "late_accepted" : "on_time",
          submittedAt: now,
        });
      await tx.insert(phase2cAudit).values({
        subjectId: cleanerId,
        kind: options?.adminEditReason
          ? "availability_admin_edit"
          : late
            ? "availability_late_addition"
            : "availability_day",
        actorId: options?.actorId ?? cleanerId,
        payload: {
          date: day.date,
          before,
          after,
          late,
          revision: (row?.revision ?? 0) + 1,
          reason: options?.adminEditReason ?? null,
          action: options?.additionsOnly
            ? "positive_addition"
            : "availability_save",
        },
      });
    }
    if (options?.adminEditReason) return;
    await tx
      .insert(cleanerAvailabilitySubmissions)
      .values({
        cleanerId,
        periodStart: period.start,
        periodEnd: period.end,
        submissionMode: gracePolicy ? (phase.catchUp && !ack ? "override" : "full") : dateAvailabilityLocked(period.start, now)
          ? "override"
          : "full",
        firstSubmittedAt: now,
        lastUpdatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          cleanerAvailabilitySubmissions.cleanerId,
          cleanerAvailabilitySubmissions.periodStart,
        ],
        set: { periodEnd: period.end, lastUpdatedAt: now },
      });
  });
  return { period };
}
export async function saveCleanerAvailabilityPreferences(
  cleanerId: string,
  preferences: AvailabilityPreferenceInput[],
  periodStart?: string | null,
) {
  const current = await getCleanerAvailability(cleanerId, periodStart);
  const dates = new Set(preferences.map((p) => p.date));
  if (
    dates.size !== preferences.length ||
    preferences.some((p) => !current.period.dates.includes(p.date))
  )
    throw new Error("Invalid preference dates");
  for (const preference of preferences) {
    const day = current.days.find((d) => d.date === preference.date)!;
    if (preference.revision === undefined)
      throw new Error("Version required: reload before updating preferences");
    if (preference.revision !== day.revision)
      throw new Error("Version conflict: reload availability before saving");
  }
  return saveCleanerAvailability(
    cleanerId,
    current.days
      .map((d) => ({ ...d, ...preferences.find((p) => p.date === d.date) }))
      .map(
        ({
          date,
          isAvailable,
          onCallEligible,
          openPoolEligible,
          revision,
        }) => ({
          date,
          isAvailable,
          onCallEligible,
          openPoolEligible,
          revision,
        }),
      ),
    { period: resolveAvailabilityWindow(periodStart).period },
  );
}
export async function saveCleanerLateOverrideAvailability(
  cleanerId: string,
  days: AvailabilityDayInput[],
  period: AvailabilityPeriod,
) {
  return saveCleanerAvailability(cleanerId, days, { period, lateCatchUp: availabilityGraceEnabled() });
}
