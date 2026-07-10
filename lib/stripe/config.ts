import Stripe from "stripe";
import { getStripe } from "./get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";

export { getStripe } from "./get-stripe";

/** Publishable key must match the secret key mode (test vs live). */
export function getStripePublishableKey(): string {
  const mode =
    process.env.NEXT_PUBLIC_STRIPE_MODE ?? process.env.STRIPE_MODE;

  if (mode === "test") {
    return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  }

  if (mode === "live") {
    return (
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE ??
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
      ""
    );
  }

  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE ??
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    ""
  );
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripe();
    if (!client) {
      throw new Error(SERVICE_UNAVAILABLE.stripe);
    }

    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
