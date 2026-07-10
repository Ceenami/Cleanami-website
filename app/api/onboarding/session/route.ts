import { NextRequest, NextResponse } from "next/server";
import { getDbOrNull } from "@/db";
import { onboardingSessions } from "@/db/schemas/onboardingSessions.schema";
import { eq, and, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { PriceDetails, SignupFormData } from "@/lib/validations/bookng-modal";

const COOKIE_NAME = "cleannami_session";
const SESSION_EXPIRY_DAYS = 7;

function getExpiryDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() + SESSION_EXPIRY_DAYS);
  return date;
}

function deserializeFormData(data: Record<string, unknown>): Partial<SignupFormData> {
  const { firstCleanDate, hasChecklist, ...rest } = data as Record<string, unknown> & {
    firstCleanDate?: string;
    hasChecklist?: boolean;
  };
  void hasChecklist;
  return {
    ...(rest as Partial<SignupFormData>),
    firstCleanDate: firstCleanDate ? new Date(firstCleanDate) : undefined,
    checklistFile: undefined,
  };
}

/** GET /api/onboarding/session — load existing session from cookie */
export async function GET() {
  const db = getDbOrNull();
  if (!db) return NextResponse.json({ success: false, error: "DB unavailable" });

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json({ success: false, error: "No session found" });
  }

  try {
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

    if (!session || session.completedAt) {
      cookieStore.delete(COOKIE_NAME);
      return NextResponse.json({ success: false, error: "Session expired or completed" });
    }

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      currentStep: session.currentStep,
      formData: deserializeFormData(session.formData as Record<string, unknown>),
      priceDetails: session.priceDetails ?? null,
    });
  } catch (err) {
    console.error("[GET /api/onboarding/session]", err);
    return NextResponse.json({ success: false, error: "Failed to load session" });
  }
}

/** POST /api/onboarding/session — create a new session */
export async function POST() {
  const db = getDbOrNull();
  if (!db) return NextResponse.json({ success: false, error: "DB unavailable" });

  try {
    const [session] = await db
      .insert(onboardingSessions)
      .values({ expiresAt: getExpiryDate() })
      .returning();

    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, session.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires: session.expiresAt,
      path: "/",
    });

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      currentStep: session.currentStep,
      formData: {},
      priceDetails: null,
    });
  } catch (err) {
    console.error("[POST /api/onboarding/session]", err);
    return NextResponse.json({ success: false, error: "Failed to create session" });
  }
}

/** PATCH /api/onboarding/session — save progress or mark call booked */
export async function PATCH(request: NextRequest) {
  const db = getDbOrNull();
  if (!db) return NextResponse.json({ success: false, error: "DB unavailable" });

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value;
  if (!sessionToken) return NextResponse.json({ success: false, error: "No session" });

  try {
    const body = (await request.json()) as {
      action?: "mark_call_booked";
      // formData is already serialized (no Files) from the client
      formData?: Record<string, unknown>;
      currentStep?: number;
      priceDetails?: PriceDetails | null;
    };

    if (body.action === "mark_call_booked") {
      await db
        .update(onboardingSessions)
        .set({ hasBookedCall: new Date(), updatedAt: new Date() })
        .where(eq(onboardingSessions.sessionToken, sessionToken));
      return NextResponse.json({ success: true });
    }

    const fd = body.formData ?? {};

    await db
      .update(onboardingSessions)
      .set({
        formData: fd,
        currentStep: body.currentStep ?? 1,
        priceDetails: (body.priceDetails ?? null) as Record<string, unknown> | null,
        email: typeof fd.email === "string" ? fd.email : undefined,
        phone: typeof fd.phoneNumber === "string" ? fd.phoneNumber : undefined,
        name: typeof fd.name === "string" ? fd.name : undefined,
        updatedAt: new Date(),
        expiresAt: getExpiryDate(),
      })
      .where(
        and(
          eq(onboardingSessions.sessionToken, sessionToken),
          gt(onboardingSessions.expiresAt, new Date())
        )
      );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PATCH /api/onboarding/session]", err);
    return NextResponse.json({ success: false, error: "Failed to save session" });
  }
}

/** DELETE /api/onboarding/session — clear or complete session */
export async function DELETE(request: NextRequest) {
  const db = getDbOrNull();
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(COOKIE_NAME)?.value;

  const body = await request.json().catch(() => ({})) as { complete?: boolean };

  if (sessionToken && db && body.complete) {
    try {
      await db
        .update(onboardingSessions)
        .set({ completedAt: new Date(), updatedAt: new Date() })
        .where(eq(onboardingSessions.sessionToken, sessionToken));
    } catch (err) {
      console.error("[DELETE /api/onboarding/session]", err);
    }
  }

  cookieStore.delete(COOKIE_NAME);
  return NextResponse.json({ success: true });
}
