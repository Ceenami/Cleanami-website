import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import { createRestockRequestForJob } from "@/lib/queries/restock-requests";
import { RESTOCK_URGENCIES } from "@/db/schemas";

const bodySchema = z.object({
  item: z.string().trim().min(2, "Say what is needed.").max(120),
  quantity: z.number().int().min(1).max(999).default(1),
  urgency: z.enum(RESTOCK_URGENCIES).default("normal"),
  notes: z.string().trim().max(500).optional(),
});

/** Cleaner raises a supply request from a job they are assigned to (task 1.16). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  const { id: jobId } = await params;
  const { error: assignmentError } = await requireCleanerJobAssignment(
    cleanerId,
    jobId
  );

  if (assignmentError) {
    return NextResponse.json({ error: assignmentError }, { status: 403 });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const result = await createRestockRequestForJob({
      cleanerId,
      jobId,
      ...parsed.data,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, id: result.id });
  } catch (err) {
    console.error("[POST /api/cleaner/jobs/[id]/restock]", err);
    return NextResponse.json(
      { error: "Failed to submit restock request" },
      { status: 500 }
    );
  }
}
