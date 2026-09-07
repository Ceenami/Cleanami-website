import { getResend, getEmailUnavailableMessage, EMAIL_FROM } from "@/lib/resend";
import CustomerPortalEmail from "../emails/CustomerPortalEmail";
import ResumeSetupEmail from "../emails/ResumeSetupEmail";
import TransactionalEmail, {
  type TransactionalEmailProps,
} from "../emails/TransactionalEmail";
import { SUPPORT_EMAIL } from "@/lib/constants/contact";
import {
  entryAccessReminder,
  RESIDENTIAL_CANCELLATION_POLICY,
  SERVICE_TYPE_LABELS,
} from "@/lib/constants/service-type";

/**
 * `YYYY-MM-DD` is a calendar date, not an instant. Parsing it with `new Date()`
 * reads it as UTC midnight, which renders as the PREVIOUS day for every reader
 * east of Greenwich and for anyone whose runtime is not UTC — so a customer in
 * Florida is told their clean is a day earlier than it is. Split the fields and
 * build the label from them.
 */
function formatEasternDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

type SendResult = { success: boolean; error?: string };

/** Generic branded transactional send. No-ops gracefully if Resend is unset. */
export async function sendTransactionalEmail(
  to: string,
  subject: string,
  props: TransactionalEmailProps
): Promise<SendResult> {
  try {
    const resend = getResend();
    if (!resend) return { success: false, error: getEmailUnavailableMessage() };

    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      react: TransactionalEmail(props),
    });
    if (error) {
      console.error("Resend error:", error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (error) {
    console.error("Failed to send transactional email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://cleanami.ceenami.com";

export function sendBookingConfirmationEmail(params: {
  to: string;
  name?: string;
  propertyAddress: string;
  firstCleanDate: string;
  amount: string;
}): Promise<SendResult> {
  return sendTransactionalEmail(params.to, "Your CleanNami booking is confirmed", {
    previewText: "Your CleanNami booking is confirmed.",
    heading: "Booking confirmed 🎉",
    greeting: params.name ? `Hi ${params.name},` : "Hi there,",
    bodyLines: [
      `Your cleaning subscription for ${params.propertyAddress} is confirmed.`,
      `Your first clean is scheduled for ${params.firstCleanDate}.`,
      `Amount charged for the first clean: ${params.amount}.`,
    ],
    ctaLabel: "Open your portal",
    ctaUrl: `${APP_URL}/customer/dashboard`,
    footnote: "You can manage or cancel cleans anytime from your portal.",
  });
}

export function sendJobCompletionEmail(params: {
  to: string;
  name?: string;
  propertyAddress: string;
}): Promise<SendResult> {
  return sendTransactionalEmail(params.to, "Your clean is complete", {
    previewText: "Your CleanNami clean is complete.",
    heading: "Your clean is complete ✨",
    greeting: params.name ? `Hi ${params.name},` : "Hi there,",
    bodyLines: [
      `Your cleaner has finished the turnover at ${params.propertyAddress}.`,
      "Photo evidence and the completed checklist are available in your portal.",
    ],
    ctaLabel: "View details",
    ctaUrl: `${APP_URL}/customer/dashboard`,
  });
}

/**
 * The residential booking confirmation. The client specified the fields:
 * customer name, address, service type, date and arrival time, price, pet
 * status and fee, entry/access reminder, payment status, support contact.
 *
 * The entry line comes from `entryAccessReminder()` — the method, never the
 * code. `entry_instructions` is a credential store and email is exactly the
 * surface it must never reach, so there is deliberately no parameter here that
 * could carry one.
 *
 * The cancellation sentence is not decoration: charging at booking creates an
 * obligation the hold model does not, so the customer has to be told the refund
 * path exists. Behind it is `cancelJobAsAdmin()` -> `voidCharge()`.
 */
export type ResidentialBookingConfirmation = {
  to: string;
  name?: string;
  propertyAddress: string;
  /** `YYYY-MM-DD`, as the customer chose it. */
  cleanDate: string;
  /** e.g. "9:00 AM". */
  arrivalTimeLabel: string;
  amount: string;
  petsAllowed: boolean;
  petFeeApplied: boolean;
  entryMethod: string | null;
};

/**
 * The email's content, separated from sending it, so both the field list and
 * the no-door-code rule can actually be asserted. `sendTransactionalEmail`
 * returns `{ success, error }` and nothing about what it sent.
 */
export function buildResidentialBookingConfirmationEmail(
  params: ResidentialBookingConfirmation
): { subject: string; props: TransactionalEmailProps } {
  const cleanDateLabel = formatEasternDateLabel(params.cleanDate);

  return {
    subject: "Your CleanNami house cleaning is booked",
    props: {
      previewText: "Your one-time house cleaning is confirmed.",
      heading: "Your clean is booked 🎉",
      greeting: params.name ? `Hi ${params.name},` : "Hi there,",
      bodyLines: [
        `Service: ${SERVICE_TYPE_LABELS.residential_one_time}.`,
        `Address: ${params.propertyAddress}.`,
        `Date: ${cleanDateLabel}. Your cleaner will arrive at ${params.arrivalTimeLabel}.`,
        `Paid today: ${params.amount}. Your payment is complete — there is nothing to pay on the day.`,
        params.petsAllowed
          ? params.petFeeApplied
            ? "Pets: yes. A $10 pet fee is included in the total above."
            : "Pets: yes."
          : "Pets: none reported.",
        entryAccessReminder(params.entryMethod),
        RESIDENTIAL_CANCELLATION_POLICY,
        `Questions? Reply to this email or contact us at ${SUPPORT_EMAIL}.`,
      ],
      ctaLabel: "Open your portal",
      ctaUrl: `${APP_URL}/customer/dashboard`,
    },
  };
}

export function sendResidentialBookingConfirmationEmail(
  params: ResidentialBookingConfirmation
): Promise<SendResult> {
  const { subject, props } = buildResidentialBookingConfirmationEmail(params);
  return sendTransactionalEmail(params.to, subject, props);
}

/**
 * Admin alert by email, alongside the in-app row `notifyAdmins` always writes.
 *
 * The spec says email is "also used for admin alerts"; it never was. Reserved
 * for time-sensitive triggers — see `notifyAdmins`'s
 * `email` flag for why this is not the default.
 */
export function sendAdminAlertEmail(params: {
  to: string;
  name?: string;
  subject: string;
  message: string;
  url?: string;
}): Promise<SendResult> {
  return sendTransactionalEmail(params.to, `[CleanNami admin] ${params.subject}`, {
    previewText: params.subject,
    heading: params.subject,
    greeting: params.name ? `Hi ${params.name},` : "Hi,",
    bodyLines: [params.message],
    ctaLabel: params.url ? "Open in the dashboard" : undefined,
    ctaUrl: params.url ? `${APP_URL}${params.url}` : undefined,
  });
}

export function sendCancellationEmail(params: {
  to: string;
  name?: string;
  propertyAddress: string;
  detail?: string;
}): Promise<SendResult> {
  return sendTransactionalEmail(params.to, "A clean was canceled", {
    previewText: "A CleanNami clean was canceled.",
    heading: "Clean canceled",
    greeting: params.name ? `Hi ${params.name},` : "Hi there,",
    bodyLines: [
      `A scheduled clean for ${params.propertyAddress} has been canceled.`,
      params.detail ?? "No charge applies for an on-time cancellation.",
    ],
    ctaLabel: "View your schedule",
    ctaUrl: `${APP_URL}/customer/dashboard`,
  });
}

export function sendPaymentFailedEmail(params: {
  to: string;
  name?: string;
  propertyAddress: string;
}): Promise<SendResult> {
  return sendTransactionalEmail(params.to, "Action needed: payment failed", {
    previewText: "A CleanNami payment failed.",
    heading: "We couldn't process your payment",
    greeting: params.name ? `Hi ${params.name},` : "Hi there,",
    bodyLines: [
      `A payment for your clean at ${params.propertyAddress} failed.`,
      "Please update your payment method to avoid interruption to your service.",
    ],
    ctaLabel: "Update payment",
    ctaUrl: `${APP_URL}/customer/dashboard`,
  });
}

export function sendCleanerAssignmentEmail(params: {
  to: string;
  name?: string;
  propertyAddress: string;
  jobDate: string;
}): Promise<SendResult> {
  return sendTransactionalEmail(params.to, "You've been assigned a new clean", {
    previewText: "New CleanNami job assignment.",
    heading: "New job assigned 🧽",
    greeting: params.name ? `Hi ${params.name},` : "Hi there,",
    bodyLines: [
      `You've been assigned a clean at ${params.propertyAddress}.`,
      `Scheduled for ${params.jobDate}.`,
    ],
    ctaLabel: "View job",
    ctaUrl: `${APP_URL}/cleaner/jobs`,
  });
}

interface SendResumeEmailParams {
  to: string;
  resumeUrl: string;
  recipientName?: string;
}

/**
 * Sends the resume setup email after a call is booked.
 */
interface SendCustomerPortalEmailParams {
  to: string;
  loginUrl: string;
  recipientName?: string;
  isNewUser?: boolean;
}

export async function sendCustomerPortalEmail({
  to,
  loginUrl,
  recipientName,
  isNewUser,
}: SendCustomerPortalEmailParams): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: getEmailUnavailableMessage() };
    }

    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: "Your CleanNami customer portal is ready",
      react: CustomerPortalEmail({ loginUrl, recipientName, isNewUser }),
    });

    if (error) {
      console.error("Resend error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to send customer portal email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendResumeEmail({
  to,
  resumeUrl,
  recipientName,
}: SendResumeEmailParams): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResend();
    if (!resend) {
      return { success: false, error: getEmailUnavailableMessage() };
    }

    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: "Your CleanNami setup call + resume link",
      react: ResumeSetupEmail({ resumeUrl, recipientName }),
    });

    if (error) {
      console.error("Resend error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to send resume email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
