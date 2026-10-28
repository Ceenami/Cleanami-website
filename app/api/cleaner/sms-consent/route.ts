import { NextResponse } from "next/server";
import { z } from "zod";
import { cleanerAuthErrorStatus, getCleanerAuth } from "@/lib/cleaner-auth";
import { getCleanerOnboardingState } from "@/lib/queries/cleaner-onboarding";
import { getCleanerSmsConsentState, saveCleanerSmsConsent, SmsConsentInputError } from "@/lib/services/cleaner-sms-consent";

const inputSchema = z.object({
  optedIn: z.boolean(),
  phone: z.string().max(50),
  disclosureVersion: z.string().max(50).optional(),
});

export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) return NextResponse.json({ error: error ?? "Unauthorized" }, { status: cleanerAuthErrorStatus(error) });
  try {
    const cleaner = await getCleanerOnboardingState(cleanerId);
    return NextResponse.json(await getCleanerSmsConsentState(cleanerId, cleaner.phone));
  } catch {
    return NextResponse.json({ error: "Could not load SMS preference." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) return NextResponse.json({ error: error ?? "Unauthorized" }, { status: cleanerAuthErrorStatus(error) });
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid SMS preference." }, { status: 400 });
    await saveCleanerSmsConsent({ cleanerId, ...parsed.data, source: "profile" });
    const cleaner = await getCleanerOnboardingState(cleanerId);
    return NextResponse.json(await getCleanerSmsConsentState(cleanerId, cleaner.phone));
  } catch (err) {
    if (err instanceof SmsConsentInputError || err instanceof SyntaxError) {
      return NextResponse.json({ error: err instanceof SmsConsentInputError ? err.message : "Invalid request body." }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not save SMS preference. Please try again." }, { status: 503 });
  }
}
