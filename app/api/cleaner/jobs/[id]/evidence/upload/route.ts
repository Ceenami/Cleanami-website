import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
  requireCleanerJobAssignment,
} from "@/lib/cleaner-auth";
import { EVIDENCE_BUCKET, createSignedUrl } from "@/lib/storage/signed-url";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(
  request: NextRequest,
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
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const roomKey = formData.get("roomKey") as string | null;

    if (!file || !roomKey) {
      return NextResponse.json(
        { error: "file and roomKey are required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, and WebP images are allowed" },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File must be under 10MB" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const filePath = `${cleanerId}/${jobId}/${roomKey}/${Date.now()}_${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(filePath, file, { upsert: false });

    if (uploadError) {
      console.error("[evidence upload]", uploadError);
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Persist the object path (returned as `path`); the bucket is private, so
    // hand back a short-lived signed URL only for immediate client preview.
    const previewUrl = await createSignedUrl(EVIDENCE_BUCKET, filePath);

    return NextResponse.json({ path: filePath, url: previewUrl, roomKey });
  } catch (err) {
    console.error("[POST /api/cleaner/jobs/[id]/evidence/upload]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
