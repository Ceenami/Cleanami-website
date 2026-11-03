// Existing website destinations. Confirm the purchase action in Google Ads before launch.
export const GA4_MEASUREMENT_ID = "G-43JSM385K7";
export const GOOGLE_ADS_ID = "AW-17499794760";
const PURCHASE_ACTION = `${GOOGLE_ADS_ID}/wQ47CITTlskbEMjaxphB`;

export type BookingConversion = { transactionId: string; amountCents: number };

/** Use only after payment and booking creation have both succeeded. */
export function bookingConversion(transactionId: unknown, amountCents: unknown): BookingConversion | undefined {
  if (typeof transactionId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(transactionId) ||
      typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) return;
  return { transactionId, amountCents };
}

export function isProductionTrackingHost(): boolean {
  return process.env.NODE_ENV === "production" && typeof window !== "undefined" &&
    window.location.hostname === "cleannami.ceenami.com";
}

let initialized = false;
const sent = new Set<string>();

/** Queue commands before the external library loads; never load live tags on previews/local hosts. */
export function initializeGoogleTracking(): boolean {
  try {
    if (!isProductionTrackingHost()) return false;
    window.dataLayer ??= [];
    window.gtag ??= function () {
      // Google's documented queue accepts IArguments.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    if (!initialized) {
      window.gtag("js", new Date());
      window.gtag("set", "allow_ad_personalization_signals", false);
      window.gtag("config", GA4_MEASUREMENT_ID);
      window.gtag("config", GOOGLE_ADS_ID);
      initialized = true;
    }
    return true;
  } catch { return false; }
}

/** A tracking failure must never change the successful booking outcome. */
export function trackPaidBooking(value: unknown): void {
  try {
    const input = value as Partial<BookingConversion> | null | undefined;
    const conversion = bookingConversion(input?.transactionId, input?.amountCents);
    if (!conversion || !initializeGoogleTracking() || sent.has(conversion.transactionId)) return;
    window.gtag!("event", "conversion", {
      send_to: PURCHASE_ACTION,
      transaction_id: conversion.transactionId,
      value: conversion.amountCents / 100,
      currency: "USD",
    });
    sent.add(conversion.transactionId);
    if (sent.size > 256) sent.delete(sent.values().next().value!);
  } catch { /* Keep payment/booking confirmation independent of Google. */ }
}
