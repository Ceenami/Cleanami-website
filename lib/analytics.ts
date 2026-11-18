// Existing website destinations. Confirm the purchase action in Google Ads before launch.
export const GA4_MEASUREMENT_ID = "G-43JSM385K7";
export const GOOGLE_ADS_ID = "AW-17499794760";
const PURCHASE_ACTION = `${GOOGLE_ADS_ID}/wQ47CITTlskbEMjaxphB`;
const BOOKING_START_ACTION = `${GOOGLE_ADS_ID}/NY5gCKPU594bEMjaxphB`;
const APPOINTMENT_CLICK_ACTION = `${GOOGLE_ADS_ID}/nbASCOrI5N4bEMjaxphB`;
// Copy only the label from the existing Contact action's Google tag setup.
const CONTACT_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONTACT_LABEL;
const PURCHASE_HISTORY_KEY = `cleannami:paid-conversions:${GOOGLE_ADS_ID}:v1`;

export type BookingConversion = { transactionId: string; amountCents: number };

/** Use only after payment and booking creation have both succeeded. */
export function bookingConversion(transactionId: unknown, amountCents: unknown): BookingConversion | undefined {
  if (typeof transactionId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(transactionId) ||
      typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) return;
  return { transactionId, amountCents };
}

export function isProductionTrackingHost(): boolean {
  return process.env.NODE_ENV === "production" && typeof window !== "undefined" &&
    ["cleannami.ceenami.com", "cleannami.com", "www.cleannami.com"]
      .includes(window.location.hostname.toLowerCase());
}

let initialized = false;
const sent = new Set<string>();

/** Session storage is optional; Google's transaction_id remains the final dedupe key. */
function wasPaidBookingSent(transactionId: string): boolean {
  if (sent.has(transactionId)) return true;
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(PURCHASE_HISTORY_KEY) ?? "[]");
    return Array.isArray(stored) && stored.slice(-256).includes(transactionId);
  } catch { return false; }
}

function rememberPaidBooking(transactionId: string): void {
  sent.add(transactionId);
  if (sent.size > 256) sent.delete(sent.values().next().value!);
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(PURCHASE_HISTORY_KEY) ?? "[]");
    const history = Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) : [];
    window.sessionStorage.setItem(PURCHASE_HISTORY_KEY, JSON.stringify([...new Set([...history, transactionId])].slice(-256)));
  } catch { /* Storage restrictions must not affect confirmation or measurement. */ }
}

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

/** These actions measure clicks, not completed signups or confirmed appointments. */
function trackInteraction(eventName: string, action?: string, parameters: Record<string, string> = {}): void {
  try {
    if (!initializeGoogleTracking()) return;
    if (action) window.gtag!("event", "conversion", { send_to: action });
  } catch { /* Keep clicks independent of Google. */ }
  try {
    if (!initializeGoogleTracking()) return;
    window.gtag!("event", eventName, { send_to: GA4_MEASUREMENT_ID, ...parameters });
  } catch { /* Analytics must never prevent navigation or opening the booking form. */ }
}

export function trackBookingStart(): void {
  trackInteraction("booking_form_open", BOOKING_START_ACTION);
}

export function trackAppointmentClick(): void {
  trackInteraction("book_appointment_click", APPOINTMENT_CLICK_ACTION);
}

export function trackContactClick(method: "email" | "phone"): void {
  if (method !== "email" && method !== "phone") return;
  const action = CONTACT_LABEL && /^[a-zA-Z0-9_-]{1,100}$/.test(CONTACT_LABEL)
    ? `${GOOGLE_ADS_ID}/${CONTACT_LABEL}` : undefined;
  trackInteraction("contact_click", action, { contact_method: method });
}

/** A tracking failure must never change the successful booking outcome. */
export function trackPaidBooking(value: unknown): void {
  try {
    const input = value as Partial<BookingConversion> | null | undefined;
    const conversion = bookingConversion(input?.transactionId, input?.amountCents);
    if (!conversion || !initializeGoogleTracking() || wasPaidBookingSent(conversion.transactionId)) return;
    window.gtag!("event", "conversion", {
      send_to: PURCHASE_ACTION,
      transaction_id: conversion.transactionId,
      value: conversion.amountCents / 100,
      currency: "USD",
    });
    rememberPaidBooking(conversion.transactionId);
  } catch { /* Keep payment/booking confirmation independent of Google. */ }
}
