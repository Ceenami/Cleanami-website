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

/** Validation for the public residential booking flow. */

/** The date arrives over JSON as `YYYY-MM-DD` and stays that way. */
const CLEAN_DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a valid clean date.");

export const residentialFormSchema = z
  .object({
    // Customer details
    name: z.string().min(2, "Name is required"),
    email: z.email(),
    emailConfirm: z.email(),
    phoneNumber: z.string().min(10, "A valid phone number is required"),

    // Home details
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
    /** Whether pets are normally present. */
    petsAllowed: z.boolean().default(false),

    // Appointment
    cleanDate: CLEAN_DATE,
    arrivalWindow: z.enum(ARRIVAL_WINDOW_KEYS),

    // Access details are optional.
    entryMethod: z.enum(ENTRY_METHOD_VALUES).optional(),
    /** Door, lockbox, gate, or garage details. */
    entryInstructions: z.string().trim().max(2000).optional(),
    parkingInstructions: z.string().trim().max(2000).optional(),
    specialNotes: z.string().trim().max(2000).optional(),

    // Rechecked server-side before payment.
    promoCode: z.string().trim().max(64).optional(),
  })
  .refine((data) => data.email === data.emailConfirm, {
    message: "Emails don't match",
    path: ["emailConfirm"],
  })
  .refine(
    (data) => {
      // Steps validate partial form data.
      if (data.cleanDate === undefined || data.arrivalWindow === undefined) {
        return true;
      }
      return meetsResidentialNotice(data.cleanDate, data.arrivalWindow);
    },
    {
      message: RESIDENTIAL_NOTICE_MESSAGE,
      path: ["cleanDate"],
    }
  )
  .refine(
    (data) => {
      // Enforce operating hours on the server.
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
