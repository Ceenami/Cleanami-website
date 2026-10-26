import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { cleanerAuthErrorStatus, getCleanerAuth } from "@/lib/cleaner-auth";
import { acknowledgeLegacyPhoto, LegacyUploadError, removeLegacyPhoto, reserveLegacyPhoto } from "@/lib/services/legacy-evidence-upload";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let jobId: string | undefined;
  let operation: string | undefined;
  try {
    const auth = await getCleanerAuth();
    if (!auth.cleanerId) return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: cleanerAuthErrorStatus(auth.error) });
    jobId = (await params).id;
    const body = await request.json();
    operation = body.operation;
    if (operation === "reserve") return NextResponse.json(await reserveLegacyPhoto(jobId, auth.cleanerId, body));
    if (operation === "acknowledge" && typeof body.receipt === "string")
      return NextResponse.json(await acknowledgeLegacyPhoto(jobId, auth.cleanerId, body.receipt));
    if (operation === "remove" && typeof body.path === "string" && body.path.length < 1000)
      return NextResponse.json(await removeLegacyPhoto(jobId, auth.cleanerId, body.path));
    return NextResponse.json({ error: "Unknown photo operation" }, { status: 400 });
  } catch (error) {
    const status = error instanceof LegacyUploadError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 503;
    // No signed credentials, receipts, private notes or photo bytes in diagnostics.
    if (status !== 404) console.error("[legacy-evidence-photo]", { jobId, operation, status,
      requestId: request.headers.get("x-nf-request-id"), type: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: error instanceof LegacyUploadError ? error.message :
      status === 400 ? "Invalid photo request" : "Photo service unavailable. Saved photos are retained; retry shortly." }, { status });
  }
}
