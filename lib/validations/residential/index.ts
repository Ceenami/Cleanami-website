import { z } from "zod";
import { ENTRY_METHOD_VALUES } from "@/lib/constants/service-type";
import {
  ARRIVAL_WINDOW_KEYS,
  getArrivalWindow,
  windowFitsOperatingDay,
} from "@/lib/scheduling/arrival-windows";
import {
  RESIDENTIAL_NOTICE_MESSAGE,
  RESIDENTIAL_NO_WINDOW_MESSAGE,
  meetsResidentialNotice,
  toEasternDateKey,
} from "@/lib/scheduling/residential-notice";
import { calculateJobStaffing } from "@/lib/pricing/staffing-logic";

/**
 * The residential one-time booking form.
 *
 * **A separate schema, deliberately — not a variant of `signupFormSchema`.**
 * M3 is explicit about why: the two forms share almost no fields, and every one
 * of `signupFormSchema`'s refinements (the 7-day first-clean buffer, the
 * checklist requirement, the laundry-loads pairing) is wrong here. An
 * optional-everything shared schema is precisely how the two flows begin to
 * "confuse or overwrite each other" (scope).
 *
 * What is deliberately absent, and why:
 *
 *   iCal, subscription term    There is no subscription. Item 4.
 *   guest check-in/check-out   A home has no guests. Item 4.
 *   laundry, hot tub           Not offered in client 2A; the residential input
 *                              builder forces them off, which is what selects
 *                              the in-unit team-size column
 *.
 *   checklist upload           Item 18's residential checklist is M7's.
 *   home condition             The counterproposal withdrew it; the signal
 *                              lands in `specialNotes` instead (delta).
 *   promo code Client 2B item 3, not 2A (delta).
 *   "areas not to enter"       Item 4: "we do not need areas not to enter in
 *                              Phase 2".
 */

/** The date arrives over JSON as `YYYY-MM-DD` and stays that way. */
const CLEAN_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a valid clean date.");

export const residentialFormSchema = z
  .object({
    // R1 — your details
    name: z.string().min(2, "Name is required"),
    email: z.email(),
    emailConfirm: z.email(),
    phoneNumber: z.string().min(10, "A valid phone number is required"),

    // R2 — your home
    address: z.string().min(5, "Address is required"),
    isAddressInServiceArea: z.boolean().refine((val) => val === true, {
      message: "The selected address must be within our service area.",
    }),
    sqft: z.number().positive(),
    bedrooms: z
      .number()
      .int("Please enter a whole number of bedrooms")
      .min(1, "Must have at least 1 bedroom"),
    bathrooms: z
      .number()
      .int("Please enter a whole number of bathrooms")
      .min(1, "Must have at least 1 bathroom"),
    /** the client's residential wording is "Are pets normally present in the home?" */
    petsAllowed: z.boolean().default(false),

    // R3 — when
    cleanDate: CLEAN_DATE,
    arrivalWindow: z.enum(ARRIVAL_WINDOW_KEYS),

    // R4 — getting in. All three optional: "the customer will let the cleaner
    // in" is a legitimate answer with no details attached, and item 5's own
    // list includes it.
    entryMethod: z.enum(ENTRY_METHOD_VALUES).optional(),
    /** CREDENTIAL. Door/lockbox/gate/garage codes. Read the rules before wiring this anywhere. */
    entryInstructions: z.string().trim().max(2000).optional(),
    parkingInstructions: z.string().trim().max(2000).optional(),
    specialNotes: z.string().trim().max(2000).optional(),
  })
  .refine((data) => data.email === data.emailConfirm, {
    message: "Emails don't match",
    path: ["emailConfirm"],
  })
  .refine(
    (data) => {
      // Guarded on both halves being present because the form parses with
      // `.partial()` on every step — an unguarded refine would fail R1 and R2,
      // where the date has not been reached yet.
      if (data.cleanDate === undefined || data.arrivalWindow === undefined) {
        return true;
      }
      return meetsResidentialNotice(data.cleanDate, data.arrivalWindow);
    },
    {
      // The client's sentence, verbatim (delta). Do not reword it.
      message: RESIDENTIAL_NOTICE_MESSAGE,
      path: ["cleanDate"],
    }
  )
  .refine(
    (data) => {
      // Layer 2 of the operating-day rule. The form hides windows
      // that do not fit; this is what makes hiding them a courtesy rather than
      // the whole enforcement.
      if (
        data.arrivalWindow === undefined ||
        data.bedrooms === undefined ||
        data.bathrooms === undefined
      ) {
        return true;
      }
      const window = getArrivalWindow(data.arrivalWindow);
      if (!window) return false;

      const staffing = calculateJobStaffing({
        bedCount: data.bedrooms,
        bathCount: data.bathrooms,
        sqFt: data.sqft ?? null,
        laundryType: "none",
        hotTubServiceLevel: false,
        hotTubDeepClean: false,
      });
      return windowFitsOperatingDay(window, staffing.expectedHoursPerCleaner);
    },
    {
      message: RESIDENTIAL_NO_WINDOW_MESSAGE,
      path: ["arrivalWindow"],
    }
  );

export type ResidentialFormData = Partial<z.infer<typeof residentialFormSchema>>;

/** Today in Eastern, so the picker's floor is the ops timezone's day, not the browser's. */
export function todayEastern(): string {
  return toEasternDateKey(new Date());
}
