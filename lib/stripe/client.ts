import { loadStripe, Stripe } from "@stripe/stripe-js";
import { getStripePublishableKey } from "@/lib/stripe/config";

let stripePromise: Promise<Stripe | null>;

export const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(getStripePublishableKey());
  }

  return stripePromise;
};
