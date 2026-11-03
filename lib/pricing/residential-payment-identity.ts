import { createHash } from "node:crypto";

/** Server request identity covers terms even when two selections cost the same. */
export function residentialPaymentIdentity(input: {
  inputIdentity: string;
  email: string;
  address: string;
  cleanDate: string;
  arrivalWindow: string;
  amountCents: number;
  promoCode: string | null;
  promoDiscountCents: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.inputIdentity,
        input.email.trim().toLowerCase(),
        input.address.trim().toLowerCase(),
        input.cleanDate,
        input.arrivalWindow,
        input.amountCents,
        input.promoCode?.trim().toUpperCase() ?? "",
        input.promoDiscountCents,
      ]),
    )
    .digest("hex");
}
