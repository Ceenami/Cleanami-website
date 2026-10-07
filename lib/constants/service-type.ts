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

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  vacation_rental_subscription: "Vacation Rental Turnover",
  residential_one_time: "One-Time House Clean",
};

/**
 * Short enough for a badge in a table cell. The long form above is what a
 * heading, a select option or an email uses.
 *
 * One pair of words, not one per screen. Three surfaces had grown their own
 * copy of this and two of them disagreed - the admin list said "Vacation
 * Rental" while the cleaner app said "Turnover" for the same job.
 */
export const SERVICE_TYPE_SHORT_LABELS: Record<ServiceType, string> = {
  vacation_rental_subscription: "Vacation Rental",
  residential_one_time: "Residential",
};

/**
 * The admin's manual override, stored on the job rather than the property: a
 * clean that is a redo of an earlier one, or a fix to it. It is NOT a third
 * service type - the job is still a turnover or a residential clean underneath,
 * and everything that reasons about scheduling, pricing or staffing keeps
 * reading `service_type`.
 */
export const JOB_LABELS = {
  reclean: "Reclean",
  correction: "Correction",
} as const;

export type JobLabel = keyof typeof JOB_LABELS;

export const JOB_LABEL_VALUES = Object.keys(JOB_LABELS) as [
  JobLabel,
  ...JobLabel[],
];

/**
 * The client's own literal, from their own list of three. Both labelled jobs
 * carry it, because that is the wording being checked against.
 */
export const JOB_LABEL_BADGE = "Reclean/Correction";

export function isJobLabel(value: unknown): value is JobLabel {
  return typeof value === "string" && value in JOB_LABELS;
}

export type JobDisplay = {
  /** Full wording - a heading, or anywhere with room for it. */
  label: string;
  /** Badge-length, for a table cell. */
  short: string;
  /**
   * "Reclean" or "Correction" when one is set, otherwise null. The badge says
   * "Reclean/Correction" everywhere; this is the specific word, for a detail
   * view that has room to say which of the two it actually was.
   */
  specific: string | null;
  /** Drives the badge colour. No Tailwind here, so this file stays render-agnostic. */
  tone: "vacation_rental" | "residential" | "labeled";
};

/**
 * How a job describes itself, on every surface that describes one.
 *
 * A manual label wins when it is set: an admin who marks a job a reclean is
 * making a statement about THIS job that the property's service type cannot
 * make. When none is set the service type answers, and a job that predates the
 * column reads as a vacation-rental turnover, which is what every such job was.
 *
 * Sibling of `payment-status.ts` and here for the same reason - a label each
 * screen invents for itself is a label that drifts, and this one is going to be
 * compared across five screens at once.
 */
export function getJobDisplay(job: {
  serviceType?: string | null;
  jobLabel?: string | null;
}): JobDisplay {
  if (isJobLabel(job.jobLabel)) {
    return {
      label: JOB_LABEL_BADGE,
      short: JOB_LABEL_BADGE,
      specific: JOB_LABELS[job.jobLabel],
      tone: "labeled",
    };
  }

  const serviceType: ServiceType =
    job.serviceType === "residential_one_time"
      ? "residential_one_time"
      : "vacation_rental_subscription";

  return {
    label: SERVICE_TYPE_LABELS[serviceType],
    short: SERVICE_TYPE_SHORT_LABELS[serviceType],
    specific: null,
    tone:
      serviceType === "residential_one_time"
        ? "residential"
        : "vacation_rental",
  };
}

/**
 * Scope-response closeout copy. This is deliberately a disclosure, not a
 * classifier: a customer can tell us their home needs unusually intensive work,
 * but the booking flow must not invent a review queue or an automatic surcharge.
 */
export const RESIDENTIAL_HEAVY_CONDITION_DISCLAIMER =
  "Our online prices assume a home in typical condition. If your home needs unusually heavy cleaning, please contact us before booking so we can review it and provide a custom quote.";

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
