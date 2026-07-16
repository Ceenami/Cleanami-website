import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { onboardingDocuments } from "@/db/schemas";
import { and, eq } from "drizzle-orm";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import {
  CLICK_TO_SIGN_DOCS,
  signDocument,
  uploadW9,
  type LegalDocumentType,
} from "@/lib/services/legal-docs/legal-docs.service";

export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }
  const rows = await db
    .select({ documentType: onboardingDocuments.documentType })
    .from(onboardingDocuments)
    .where(
      and(
        eq(onboardingDocuments.cleanerId, cleanerId),
        eq(onboardingDocuments.signed, true)
      )
    );
  return NextResponse.json({ signed: rows.map((r) => r.documentType) });
}

const ALLOWED_W9_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_W9_SIZE = 10 * 1024 * 1024;

function clientIp(request: NextRequest): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

export async function POST(request: NextRequest) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const form = await request.formData();
    const documentType = form.get("documentType") as LegalDocumentType | null;
    const ip = clientIp(request);

    if (documentType === "w9") {
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "A W-9 file is required." },
          { status: 400 }
        );
      }
      if (!ALLOWED_W9_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: "W-9 must be a PDF, JPG, or PNG." },
          { status: 400 }
        );
      }
      if (file.size > MAX_W9_SIZE) {
        return NextResponse.json(
          { error: "W-9 file must be under 10MB." },
          { status: 400 }
        );
      }
      await uploadW9({ cleanerId, file, ipAddress: ip });
      return NextResponse.json({ success: true, documentType: "w9" });
    }

    if (documentType && CLICK_TO_SIGN_DOCS.includes(documentType)) {
      const signedName = (form.get("signedName") as string | null)?.trim();
      if (!signedName || signedName.length < 2) {
        return NextResponse.json(
          { error: "Please type your full name to sign." },
          { status: 400 }
        );
      }
      await signDocument({ cleanerId, documentType, signedName, ipAddress: ip });
      return NextResponse.json({ success: true, documentType });
    }

    return NextResponse.json(
      { error: "Invalid document type." },
      { status: 400 }
    );
  } catch (err) {
    console.error("[POST /api/cleaner/onboarding/legal-documents]", err);
    const message =
      err instanceof Error ? err.message : "Failed to save document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
