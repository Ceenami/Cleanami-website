/**
 * Single source for the "we cannot price this automatically" copy.
 *
 * There were three different wordings for the same condition — the booking
 * form's, a narrower "over 3,000 sq ft" line in create-payment-intent that
 * missed the bed/bath case entirely, and the one-off panel's. The client asked
 * for the existing-property case to name support explicitly, which only works
 * if there is one place to change it.
 *
 * The explanation is constant; only the call-to-action differs, because a new
 * signup has somewhere to continue to and an existing property does not.
 */

export const CUSTOM_QUOTE_EXPLANATION =
  "Larger properties — over 3,000 sq ft, or with more bedrooms or bathrooms than our standard pricing covers — need a custom quote.";

/** New-signup flow: the booking continues and we follow up with pricing. */
export const CUSTOM_QUOTE_BOOKING_CTA =
  "Please continue and we will contact you with pricing.";

/** Existing property: there is nothing to continue to, so point at support. */
export const CUSTOM_QUOTE_EXISTING_PROPERTY_CTA =
  "Please contact CleanNami support for pricing for this property.";

export const CUSTOM_QUOTE_BOOKING_MESSAGE = `${CUSTOM_QUOTE_EXPLANATION} ${CUSTOM_QUOTE_BOOKING_CTA}`;

export const CUSTOM_QUOTE_EXISTING_PROPERTY_MESSAGE = `${CUSTOM_QUOTE_EXPLANATION} ${CUSTOM_QUOTE_EXISTING_PROPERTY_CTA}`;

/**
 * Shown when a property has laundry service but no load count, which makes its
 * price wrong rather than merely unknown. Deliberately does not ask the
 * customer to supply the number — property details are maintained by CleanNami.
 */
export const LAUNDRY_LOADS_INCOMPLETE_MESSAGE =
  "This property's laundry details are incomplete, so we cannot price it correctly. Please contact CleanNami support and we will put it right.";
