import "server-only";

import { db } from "@/db";
import {
  availability,
  cleanerAvailabilitySubmissions,
  cleaners,
} from "@/db/schemas";
import {
  formatDayLabel,
  getAvailabilityWindow,
  getMissedPeriodForOverride,
  getSubmissionClosedMessage,
  type AvailabilityDisplayMode,
  type AvailabilityPeriod,
} from "@/lib/cleaner/availability-deadline";
import {
  getTodayEtIso,
  resolveAvailabilityOverrideState,
} from "@/lib/cleaner/availability-override";
import { and, eq, gte, lte } from "drizzle-orm";

export type AvailabilityDayInput = {
  date: string;
  isAvailable: boolean;
  onCallEligible: boolean;
  openPoolEligible?: boolean;
};

export type AvailabilityPreferenceInput = {
  date: string;
  onCallEligible: boolean;
  openPoolEligible: boolean;
};

export type AvailabilityDayState = {
  date: string;
  label: string;
  isAvailable: boolean;
  onCallEligible: boolean;
  openPoolEligible: boolean;
};

const DEFAULT_START = "08:00:00";
const DEFAULT_END = "20:00:00";

function filterDaysForDisplay(
  days: AvailabilityDayState[],
  input: {
    displayMode: AvailabilityDisplayMode;
    canLateOverride: boolean;
    canSubmitRegular: boolean;
  }
): AvailabilityDayState[] {
  const today = getTodayEtIso();

  if (input.displayMode === "override") {
    return days;
  }

  if (input.displayMode === "locked" && !input.canSubmitRegular) {
    return days.filter((day) => day.date >= today);
  }

  return days;
}

export async function countCleanerAvailabilityInPeriod(
  cleanerId: string,
  period: AvailabilityPeriod
): Promise<number> {
  const rows = await db.query.availability.findMany({
    where: and(
      eq(availability.cleanerId, cleanerId),
      gte(availability.date, period.start),
      lte(availability.date, period.end)
    ),
    columns: { id: true },
  });

  return rows.length;
}

async function getCleanerOverrideTracking(cleanerId: string): Promise<{
  lateOverridePeriodStart: string | null;
}> {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    columns: { availabilityLateOverridePeriodStart: true },
  });

  return {
    lateOverridePeriodStart:
      cleaner?.availabilityLateOverridePeriodStart ?? null,
  };
}

export async function getCleanerAvailability(
  cleanerId: string
): Promise<{
  period: AvailabilityPeriod;
  days: AvailabilityDayState[];
  deadline: ReturnType<typeof getAvailabilityWindow>["deadline"];
  displayMode: AvailabilityDisplayMode;
  closedMessage: string | null;
  canLateOverride: boolean;
  overrideMessage: string | null;
}> {
  const baseWindow = getAvailabilityWindow();
  const { lateOverridePeriodStart } = await getCleanerOverrideTracking(cleanerId);
  const missedPeriod = getMissedPeriodForOverride();

  const missedRowCount = missedPeriod
    ? await countCleanerAvailabilityInPeriod(cleanerId, missedPeriod)
    : 0;

  const override = resolveAvailabilityOverrideState({
    lateOverridePeriodStart,
    existingRowCountForMissedPeriod: missedRowCount,
  });

  let period = baseWindow.period;
  let displayMode = baseWindow.displayMode;
  let deadline = baseWindow.deadline;

  if (override.canLateOverride && override.overridePeriod) {
    period = override.overridePeriod;
    displayMode = "override";
    deadline = {
      ...baseWindow.deadline,
      canSubmitRegular: false,
      canEditPreferences: false,
    };
  }

  const rows = await db.query.availability.findMany({
    where: and(
      eq(availability.cleanerId, cleanerId),
      gte(availability.date, period.start),
      lte(availability.date, period.end)
    ),
  });

  const closedMessage =
    override.canLateOverride
      ? null
      : deadline.canSubmitRegular
        ? null
        : getSubmissionClosedMessage(deadline, period, displayMode);

  const byDate = new Map(
    rows.map((row) => [
      row.date,
      {
        isAvailable: true,
        onCallEligible: row.onCallEligible ?? false,
        openPoolEligible: row.openPoolEligible ?? false,
      },
    ])
  );

  const allDays = period.dates.map((date) => {
    const existing = byDate.get(date);
    return {
      date,
      label: formatDayLabel(date),
      isAvailable: existing?.isAvailable ?? false,
      onCallEligible: existing?.onCallEligible ?? false,
      openPoolEligible: existing?.openPoolEligible ?? false,
    };
  });

  const days = filterDaysForDisplay(allDays, {
    displayMode,
    canLateOverride: override.canLateOverride,
    canSubmitRegular: deadline.canSubmitRegular,
  });

  return {
    period,
    days,
    deadline,
    displayMode,
    closedMessage,
    canLateOverride: override.canLateOverride,
    overrideMessage: override.overrideMessage,
  };
}

