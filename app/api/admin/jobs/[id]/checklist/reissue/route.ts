import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/db";
import {
  jobs,
  jobsToCleaners,
  evidencePackets,
  properties,
  propertyChecklistState,
  phase2cAudit,
} from "@/db/schemas";
import { eq, sql } from "drizzle-orm";
import { getAdminAuth } from "@/lib/admin-auth";
import { issuePropertyChecklist } from "@/lib/services/property-checklists";
import { effectiveChecklist, latestChecklistRevision } from "@/lib/services/effective-checklist";
import { getExecutionContract } from "@/lib/services/job-execution-contract";
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
        expectedSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
        expectedPropertyRevision: z.number().int().nonnegative(),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(await request.json());
    await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, id))
        .for("update");
      if (
        !job ||
        job.serviceType === "residential_one_time" ||
        job.status !== "unassigned" ||
        !job.checkInTime ||
        job.checkInTime <= new Date() ||
        job.paymentStatus ||
        job.paymentIntentId ||
        !job.propertyId
      )
        throw new Error(
          "Only future, unassigned, unpaid rental jobs can be reissued",
        );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`checklist:${job.propertyId}`},0))`,
      );
      const currentChecklist = await effectiveChecklist(id, job.checklistSnapshot, tx);
      if (
        createHash("sha256")
          .update(JSON.stringify(currentChecklist))
          .digest("hex") !== body.expectedSnapshotHash
      )
        throw new Error("Version conflict: reload the job");
      const assignment = await tx.query.jobsToCleaners.findFirst({
        where: eq(jobsToCleaners.jobId, id),
      });
      const evidence = await tx.query.evidencePackets.findFirst({
        where: eq(evidencePackets.jobId, id),
      });
      if (assignment || evidence)
        throw new Error("Existing coverage or evidence prevents reissue");
      const state = await tx.query.propertyChecklistState.findFirst({
        where: eq(propertyChecklistState.propertyId, job.propertyId),
      });
      if ((state?.publishedRevision ?? 0) !== body.expectedPropertyRevision)
        throw new Error(
          "Version conflict: published property checklist changed",
        );
      const property = await tx.query.properties.findFirst({
        where: eq(properties.id, job.propertyId),
        with: { checklistFiles: true },
      });
      if (!property) throw new Error("Property not found");
      const snapshot = await issuePropertyChecklist(
        property,
        property.checklistFiles,
        tx,
      );
      const contract = await getExecutionContract(id, tx);
      const previousRevision = await latestChecklistRevision(id, tx);
      // Reissue changes company tasks only. Preserve original purchased scope,
      // room minimums, money, schedule and immutable contract rows.
      snapshot.photoRequirements = currentChecklist?.photoRequirements ?? contract?.rooms ?? snapshot.photoRequirements;
      snapshot.capabilityRequirements = currentChecklist?.capabilityRequirements ?? snapshot.capabilityRequirements;
      await tx.insert(phase2cAudit).values({
        subjectId: id,
        kind: "checklist_reissued",
        actorId: auth.actorId!,
        payload: {
          reason: body.reason,
          previous: currentChecklist,
          next: snapshot,
          executionRevision: (previousRevision?.revision ?? 0) + 1,
        },
      });
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Reissue failed" },
      { status: 409 },
    );
  }
}
