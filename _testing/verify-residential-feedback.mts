/**
 * Regression checks for the post-Phase-2A residential feedback amendment.
 * Usage: npx tsx --tsconfig _testing/tsconfig.harness.json _testing/verify-residential-feedback.mts
 */
import { config } from "dotenv";

config({ path: ".env.local" });

if (!(process.env.DATABASE_URL ?? "").includes("sbdoazaoxgwgsfpcbqjx")) {
  throw new Error("DATABASE_URL is not the Phase 2A test project.");
}

const {
  getBookableArrivalTimes,
  getDeadlineInstant,
  isResidentialArrivalTime,
  toEasternDateKey,
} = await import("@/lib/scheduling/residential-notice");
const { residentialFormSchema } = await import("@/lib/validations/residential");
const {
  estimateResidentialBooking,
  evaluateResidentialBooking,
} = await import("@/lib/services/residential-booking.service");

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

const cleanDate = toEasternDateKey(
  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
);
const form = (overrides: Record<string, unknown> = {}) => ({
  name: "Feedback verification",
  email: "feedback-verify@seed.cleannami.local",
  emailConfirm: "feedback-verify@seed.cleannami.local",
  phoneNumber: "3865550142",
  address: "120 S Atlantic Ave, New Smyrna Beach, FL 32169",
  isAddressInServiceArea: true,
  bedrooms: 4,
  bathrooms: 3,
  sqft: 2500,
  petsAllowed: false,
  hasHotTub: false,
  hotTubService: false,
  cleanDate,
  arrivalTime: "16:00",
  entryMethod: "smart_lock",
  entryInstructions: "Keypad code is 1234; use the front door.",
  ...overrides,
});

console.log("\nResidential feedback amendment\n");

const offeredTimes = getBookableArrivalTimes(cleanDate);
check(
  "exact arrival times include the full 9 AM through 4 PM day",
  offeredTimes.includes("09:00") && offeredTimes.includes("16:00"),
  `${offeredTimes.at(0)} to ${offeredTimes.at(-1)}`
);
check("15-minute arrival increments are enforced", isResidentialArrivalTime("13:45"));
check("off-increment arrival times are rejected", !isResidentialArrivalTime("13:47"));

const deadline = getDeadlineInstant(cleanDate, "16:00", 4);
check(
  "an afternoon residential clean may have an internal finish after 4 PM",
  deadline !== null && deadline.getTime() > new Date(`${cleanDate}T21:00:00Z`).getTime()
);

const missingAccess = residentialFormSchema.safeParse(
  form({ entryMethod: undefined, entryInstructions: undefined })
);
check("entry method and details are required", !missingAccess.success);

const lateLargeHome = await evaluateResidentialBooking(form());
check(
  "a standard large home can book a 4 PM arrival without a turnover cutoff",
  lateLargeHome.ok,
  lateLargeHome.ok ? `team staffing retained` : lateLargeHome.error
);

const standardEstimate = await estimateResidentialBooking({
  bedrooms: 3,
  bathrooms: 2,
  sqft: 1400,
  petsAllowed: false,
  hasHotTub: true,
  hotTubService: false,
});
const hotTubEstimate = await estimateResidentialBooking({
  bedrooms: 3,
  bathrooms: 2,
  sqft: 1400,
  petsAllowed: false,
  hasHotTub: true,
  hotTubService: true,
});
check(
  "basic hot-tub service is included in the live residential estimate",
  standardEstimate.ok &&
    hotTubEstimate.ok &&
    hotTubEstimate.priceDetails.totalPerClean > standardEstimate.priceDetails.totalPerClean,
  standardEstimate.ok && hotTubEstimate.ok
    ? `$${standardEstimate.priceDetails.totalPerClean} -> $${hotTubEstimate.priceDetails.totalPerClean}`
    : "estimate unavailable"
);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}

console.log("\nAll residential feedback checks passed.");
