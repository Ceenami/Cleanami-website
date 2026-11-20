import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { beforeRequirementsStatus, waiveBeforeRequirements, BeforeRequirementError } from "@/lib/services/before-requirements.service";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminAuth(request)).isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid job" }, { status: 400, headers });
  try { return NextResponse.json(await beforeRequirementsStatus(id), { headers }); }
  catch { return NextResponse.json({ error: "Before evidence is unavailable" }, { status: 503, headers }); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin || !auth.actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const { id } = await params;
  try {
    z.uuid().parse(id);
    const body = z.object({ reason: z.string().trim().min(10).max(1000) }).strict().parse(await request.json());
    return NextResponse.json(await waiveBeforeRequirements(id, auth.actorId, body.reason), { headers });
  } catch (error) {
    const status = error instanceof ZodError || error instanceof SyntaxError ? 400 : error instanceof BeforeRequirementError ? 409 : 503;
    return NextResponse.json({ error: status === 503 ? "Before evidence is unavailable" : (error as Error).message }, { status, headers });
  }
}
