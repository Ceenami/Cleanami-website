import Stripe from "stripe";

let stripeClient: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (stripeClient !== undefined) {
    return stripeClient;
  }

  const key = (() => {
    const mode = process.env.STRIPE_MODE;
    if (mode === "test") {
      return process.env.STRIPE_SECRET_KEY;
    }
    if (mode === "live") {
      return process.env.STRIPE_SECRET_KEY_LIVE ?? process.env.STRIPE_SECRET_KEY;
    }
    return process.env.STRIPE_SECRET_KEY_LIVE ?? process.env.STRIPE_SECRET_KEY;
  })();

  if (!key) {
    stripeClient = null;
    return null;
  }

  stripeClient = new Stripe(key, {
    // https://github.com/stripe/stripe-node#configuration
    // @ts-expect-error Required for this project's Stripe SDK version
    apiVersion: null,
    appInfo: {
      name: "CleanNami",
      version: "0.1.0",
      url: "https://cleannami.com",
    },
  });

  return stripeClient;
}
