/**
 * Service types, entry methods, and the copy the client dictated.
 *
 * The stored values are the client's own literals from the 2026-08-27
 * counterproposal; the display labels are
 * separate and deliberately so — a column value and a heading change for
 * different reasons.
 */

export const SERVICE_TYPES = [
  "vacation_rental_subscription",
  "residential_one_time",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

/** Client 2B item 5 names a third label, "Reclean/Correction"; it is not a service type. */
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  vacation_rental_subscription: "Vacation Rental Turnover",
  residential_one_time: "One-Time Residential Clean",
};

export const JOB_SOURCES = [
  "ical",
  "manual",
  "customer_one_off",
  "public_residential_booking",
] as const;

export type JobSource = (typeof JOB_SOURCES)[number];

/**
 * Counterproposal item 5's eight options, **in the order the document lists
 * them**. The order is not cosmetic: the client will read the form against
 * their own list.
 */
export const ENTRY_METHODS = [
  {
    value: "smart_lock",
    label: "Smart lock / keypad",
    /**
     * The access-details prompt is per method on purpose. "What's the code, and
     * which door?" produces a usable answer; a generic "access notes" box
     * produces "see email".
     */
    prompt: "What is the code, and which door does it open?",
  },
  {
    value: "lockbox",
    label: "Lockbox",
    prompt: "What is the lockbox code, and where is the lockbox?",
  },
  {
    value: "hidden_key",
    label: "Hidden key",
    prompt: "Where is the key hidden?",
  },
  {
    value: "customer_present",
    label: "I will let the cleaner in",
    prompt: "Anything the cleaner should know when they arrive? (optional)",
  },
  {
    value: "front_desk",
    label: "Front desk / concierge",
    prompt: "Which desk, and what should the cleaner ask for?",
  },
  {
    value: "garage_code",
    label: "Garage code",
    prompt: "What is the garage code, and which garage?",
  },
  {
    value: "gate_code",
    label: "Gate code",
    prompt: "What is the gate code, and which gate?",
  },
  {
    value: "other",
    label: "Other",
    prompt: "How should the cleaner get in?",
  },
] as const;

export type EntryMethod = (typeof ENTRY_METHODS)[number]["value"];

export const ENTRY_METHOD_VALUES = ENTRY_METHODS.map((m) => m.value) as [
  EntryMethod,
  ...EntryMethod[],
];

export function getEntryMethod(value: string | undefined | null) {
  return ENTRY_METHODS.find((m) => m.value === value);
}

/**
 * `entry_instructions` is a CREDENTIAL STORE — door, lockbox, gate and garage
 * codes. Never in an email, an SMS, a push payload, a
 * `notifications` row, `jobs.notes`, `jobs.addons_snapshot` or Stripe metadata.
 * Admin and the ASSIGNED cleaner only.
 *
 * This is the sentence a confirmation email may carry instead: the method, not
 * the code (counterproposal item 15's "entry/access reminder").
 */
export function entryAccessReminder(
  entryMethod: string | null | undefined
): string {
  const method = getEntryMethod(entryMethod);
  if (!method) {
    return "We will confirm how your cleaner gets in before the clean. Reply to this email if anything changes.";
  }
  return `Your cleaner will get in using the ${method.label.toLowerCase()} details you gave us. Reply to this email if that changes.`;
}

/** The client's exact wording, either side. */
export const PETS_QUESTION_VACATION_RENTAL = "Does this property allow pets?";
export const PETS_QUESTION_RESIDENTIAL =
  "Are pets normally present in the home?";

/**
 * The client's exact wording. It
 * **replaces** the PRD's paraphrase). One constant, not three copies: M4 shows
 * it in the admin job view and on the cleaner job detail, and M7 shows it in
 * the native app.
 */
export const PETS_CLEANER_NOTE =
  "Pets/pet hair possible - check floors, couches, rugs, beds, corners, and baseboards.";

/**
 * What a residential customer is owed the moment we take their money up front.
 *
 * Charging at booking creates an obligation the vacation-rental
 * authorize-then-capture model does not: the spec says *"if a job is not
 * completed, no customer charge occurs"*, which is automatic under a hold and
 * a real refund path under prepay. The
 * mechanism is `cancelJobAsAdmin()` → `voidCharge()`; this is the sentence that
 * tells the customer it exists. Self-service cancellation is client 2B item 4.
 */
export const RESIDENTIAL_CANCELLATION_POLICY =
  "Need to cancel or reschedule? Reply to this email or call us before your clean and we will refund your payment in full.";
