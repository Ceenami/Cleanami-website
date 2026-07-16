import { getResend, getEmailUnavailableMessage, EMAIL_FROM } from "@/lib/resend";
import CustomerPortalEmail from "../emails/CustomerPortalEmail";
import ResumeSetupEmail from "../emails/ResumeSetupEmail";
import TransactionalEmail, {
  type TransactionalEmailProps,
} from "../emails/TransactionalEmail";

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