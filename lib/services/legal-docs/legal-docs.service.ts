import "server-only";

import { db } from "@/db";
import { cleaners, onboardingDocuments } from "@/db/schemas";
import { createAdminClient } from "@/lib/supabase/server";
import { and, eq } from "drizzle-orm";

export type LegalDocumentType =
  | "w9"
  | "contractor_agreement"
  | "liability_waiver"
  | "privacy_consent";

export const CLICK_TO_SIGN_DOCS: LegalDocumentType[] = [
  "contractor_agreement",
  "liability_waiver",
  "privacy_consent",
];

const LEGAL_BUCKET = "legal-documents";

async function upsertDocument(
  cleanerId: string,
  documentType: LegalDocumentType,
  fields: { signedName?: string | null; documentUrl?: string | null; ipAddress: string | null }
): Promise<void> {
  await db
    .insert(onboardingDocuments)
    .values({
      cleanerId,
      documentType,
      signed: true,
      signedAt: new Date(),
      signedName: fields.signedName ?? null,
      documentUrl: fields.documentUrl ?? null,
      ipAddress: fields.ipAddress,
    })
    .onConflictDoUpdate({
      target: [onboardingDocuments.cleanerId, onboardingDocuments.documentType],
      set: {
        signed: true,
        signedAt: new Date(),
        signedName: fields.signedName ?? null,
        documentUrl: fields.documentUrl ?? undefined,
        ipAddress: fields.ipAddress,
        updatedAt: new Date(),
      },
    });

  await syncLegalDocsSigned(cleanerId);
}

/** Record a click-to-sign document (typed name + timestamp + IP). */
export async function signDocument(input: {
  cleanerId: string;
  documentType: LegalDocumentType;
  signedName: string;
  ipAddress: string | null;
}): Promise<void> {
  await upsertDocument(input.cleanerId, input.documentType, {
    signedName: input.signedName,
    ipAddress: input.ipAddress,
  });
}

/** Upload the W-9 file to the private bucket and record the document. */
export async function uploadW9(input: {
  cleanerId: string;
  file: File;
  ipAddress: string | null;
}): Promise<void> {
  const supabase = await createAdminClient();
  const path = `${input.cleanerId}/w9/${Date.now()}_${input.file.name}`;
  const { error } = await supabase.storage
    .from(LEGAL_BUCKET)
    .upload(path, input.file, { upsert: true });
  if (error) {
    throw new Error(`Failed to upload W-9: ${error.message}`);
  }
  await upsertDocument(input.cleanerId, "w9", {
    documentUrl: path,
    ipAddress: input.ipAddress,
  });
}

/** Keep the legacy cleaners.legalDocsSigned in sync (used for completeness). */
async function syncLegalDocsSigned(cleanerId: string): Promise<void> {
  const docs = await db
    .select({ documentType: onboardingDocuments.documentType })
    .from(onboardingDocuments)
    .where(
      and(
        eq(onboardingDocuments.cleanerId, cleanerId),
        eq(onboardingDocuments.signed, true)
      )
    );
  const signed = new Set(docs.map((d) => d.documentType));
  const mark = (t: LegalDocumentType) => (signed.has(t) ? "signed" : null);

  await db
    .update(cleaners)
    .set({
      legalDocsSigned: {
        w9Url: mark("w9"),
        contractorAgreementUrl: mark("contractor_agreement"),
        liabilityWaiverUrl: mark("liability_waiver"),
        gpsConsentUrl: mark("privacy_consent"),
      },
      updatedAt: new Date(),
    })
    .where(eq(cleaners.id, cleanerId));
}

export type CleanerLegalDoc = {
  documentType: LegalDocumentType;
  signed: boolean;
  signedAt: string | null;
  signedName: string | null;
  ipAddress: string | null;
  downloadUrl: string | null;
};

/** Admin export: all of a cleaner's legal docs with short-lived signed URLs. */
export async function getCleanerLegalDocuments(
  cleanerId: string
): Promise<CleanerLegalDoc[]> {
  const rows = await db
    .select()
    .from(onboardingDocuments)
    .where(eq(onboardingDocuments.cleanerId, cleanerId));

  const supabase = await createAdminClient();

  return Promise.all(
    rows.map(async (r) => {
      let downloadUrl: string | null = null;
      if (r.documentUrl) {
        const { data } = await supabase.storage
          .from(LEGAL_BUCKET)
          .createSignedUrl(r.documentUrl, 60 * 10); // 10 minutes
        downloadUrl = data?.signedUrl ?? null;
      }
      return {
        documentType: r.documentType as LegalDocumentType,
        signed: r.signed,
        signedAt: r.signedAt ? r.signedAt.toISOString() : null,
        signedName: r.signedName,
        ipAddress: r.ipAddress,
        downloadUrl,
      };
    })
  );
}