export async function saveCleanerAvailability(
  cleanerId: string,
  days: AvailabilityDayInput[]
): Promise<{ period: AvailabilityPeriod }> {
  const { period } = getAvailabilityWindow();
  const now = new Date();

  // A submission is meaningful only when both its acknowledgement and its
  // current day rows succeed. Keep these DB writes sequential in one
  // transaction; the production transaction pooler cannot pipeline them.
  await db.transaction(async (tx) => {
    for (const day of days) {
      await tx
        .delete(availability)
        .where(
          and(
            eq(availability.cleanerId, cleanerId),
            eq(availability.date, day.date)
          )
        );

      if (day.isAvailable) {
        await tx.insert(availability).values({
          cleanerId,
          date: day.date,
          availabilityType: "vacation_rental",
          startTime: DEFAULT_START,
          endTime: DEFAULT_END,
          onCallEligible: day.onCallEligible,
          openPoolEligible: day.openPoolEligible ?? false,
          isGracePeriod: false,
          submissionStatus: "on_time",
          submittedAt: now,
        });
      }
    }

    await tx
      .insert(cleanerAvailabilitySubmissions)
      .values({
        cleanerId,
        periodStart: period.start,
        periodEnd: period.end,
        submissionMode: "full",
        firstSubmittedAt: now,
        lastUpdatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          cleanerAvailabilitySubmissions.cleanerId,
          cleanerAvailabilitySubmissions.periodStart,
        ],
        set: {
          periodEnd: period.end,
          submissionMode: "full",
          lastUpdatedAt: now,
        },
      });
  });

  return { period };
}

export async function saveCleanerAvailabilityPreferences(
  cleanerId: string,
  preferences: AvailabilityPreferenceInput[]
): Promise<{ period: AvailabilityPeriod }> {
  const { period } = getAvailabilityWindow();

  for (const pref of preferences) {
    if (!period.dates.includes(pref.date)) {
      throw new Error(`Date ${pref.date} is outside the current period`);
    }

    const existing = await db.query.availability.findFirst({
      where: and(
        eq(availability.cleanerId, cleanerId),
        eq(availability.date, pref.date)
      ),
    });

    if (!existing) {
      throw new Error(
        `Cannot update preferences for ${pref.date} — no availability submitted for that day`
      );
    }

    await db
      .update(availability)
      .set({
        onCallEligible: pref.onCallEligible,
        openPoolEligible: pref.openPoolEligible,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(availability.cleanerId, cleanerId),
          eq(availability.date, pref.date)
        )
      );
  }

  // Do not create a period acknowledgement from a preference-only edit: a
  // legacy availability row cannot prove the cleaner submitted the full block.
  // When an acknowledgement exists, this is the durable "last changed" time.
  await db
    .update(cleanerAvailabilitySubmissions)
    .set({ lastUpdatedAt: new Date() })
    .where(
      and(
        eq(cleanerAvailabilitySubmissions.cleanerId, cleanerId),
        eq(cleanerAvailabilitySubmissions.periodStart, period.start)
      )
    );

  return { period };
}

export async function saveCleanerLateOverrideAvailability(
  cleanerId: string,
  days: AvailabilityDayInput[],
  period: AvailabilityPeriod
): Promise<{ period: AvailabilityPeriod }> {
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const day of days) {
      if (!period.dates.includes(day.date)) continue;

      await tx
        .delete(availability)
        .where(
          and(
            eq(availability.cleanerId, cleanerId),
            eq(availability.date, day.date)
          )
        );

      if (day.isAvailable) {
        await tx.insert(availability).values({
          cleanerId,
          date: day.date,
          availabilityType: "vacation_rental",
          startTime: DEFAULT_START,
          endTime: DEFAULT_END,
          onCallEligible: day.onCallEligible,
          openPoolEligible: day.openPoolEligible ?? false,
          isGracePeriod: true,
          submissionStatus: "late_accepted",
          submittedAt: now,
        });
      }
    }

    await tx
      .insert(cleanerAvailabilitySubmissions)
      .values({
        cleanerId,
        periodStart: period.start,
        periodEnd: period.end,
        submissionMode: "override",
        firstSubmittedAt: now,
        lastUpdatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          cleanerAvailabilitySubmissions.cleanerId,
          cleanerAvailabilitySubmissions.periodStart,
        ],
        set: {
          periodEnd: period.end,
          submissionMode: "override",
          lastUpdatedAt: now,
        },
      });

    await tx
      .update(cleaners)
      .set({
        availabilityLateOverridePeriodStart: period.start,
        updatedAt: now,
      })
      .where(eq(cleaners.id, cleanerId));
  });

  return { period };
}
