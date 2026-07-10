/**
 * CleanNami Pricing, Staffing & Profit Logic v12.0
 * Property size → cleaning time → team size → per-cleaner pay ($17/hr, full hours each).
 */

export const CLEANER_HOURLY_RATE = 17;

export type PropertySize = "small" | "medium" | "large" | "custom";
export type LaundryType = "in_unit" | "off_site" | "none";

export type StaffingPropertyInput = {
  bedCount: number;
  bathCount: number | string;
  sqFt?: number | null;
  laundryType: LaundryType | string;
  hotTubServiceLevel?: boolean;
  /** When true, add deep-drain hot tub hours instead of basic service hours. */
  hotTubDeepClean?: boolean;
};

export type JobStaffingResult = {
  propertySize: PropertySize;
  bedroomBathroomTotal: number;
  baseCleaningHours: number;
  offSiteLaundryHours: number;
  hotTubHours: number;
  /** Full expected cleaning time paid to each assigned cleaner (not split by team). */
  expectedHoursPerCleaner: number;
  teamSize: number | null;
  requiresManualStaffing: boolean;
  expectedLaundryLoads: number;
  isDeepClean: boolean;
};

const SIZE_RANK: Record<PropertySize, number> = {
  small: 1,
  medium: 2,
  large: 3,
  custom: 4,
};

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

/** §2–§3: classify using BB total and sqft; highest applicable category wins. */
export function classifyPropertySize(
  bedCount: number,
  bathCount: number | string,
  sqFt?: number | null
): PropertySize {
  const baths = Number(bathCount) || 0;
  const bbTotal = bedCount + baths;
  const sq = sqFt ?? 0;

  const eligible: PropertySize[] = [];

  if (bbTotal >= 10 || bedCount >= 6 || baths >= 5 || sq >= 3000) {
    eligible.push("custom");
  }
  if ((bbTotal >= 7 && bbTotal <= 9) || (sq >= 2000 && sq <= 2999)) {
    eligible.push("large");
  }
  if ((bbTotal >= 5 && bbTotal <= 6) || (sq >= 1251 && sq <= 1999)) {
    eligible.push("medium");
  }
  if (bbTotal < 5 && sq <= 1250) {
    eligible.push("small");
  }

  if (eligible.length === 0) {
    return "small";
  }

  return eligible.sort((a, b) => SIZE_RANK[b] - SIZE_RANK[a])[0];
}

/** §6 base cleaning time (before off-site laundry add-on). */
export function calculateBaseCleaningHours(
  bedCount: number,
  bathCount: number | string,
  sqFt?: number | null
): number {
  const baths = Number(bathCount) || 0;
  let hours = -0.585 + 0.95 * bedCount + 0.62 * baths;

  if (sqFt && sqFt > 0) {
    hours += 0.1905 * (sqFt / 250);
  }

  return roundHours(Math.max(0, hours));
}

function offSiteLaundryHours(propertySize: PropertySize): number {
  if (propertySize === "custom") return 0;
  switch (propertySize) {
    case "small":
      return 1.25;
    case "medium":
      return 1.75;
    case "large":
      return 2.25;
    default:
      return 0;
  }
}

function expectedLaundryLoads(
  propertySize: PropertySize,
  laundryType: string
): number {
  if (laundryType !== "off_site" || propertySize === "custom") return 0;
  switch (propertySize) {
    case "small":
      return 2;
    case "medium":
      return 3;
    case "large":
      return 4;
    default:
      return 0;
  }
}

function hotTubServiceHours(deepClean: boolean): number {
  return deepClean ? 1.0 : 0.3;
}

/** §4 team size by property size and laundry type. */
export function getTeamSize(
  propertySize: PropertySize,
  laundryType: LaundryType | string
): { teamSize: number | null; requiresManualStaffing: boolean } {
  if (propertySize === "custom") {
    return { teamSize: null, requiresManualStaffing: true };
  }

  const isOffSite = laundryType === "off_site";

  if (isOffSite) {
    switch (propertySize) {
      case "small":
        return { teamSize: 1, requiresManualStaffing: false };
      case "medium":
        return { teamSize: 2, requiresManualStaffing: false };
      case "large":
        return { teamSize: 3, requiresManualStaffing: false };
      default:
        return { teamSize: 1, requiresManualStaffing: false };
    }
  }

  switch (propertySize) {
    case "small":
      return { teamSize: 1, requiresManualStaffing: false };
    case "medium":
      return { teamSize: 1, requiresManualStaffing: false };
    case "large":
      return { teamSize: 2, requiresManualStaffing: false };
    default:
      return { teamSize: 1, requiresManualStaffing: false };
  }
}

/** §6–§7: full job staffing + per-cleaner expected hours. */
export function calculateJobStaffing(
  input: StaffingPropertyInput
): JobStaffingResult {
  const propertySize = classifyPropertySize(
    input.bedCount,
    input.bathCount,
    input.sqFt
  );
  const bedroomBathroomTotal =
    input.bedCount + (Number(input.bathCount) || 0);

  const baseCleaningHours = calculateBaseCleaningHours(
    input.bedCount,
    input.bathCount,
    input.sqFt
  );

  const isOffSite = input.laundryType === "off_site";
  const offSiteHours = isOffSite
    ? offSiteLaundryHours(propertySize)
    : 0;

  const isDeepClean = Boolean(input.hotTubDeepClean);
  const hotTubHours =
    input.hotTubServiceLevel && propertySize !== "custom"
      ? hotTubServiceHours(isDeepClean)
      : 0;

  const expectedHoursPerCleaner = roundHours(
    baseCleaningHours + offSiteHours + hotTubHours
  );

  const { teamSize, requiresManualStaffing } = getTeamSize(
    propertySize,
    input.laundryType
  );

  return {
    propertySize,
    bedroomBathroomTotal,
    baseCleaningHours,
    offSiteLaundryHours: offSiteHours,
    hotTubHours,
    expectedHoursPerCleaner,
    teamSize,
    requiresManualStaffing,
    expectedLaundryLoads: expectedLaundryLoads(
      propertySize,
      input.laundryType
    ),
    isDeepClean,
  };
}

/** §7: each assigned cleaner receives full expected hours at the hourly rate. */
export function calculateCleanerBasePay(expectedHoursPerCleaner: number): number {
  return roundHours(expectedHoursPerCleaner * CLEANER_HOURLY_RATE);
}

/** Total in-unit labor cost for a job (all cleaners combined). */
export function calculateTotalInUnitLabor(
  expectedHoursPerCleaner: number,
  teamSize: number
): number {
  return roundHours(
    CLEANER_HOURLY_RATE * expectedHoursPerCleaner * teamSize
  );
}

/** §8 off-site labor before laundry lead bonus. */
export function calculateTotalOffSiteLabor(
  expectedHoursPerCleaner: number,
  teamSize: number
): number {
  return roundHours(
    CLEANER_HOURLY_RATE * expectedHoursPerCleaner * teamSize
  );
}
