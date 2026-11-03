import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cleanerAuthErrorStatus, getCleanerAuth } from "@/lib/cleaner-auth";
import { uploadStatusSchema } from "@/lib/cleaner/upload-status";
import { recordEvidenceUploadStatus } from "@/lib/services/evidence-upload-status";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getCleanerAuth();
  if (!auth.cleanerId)
    return NextResponse.json(
      { error: auth.error },
      { status: cleanerAuthErrorStatus(auth.error) },
    );
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const body = uploadStatusSchema.parse(await request.json());
    await recordEvidenceUploadStatus(auth.cleanerId, id, body);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status unavailable" },
      { status: 400 },
    );
  }
}
