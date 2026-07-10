"use server";

import { getDbOrNull } from "@/db";
import { onboardingSessions } from "@/db/schemas/onboardingSessions.schema";
import { eq, and, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { SignupFormData, PriceDetails } from "@/lib/validations/bookng-modal";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";

const COOKIE_NAME = "cleannami_session";
const SESSION_EXPIRY_DAYS = 7;

// ============================================================================
// TYPES
// ============================================================================

export type SessionResponse = {
  success: true;
  sessionId: string;
  currentStep: number;
  formData: Partial<SignupFormData>;
  priceDetails: PriceDetails | null;
} | {
  success: false;
  error: string;
};

// Form data fields that can be serialized to JSON (excludes File objects)
type SerializableFormData = Omit<
  SignupFormData,
  "checklistFile" | "firstCleanDate"
> & {
  firstCleanDate?: string; // ISO string
  hasChecklist?: boolean; // Flag instead of actual files
};

// ============================================================================
// HELPERS
// ============================================================================

function getExpiryDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() + SESSION_EXPIRY_DAYS);
  return date;
}

function serializeFormData(formData: Partial<SignupFormData>): SerializableFormData {
  const { checklistFile, firstCleanDate, ...rest } = formData;
  return {
    ...rest,
    firstCleanDate: firstCleanDate instanceof Date ? firstCleanDate.toISOString() : undefined,
    hasChecklist: checklistFile && checklistFile.length > 0,
  };
}

function deserializeFormData(data: Record<string, unknown>): Partial<SignupFormData> {
  const serialized = data as SerializableFormData;
  const { firstCleanDate, hasChecklist, ...rest } = serialized;
  void hasChecklist;
  return {
    ...rest,
    firstCleanDate: firstCleanDate ? new Date(firstCleanDate) : undefined,
    // Note: checklistFile cannot be restored - user will need to re-upload
    checklistFile: undefined,
  };
}

function databaseUnavailable(): SessionResponse {
  return { success: false, error: SERVICE_UNAVAILABLE.database };
}

function databaseUnavailableSimple(): { success: false; error: string } {
  return { success: false, error: SERVICE_UNAVAILABLE.database };
}

// ============================================================================
// SESSION ACTIONS
// ============================================================================

/**
 * Creates a new onboarding session and sets the session cookie.
 * Called when user starts the signup flow.
 */
export async function createSession(): Promise<SessionResponse> {
  try {
    const db = getDbOrNull();
    if (!db) return databaseUnavailable();

    const [session] = await db
      .insert(onboardingSessions)
      .values({
        expiresAt: getExpiryDate(),
      })
      .returning();

    // Set httpOnly cookie with session token
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, session.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: session.expiresAt,
      path: "/",
    });

    return {
      success: true,
      sessionId: session.id,
      currentStep: session.currentStep,
      formData: {},
      priceDetails: null,
    };
  } catch (error) {
    console.error("Failed to create session:", error);
    return { success: false, error: "Failed to create session" };
  }
}

/**
 * Loads an existing session using the cookie token.
 * Returns session data if valid and not expired.
 */
export async function loadSession(): Promise<SessionResponse> {
  try {
    const db = getDbOrNull();
    if (!db) return databaseUnavailable();

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return { success: false, error: "No session found" };
    }

    const [session] = await db
      .select()
      .from(onboardingSessions)
      .where(
        and(
          eq(onboardingSessions.sessionToken, sessionToken),
          gt(onboardingSessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      // Clear invalid cookie
      cookieStore.delete(COOKIE_NAME);
      return { success: false, error: "Session expired or invalid" };
    }

    // Don't return completed sessions
    if (session.completedAt) {
      return { success: false, error: "Session already completed" };
    }

    return {
      success: true,
      sessionId: session.id,
      currentStep: session.currentStep,
      formData: deserializeFormData(session.formData),
      priceDetails: session.priceDetails as PriceDetails | null,
    };
  } catch (error) {
    console.error("Failed to load session:", error);
    return { success: false, error: "Failed to load session" };
  }
}

/**
 * Saves current progress to the session.
 * Called on step changes and form field updates (debounced).
 */
export async function saveSessionProgress(
  formData: Partial<SignupFormData>,
  currentStep: number,
  priceDetails: PriceDetails | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDbOrNull();
    if (!db) return databaseUnavailableSimple();

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return { success: false, error: "No session found" };
    }

    const serializedData = serializeFormData(formData);

    await db
      .update(onboardingSessions)
      .set({
        formData: serializedData,
        currentStep,
        priceDetails: priceDetails as Record<string, unknown> | null,
        email: formData.email || undefined,
        phone: formData.phoneNumber || undefined,
        name: formData.name || undefined,
        updatedAt: new Date(),
        expiresAt: getExpiryDate(), // Extend expiry on activity
      })
      .where(
        and(
          eq(onboardingSessions.sessionToken, sessionToken),
          gt(onboardingSessions.expiresAt, new Date())
        )
      );

    return { success: true };
  } catch (error) {
    console.error("Failed to save session progress:", error);
    return { success: false, error: "Failed to save progress" };
  }
}

