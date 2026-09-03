import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { getAdminAuth } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { createSignedUrl } from "@/lib/storage/signed-url";
import {
  DOCUMENT_SLOTS,
  ONBOARDING_DOCUMENTS_BUCKET,
  labelForDocumentObject,
  type CleanerDocument,
  type CleanerDocumentsResponse,
} from "@/lib/cleaner/onboarding-documents";

/**
 * *"a simple admin-side view/download link on the
 * cleaner profile"*.
 *
 * Reads the bucket directly rather than an index table. `onboarding_documents`
 * exists as a table with an enum and an RLS policy and has **no writer anywhere
 * in either repo**, so it indexes nothing; writing rows into it to make this
 * list prettier would be a migration plus a sync problem in exchange for a
 * nicer label, and item 17 is explicitly not asking for a document-management
 * system.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error: authError } = await getAdminAuth(req);
  if (!isAdmin) {
    return NextResponse.json(
      { error: authError ?? "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;

  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, id),
    columns: { id: true, legalDocsSigned: true },
  });

  if (!cleaner) {
    return NextResponse.json({ error: "Cleaner not found" }, { status: 404 });
  }

  const supabase = createAdminClient();
  const { data: objects, error } = await supabase.storage
    .from(ONBOARDING_DOCUMENTS_BUCKET)
    .list(id, { limit: 100, sortBy: { column: "created_at", order: "desc" } });

  if (error) {
    console.error("[cleaner-documents] list failed:", error);
    return NextResponse.json(
      { error: "Could not list documents" },
      { status: 502 }
    );
  }

  // Sequential, not `Promise.all`: these are network calls to the storage API
  // and there are at most a handful per cleaner.
  const documents: CleanerDocument[] = [];
  for (const object of objects ?? []) {
    // `list` returns a placeholder row for an empty folder; it has no id.
    if (!object.id) continue;
    documents.push({
      name: object.name,
      label: labelForDocumentObject(object.name),
      sizeBytes:
        (object.metadata as { size?: number } | null)?.size ?? null,
      uploadedAt: object.created_at ?? null,
      url: await createSignedUrl(
        ONBOARDING_DOCUMENTS_BUCKET,
        `${id}/${object.name}`
      ),
    });
  }

  const signed = cleaner.legalDocsSigned ?? {};
  const acknowledgedOnly: { key: string; label: string }[] = [];
  const missing: { key: string; label: string }[] = [];

  for (const slot of DOCUMENT_SLOTS) {
    const value = (signed as Record<string, string | null | undefined>)[slot.key];
    const hasFile = documents.some((d) => d.label === slot.label);
    if (hasFile) continue;
    if (value) acknowledgedOnly.push({ key: slot.key, label: slot.label });
    else missing.push({ key: slot.key, label: slot.label });
  }

  const body: CleanerDocumentsResponse = {
    documents,
    acknowledgedOnly,
    missing,
  };
  return NextResponse.json(body);
}
