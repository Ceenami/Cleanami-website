import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getExecutionContract } from "./job-execution-contract";
import {
  ExecutionError,
  acknowledgeExecutionUpload,
  deviceSchema,
  recordExecutionVisit,
  reserveExecutionUpload,
} from "./job-execution";
import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { EVIDENCE_BUCKET } from "@/lib/storage/signed-url";

/** A positive contract never falls through on an error. */
export async function executionResponse(
  jobId: string,
  handle: () => Promise<unknown>,
) {
  try {
    if (!(await getExecutionContract(jobId))) return null;
    return NextResponse.json(await handle());
  } catch (error) {
    const status =
      error instanceof ExecutionError
        ? error.status
        : error instanceof ZodError || error instanceof SyntaxError
          ? 400
          : 503;
    return NextResponse.json(
      {
        error:
          status === 503
            ? "Issued-job service unavailable; retry without changing your saved evidence"
            : error instanceof Error
              ? error.message
              : "Request failed",
      },
      { status },
    );
  }
}
export async function executionVisitRequest(
  request: Request,
  jobId: string,
  cleanerId: string,
  operation: "arrival" | "departure",
) {
  const body = await request.json().catch(() => ({}));
  const device = deviceSchema.safeParse(body.location ?? body);
  return recordExecutionVisit(
    jobId,
    cleanerId,
    operation,
    device.success ? device.data : null,
    body.override?.reason,
  );
}
/** Installed-client adapter. Large files still require an updated direct-upload client. */
export async function executionLegacyUpload(
  request: Request,
  jobId: string,
  cleanerId: string,
) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size > 10485760)
    throw new ExecutionError("Photo must be at most 10 MiB", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  // Deterministic for a retry from an older installed client without an upload ID.
  const key = createHash("sha256")
    .update(
      `${jobId}:${cleanerId}:${form.get("roomKey")}:${form.get("capturedAt")}:${hash}`,
    )
    .digest("hex")
    .slice(0, 32);
  const id = `${key.slice(0, 8)}-${key.slice(8, 12)}-4${key.slice(13, 16)}-a${key.slice(17, 20)}-${key.slice(20)}`;
  const reserved = await reserveExecutionUpload(jobId, cleanerId, {
    uploadId: form.get("uploadId") || id || randomUUID(),
    roomKey: form.get("roomKey"),
    capturedAt: form.get("capturedAt"),
    byteSize: file.size,
    mime: file.type === "image/jpg" ? "image/jpeg" : file.type,
    sha256: hash,
  });
  if (!reserved.verified) {
    const { error } = await createAdminClient()
      .storage.from(EVIDENCE_BUCKET)
      .upload(reserved.path, bytes, { contentType: file.type, upsert: false });
    if (
      error &&
      !["409", "400"].includes(
        String("statusCode" in error ? error.statusCode : ""),
      )
    )
      throw new ExecutionError(
        "Storage transfer failed; retry this photo",
        503,
      );
  }
  return acknowledgeExecutionUpload(jobId, cleanerId, reserved.uploadId);
}