/**
 * Marks a session as having booked a call.
 * Used for analytics and to show appropriate UI on resume.
 */
export async function markCallBooked(): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDbOrNull();
    if (!db) return databaseUnavailableSimple();

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return { success: false, error: "No session found" };
    }

    await db
      .update(onboardingSessions)
      .set({
        hasBookedCall: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(onboardingSessions.sessionToken, sessionToken));

    return { success: true };
  } catch (error) {
    console.error("Failed to mark call booked:", error);
    return { success: false, error: "Failed to update session" };
  }
}

/**
 * Marks a session as completed.
 * Called after successful payment.
 */
export async function completeSession(): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getDbOrNull();
    if (!db) return databaseUnavailableSimple();

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return { success: false, error: "No session found" };
    }

    await db
      .update(onboardingSessions)
      .set({
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(onboardingSessions.sessionToken, sessionToken));

    // Clear the cookie
    cookieStore.delete(COOKIE_NAME);

    return { success: true };
  } catch (error) {
    console.error("Failed to complete session:", error);
    return { success: false, error: "Failed to complete session" };
  }
}

/**
 * Gets the resume URL for email/SMS.
 * Returns the session ID that can be used with email verification.
 */
export async function getResumeInfo(): Promise<{
  success: boolean;
  sessionId?: string;
  email?: string;
  name?: string;
  phone?: string;
  error?: string;
}> {
  try {
    const db = getDbOrNull();
    if (!db) return { success: false, error: SERVICE_UNAVAILABLE.database };

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

    if (!sessionToken) {
      return { success: false, error: "No session found" };
    }

    const [session] = await db
      .select({ 
        id: onboardingSessions.id, 
        email: onboardingSessions.email,
        name: onboardingSessions.name,
        phone: onboardingSessions.phone,
      })
      .from(onboardingSessions)
      .where(eq(onboardingSessions.sessionToken, sessionToken))
      .limit(1);

    if (!session) {
      return { success: false, error: "Session not found" };
    }

    return {
      success: true,
      sessionId: session.id,
      email: session.email || undefined,
      name: session.name || undefined,
      phone: session.phone || undefined,
    };
  } catch (error) {
    console.error("Failed to get resume info:", error);
    return { success: false, error: "Failed to get resume info" };
  }
}

/**
 * Loads a session by ID + email verification (for resume links).
 * This is the fallback when user doesn't have the cookie (different device/browser).
 */
export async function loadSessionByEmail(
  sessionId: string,
  email: string
): Promise<SessionResponse> {
  try {
    const db = getDbOrNull();
    if (!db) return databaseUnavailable();

    const [session] = await db
      .select()
      .from(onboardingSessions)
      .where(
        and(
          eq(onboardingSessions.id, sessionId),
          eq(onboardingSessions.email, email.toLowerCase()),
          gt(onboardingSessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      return { success: false, error: "Session not found or email doesn't match" };
    }

    if (session.completedAt) {
      return { success: false, error: "Session already completed" };
    }

    // Set the cookie for this browser
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, session.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: session.expiresAt,
      path: "/",
    });

    return {
      success: true,
      sessionId: session.id,
      currentStep: session.currentStep,
      formData: deserializeFormData(session.formData),
      priceDetails: session.priceDetails as PriceDetails | null,
    };
  } catch (error) {
    console.error("Failed to load session by email:", error);
    return { success: false, error: "Failed to load session" };
  }
}

/**
 * Clears the current session (start fresh).
 */
export async function clearSession(): Promise<{ success: boolean }> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  return { success: true };
}