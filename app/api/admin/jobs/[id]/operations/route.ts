import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/db";
import {
  assignmentRuns,
  publicJobNotes,
  evidenceDrafts,
  phase2cAudit,
  jobs,
  propertyChecklistState,
  cleaners,
  evidenceUploadManifest,
} from "@/db/schemas";
import { and, eq, desc, inArray } from "drizzle-orm";
import { getAdminAuth } from "@/lib/admin-auth";
import { calculateResidentialMargin } from "@/lib/pricing/residential-margin";
import { summarizeEvidenceRooms } from "@/lib/cleaner/upload-status";
import { isChecklistSnapshot } from "@/lib/cleaner/checklist-snapshot";
import type { ChecklistLogPayload } from "@/lib/cleaner/evidence";
import { effectiveChecklist } from "@/lib/services/effective-checklist";
import { getExecutionContract } from "@/lib/services/job-execution-contract";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminAuth(request)).isAdmin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, id),
    with: { cleaners: true, evidencePacket: true, payouts: true },
  });
  if (!job)
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  job.checklistSnapshot = await effectiveChecklist(id, job.checklistSnapshot);
  const issued = await getExecutionContract(id);
  const runs = await db
    .select()
    .from(assignmentRuns)
    .where(eq(assignmentRuns.jobId, id))
    .orderBy(desc(assignmentRuns.createdAt))
    .limit(20);
  const notes = await db
    .select()
    .from(publicJobNotes)
    .where(eq(publicJobNotes.jobId, id))
    .orderBy(desc(publicJobNotes.createdAt))
    .limit(50);
  const drafts = await db
    .select()
    .from(evidenceDrafts)
    .where(eq(evidenceDrafts.jobId, id));
  const published = job.propertyId
    ? await db.query.propertyChecklistState.findFirst({
        where: eq(propertyChecklistState.propertyId, job.propertyId),
        columns: { publishedRevision: true },
      })
    : null;
  const names = await db
    .select({ id: cleaners.id, name: cleaners.fullName })
    .from(cleaners);
  const uploadEvents = await db
    .select({
      kind: phase2cAudit.kind,
      actorId: phase2cAudit.actorId,
      payload: phase2cAudit.payload,
    })
    .from(phase2cAudit)
    .where(
      and(
        eq(phase2cAudit.subjectId, id),
        inArray(phase2cAudit.kind, [
          "evidence_upload_state",
          "evidence_photo_uploaded",
        ]),
      ),
    );
  if (issued) {
    const manifest = await db.select().from(evidenceUploadManifest).where(eq(evidenceUploadManifest.jobId, id));
    const verifiedRooms: Record<string, string[]> = {};
    for (const photo of manifest) {
      if (photo.state === "removed") continue;
      if (photo.state === "verified") {
        (verifiedRooms[photo.roomKey] ??= []).push(photo.path);
        uploadEvents.push({ kind: "evidence_photo_uploaded", actorId: photo.cleanerId,
          payload: { roomKey: photo.roomKey, clientUploadId: photo.uploadId, path: photo.path } });
      } else uploadEvents.push({ kind: "evidence_upload_state", actorId: photo.cleanerId,
        payload: { uploadId: photo.uploadId, roomKey: photo.roomKey, capturedAt: photo.createdAt.toISOString(),
          revision: 1, state: "pending", issue: null } });
    }
    if (Object.keys(verifiedRooms).length) drafts.push({ jobId: id, cleanerId: "issued-manifest",
      explanations: {}, state: { checklistLog: { items: [], roomPhotos: verifiedRooms }, cleanerNotes: "" }, updatedAt: new Date() });
  }
  const photoRequirements = issued?.rooms ?? (isChecklistSnapshot(job.checklistSnapshot)
    ? (job.checklistSnapshot.photoRequirements ?? [])
    : []);
  const submittedPhotos =
    (job.evidencePacket?.checklistLog as ChecklistLogPayload | null)
      ?.roomPhotos ?? {};
  return NextResponse.json({
    runs,
    notes,
    drafts,
    margin: calculateResidentialMargin(job),
    residentialAllocations: job.cleaners
      .filter((a) => a.residentialPayTerms)
      .map((a) => ({
        cleanerId: a.cleanerId,
        addonLead: a.residentialPayTerms!.addonLead,
        baseHours: a.residentialPayTerms!.baseHours,
        leadHours: a.residentialPayTerms!.leadHours,
      })),
    evidenceRooms: summarizeEvidenceRooms(
      photoRequirements,
      submittedPhotos,
      drafts,
      uploadEvents,
    ),
    cleanerNames: Object.fromEntries(names.map((c) => [c.id, c.name])),
    reissue: {
      eligible:
        job.serviceType !== "residential_one_time" &&
        job.status === "unassigned" &&
        !!job.checkInTime &&
        job.checkInTime > new Date() &&
        !job.paymentStatus &&
        !job.paymentIntentId &&
        !job.cleaners.length &&
        !job.evidencePacket,
      expectedSnapshotHash: createHash("sha256")
        .update(JSON.stringify(job.checklistSnapshot))
        .digest("hex"),
      expectedPropertyRevision: published?.publishedRevision ?? 0,
    },
  });
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const body = z
      .object({
        text: z.string().trim().min(1).max(1000),
        category: z.enum(["note", "issue", "restocking"]),
        publicationId: z.uuid().optional(),
      })
      .strict()
      .parse(await request.json());
    const job = await db.query.jobs.findFirst({
      where: eq(jobs.id, id),
      columns: { id: true },
    });
    if (!job)
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(publicJobNotes)
        .values({
          id: body.publicationId,
          jobId: id,
          text: body.text,
          category: body.category,
          actorId: auth.actorId!,
        })
        .onConflictDoNothing()
        .returning({ id: publicJobNotes.id });
      if (!created) {
        const existing = await tx.query.publicJobNotes.findFirst({
          where: eq(publicJobNotes.id, body.publicationId!),
        });
        if (
          !existing ||
          existing.jobId !== id ||
          existing.text !== body.text ||
          existing.category !== body.category ||
          existing.actorId !== auth.actorId
        )
          throw new Error(
            "Publication version conflict: reload before changing a retried note",
          );
        return;
      }
      await tx.insert(phase2cAudit).values({
        subjectId: id,
        kind: "public_note_published",
        actorId: auth.actorId!,
        payload: body,
      });
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Publication failed" },
      { status: 400 },
    );
  }
}
