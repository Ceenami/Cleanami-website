import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { getAdminAuth } from "@/lib/admin-auth";
import { CHECKLISTS_BUCKET, createSignedUrls } from "@/lib/storage/signed-url";
import { isChecklistSnapshot } from "@/lib/cleaner/checklist-snapshot";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, id),
    with: { property: { with: { checklistFiles: { orderBy: (files) => [desc(files.createdAt)] } } } },
  });
  if (!job?.property) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const snapshot = isChecklistSnapshot(job.checklistSnapshot) ? job.checklistSnapshot : null;
  const files = snapshot?.files ?? job.property.checklistFiles;
  const uploaded = files.filter((file) => file.storagePath);
  const signedUrls = await createSignedUrls(CHECKLISTS_BUCKET, uploaded.map((file) => file.storagePath!));
  let signedIndex = 0;
  return NextResponse.json({
    snapshot: Boolean(snapshot),
    files: files.flatMap((file) => {
      const url = file.storagePath ? signedUrls[signedIndex++] : file.sourceUrl;
      return url ? [{ id: file.id, fileName: file.fileName, url }] : [];
    }),
  });
}
