import { z } from "zod";

export const signupFormSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    email: z.email(),
    emailConfirm: z.email(),
    phoneNumber: z.string().min(10, "A valid phone number is required"),
    address: z.string().min(5, "Address is required"),
    isAddressInServiceArea: z.boolean().refine((val) => val === true, {
      message: "The selected address must be within our service area.",
    }),
    sqft: z.number().positive(),
    bedrooms: z.number().int("Please enter a whole number of bedrooms").min(1, "Must have at least 1 bedroom"),
    // Only full bathrooms are priced (the base-price matrix and v12 use whole
    // bath counts); half baths are not a supported concept.
    bathrooms: z.number().int("Please enter a whole number of bathrooms").min(1, "Must have at least 1 bathroom"),
    checklistFile: z
      .array(z.instanceof(File))
      .optional(),
    useDefaultChecklist: z.boolean().optional(),
    laundryService: z.enum(["in_unit", "off_site", "none"]),
    laundryLoads: z.coerce.number().int().min(1).optional(),
    hasHotTub: z.boolean().default(false),
    hotTubService: z.boolean(),
    hotTubDrain: z.boolean(),
    hotTubDrainCadence: z
      .enum(["4_weeks", "6_weeks", "2_months", "3_months", "4_months"])
      .optional(),
    subscriptionMonths: z.number().min(1).max(6),
    defaultCheckInTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, "Invalid time format"),
    defaultCheckOutTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, "Invalid time format"),
    iCalUrl: z.string().url("Please enter a valid URL"),
    firstCleanDate: z.date({
      message: "Please select a valid start date for your first clean.",
    }),
    /**
     * Optional promo code typed at checkout (task 1.8). Never trusted from the
     * client — the discount is always re-resolved server-side against
     * `promo_codes` before the PaymentIntent is created.
     */
    promoCode: z.string().trim().max(64).optional(),
  })
  .refine((data) => data.email === data.emailConfirm, {
    message: "Emails don't match",
    path: ["emailConfirm"],
  })
  .refine(
    (data) =>
      data.useDefaultChecklist === true ||
      (data.checklistFile !== undefined && data.checklistFile.length > 0),
    {
      message: "Upload a checklist or choose the default checklist",
      path: ["checklistFile"],
    }
  )
  .refine(
    (data) => {
      // Mandatory 7-day setup buffer before the first clean. Calendar-day
      // comparison so a same-day pick of "today + 7" is accepted.
      const earliest = new Date();
      earliest.setHours(0, 0, 0, 0);
      earliest.setDate(earliest.getDate() + 7);
      const chosen = new Date(data.firstCleanDate);
      chosen.setHours(0, 0, 0, 0);
      return chosen.getTime() >= earliest.getTime();
    },
    {
      message: "Your first clean must be at least 7 days from today.",
      path: ["firstCleanDate"],
    }
  );

export type SignupFormData = Partial<z.infer<typeof signupFormSchema>>;

// TypeScript type for the pricing details object
export interface PriceDetails {
  basePrice: number;
  sqftSurcharge: number;
  /** v12 large-property surcharge: +$50 when sq ft is over 1,800. */
  largePropertySurcharge: number;
  laundryCost: number;
  hotTubCost: number;
  /** Per-clean price before the subscription-term discount. */
  subtotalPerClean: number;
  /** Fractional discount applied for the chosen term (0, 0.10, or 0.15). */
  discountRate: number;
  /** Dollar amount discounted from the per-clean subtotal. */
  discountAmount: number;
  totalPerClean: number;
  /**
   * The property cannot be priced from the rules and needs a manual quote —
   * either it is over the sq ft ceiling, or its bedroom/bathroom combination
   * falls outside the base price matrix.
   */
  isCustomQuote: boolean;
  /**
   * The pricing rules themselves are missing (the rule tables are empty). This
   * is a server misconfiguration, NOT a custom quote — surface it as an error
   * rather than quietly showing $0.
   */
  pricingUnavailable: boolean;
  periodicCharges: Array<{
    description: string;
    amount: number;
    cadence?: string;
  }>;
}

export interface StepsProps {
  formData: SignupFormData;
  setFormData: React.Dispatch<React.SetStateAction<SignupFormData>>;
  errors: Record<string, string[] | undefined>;
}
