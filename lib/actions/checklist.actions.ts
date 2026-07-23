"use server";

import { db } from "@/db";
import { checklistFiles } from "@/db/schemas";
import { getAdminAuth } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { CHECKLISTS_BUCKET } from "@/lib/storage/signed-url";
import { eq } from "drizzle-orm";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

type ActionResult = { success: boolean; error?: string };

/**
 * Task 1.15 — admin uploads a new checklist version for a property. There is no
 * "active version" flag in the schema; the cleaner app shows every checklist
 * file tied to the property, and the newest is the effective one ("auto-apply
 * to next clean", spec §17.4/§18). A timestamped storage key keeps re-uploads
 * of a same-named file distinct (storage_path is unique).
 */
export async function uploadPropertyChecklist(
  propertyId: string,
  formData: FormData
): Promise<ActionResult> {
  const { isAdmin } = await getAdminAuth();
  if (!isAdmin) return { success: false, error: "Unauthorized" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "A file is required" };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { success: false, error: "Only PDF, JPEG, PNG or WebP files are allowed" };
  }
  if (file.size > MAX_SIZE) {
    return { success: false, error: "File must be under 10MB" };
  }

  const supabase = createAdminClient();
  const storagePath = `checklists/${propertyId}/${Date.now()}_${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from(CHECKLISTS_BUCKET)
    .upload(storagePath, file);

  if (uploadError) {
    console.error("[uploadPropertyChecklist]", uploadError);
    return { success: false, error: `Upload failed: ${uploadError.message}` };
  }

  await db.insert(checklistFiles).values({
    propertyId,
    fileName: file.name,
    storagePath,
    fileSize: file.size,
  });

  return { success: true };
}

/** Task 1.15 — admin removes a checklist version (storage object + row). */
export async function deletePropertyChecklist(
  fileId: string
): Promise<ActionResult> {
  const { isAdmin } = await getAdminAuth();
  if (!isAdmin) return { success: false, error: "Unauthorized" };

  const row = await db.query.checklistFiles.findFirst({
    where: eq(checklistFiles.id, fileId),
    columns: { id: true, storagePath: true },
  });
  if (!row) return { success: false, error: "Checklist file not found" };

  const supabase = createAdminClient();
  const { error: removeError } = await supabase.storage
    .from(CHECKLISTS_BUCKET)
    .remove([row.storagePath]);
  if (removeError) {
    // Log but continue — the DB row is the source of truth the app reads from.
    console.error("[deletePropertyChecklist] storage remove failed", removeError);
  }

  await db.delete(checklistFiles).where(eq(checklistFiles.id, fileId));
  return { success: true };
}
