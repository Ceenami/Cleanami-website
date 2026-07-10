"use server";

import { markCallBooked, getResumeInfo } from "@/lib/actions/session.actions";
import { sendResumeEmail } from "@/lib/services/email.service";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://cleannami.ceenami.com";

interface BookCallResult {
  success: boolean;
  resumeUrl?: string;
  error?: string;
}

/**
 * Called when user clicks "Book a 5-Minute Setup Call".
 * Marks the session as having booked a call, generates resume URL, and sends email.
 */
export async function handleCallBooked(): Promise<BookCallResult> {
  try {
    // Mark session as having booked a call
    const markResult = await markCallBooked();
    if (!markResult.success) {
      return { success: false, error: markResult.error };
    }

    // Get session info for resume URL
    const resumeInfo = await getResumeInfo();
    if (!resumeInfo.success || !resumeInfo.sessionId) {
      return { success: false, error: "Could not generate resume link" };
    }

    // Generate resume URL
    const resumeUrl = `${BASE_URL}?resume=${resumeInfo.sessionId}`;

    // Send resume email if we have an email address
    if (resumeInfo.email) {
      const emailResult = await sendResumeEmail({
        to: resumeInfo.email,
        resumeUrl,
        recipientName: resumeInfo.name,
      });

      if (!emailResult.success) {
        // Log but don't fail - the booking still happened
        console.error("Failed to send resume email:", emailResult.error);
      }
    }

    return {
      success: true,
      resumeUrl,
    };
  } catch (error) {
    console.error("Failed to handle call booking:", error);
    return { success: false, error: "Failed to process booking" };
  }
}