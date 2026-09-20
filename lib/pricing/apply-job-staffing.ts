import {
  calculateJobStaffing,
  type HotTubTimeAdditions,
} from "@/lib/pricing/staffing-logic";
import { differenceInDays, startOfDay } from "date-fns";

export type JobStaffingProperty = {
  bedCount: number;
  bathCount: string | number;
  sqFt: number | null;
  laundryType: string;
  hotTubServiceLevel: boolean;
  hotTubDrainCadence: string | null;
  /**
   * A pricing input that does not reach `addons_snapshot` makes a
   * historical job silently re-price. The pet fee is a pricing input, so the
   * frozen copy travels with the job even though it changes no staffing.
   *
   * REQUIRED, not optional: this value is written into the snapshot on every
   * call, including `recalculateJobStaffing`, which passes an existing snapshot
   * back in. A caller that omitted it would quietly overwrite a frozen `true`
   * with `false` and stop billing the fee. Required means the compiler asks.
   */
  petsAllowed: boolean;
};

export function isHotTubDeepCleanDue(
  jobDate: Date,
  subscriptionStartDate: Date,
  cadence: string | null | undefined
): boolean {
  if (!cadence) return false;

  const job = startOfDay(jobDate);
  const start = startOfDay(subscriptionStartDate);
  const diffDays = Math.abs(differenceInDays(job, start));

  const cadenceDays: Record<string, number> = {
    "4_weeks": 28,
    "6_weeks": 42,
    "2_months": 56,
    "3_months": 84,
    "4_months": 112,
  };

  const days = cadenceDays[cadence] ?? 0;
  if (days === 0) return false;

  return diffDays > 0 && diffDays % days < 7;
}

export function buildJobStaffingUpdate(input: {
  property: JobStaffingProperty;
  checkInTime: Date;
  subscriptionStart: Date;
  existingSnapshot?: Record<string, unknown> | null;
  /** From `loadHotTubTimeAdditions()`; omit to use the built-in defaults. */
  hotTubTimeAdditions?: HotTubTimeAdditions | null;
}) {
  const staffing = calculateJobStaffing({
    bedCount: input.property.bedCount,
    bathCount: input.property.bathCount,
    sqFt: input.property.sqFt,
    laundryType: input.property.laundryType,
    hotTubServiceLevel: input.property.hotTubServiceLevel,
    hotTubTimeAdditions: input.hotTubTimeAdditions,
    hotTubDeepClean: input.property.hotTubServiceLevel
      ? isHotTubDeepCleanDue(
          input.checkInTime,
          input.subscriptionStart,
          input.property.hotTubDrainCadence
        )
      : false,
  });

  const existingSnapshot = input.existingSnapshot ?? {
    laundryType: input.property.laundryType,
  };

  return {
    expectedHours: staffing.expectedHoursPerCleaner.toString(),
    addonsSnapshot: {
      ...existingSnapshot,
      laundryType: input.property.laundryType,
      laundryLoads: staffing.expectedLaundryLoads,
      hotTubServiceLevel: input.property.hotTubServiceLevel
        ? staffing.isDeepClean
          ? "deep_clean"
          : "basic"
        : "none",
      hotTubDrainCadence: input.property.hotTubDrainCadence,
      // Frozen per job. Deliberately NOT fed into calculateJobStaffing
      // above: the pet fee is customer revenue only and must not move hours,
      // team size or pay. Counterproposal item 9.
      petsAllowed: Boolean(input.property.petsAllowed),
      teamSize: staffing.teamSize,
      propertySize: staffing.propertySize,
      requiresManualStaffing: staffing.requiresManualStaffing,
      bedroomBathroomTotal: staffing.bedroomBathroomTotal,
      baseCleaningHours: staffing.baseCleaningHours,
      inUnitLaundryHours: staffing.inUnitLaundryHours,
      offSiteLaundryHours: staffing.offSiteLaundryHours,
      hotTubHours: staffing.hotTubHours,
    },
    staffing,
  };
}
