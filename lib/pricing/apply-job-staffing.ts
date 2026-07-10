import { calculateJobStaffing } from "@/lib/pricing/staffing-logic";
import { differenceInDays, startOfDay } from "date-fns";

export type JobStaffingProperty = {
  bedCount: number;
  bathCount: string | number;
  sqFt: number | null;
  laundryType: string;
  hotTubServiceLevel: boolean;
  hotTubDrainCadence: string | null;
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
}) {
  const staffing = calculateJobStaffing({
    bedCount: input.property.bedCount,
    bathCount: input.property.bathCount,
    sqFt: input.property.sqFt,
    laundryType: input.property.laundryType,
    hotTubServiceLevel: input.property.hotTubServiceLevel,
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
      teamSize: staffing.teamSize,
      propertySize: staffing.propertySize,
      requiresManualStaffing: staffing.requiresManualStaffing,
      bedroomBathroomTotal: staffing.bedroomBathroomTotal,
      baseCleaningHours: staffing.baseCleaningHours,
      offSiteLaundryHours: staffing.offSiteLaundryHours,
      hotTubHours: staffing.hotTubHours,
    },
    staffing,
  };
}
