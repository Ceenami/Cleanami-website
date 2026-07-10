import { getResend, getEmailUnavailableMessage, EMAIL_FROM } from "@/lib/resend";
import CustomerPortalEmail from "../emails/CustomerPortalEmail";
import ResumeSetupEmail from "../emails/ResumeSetupEmail";

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