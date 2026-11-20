import { NextResponse } from "next/server";
import { z } from "zod";
import { getCleanerAuth, cleanerAuthErrorStatus, requireCleanerJobAssignment } from "@/lib/cleaner-auth";
import { respondToReconfirmation } from "@/lib/services/assignment/lifecycle.service";

const schema = z.object({ reconfirmationId: z.uuid(), offerId: z.uuid(), version: z.number().int().positive(), scheduleVersion: z.number().int().positive(), role: z.enum(["primary", "laundry_lead", "backup"]), response: z.enum(["confirmed", "cannot_fulfill"]) }).strict();
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCleanerAuth();
  if (!auth.cleanerId) return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: cleanerAuthErrorStatus(auth.error), headers });
  const { id } = await params;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !input.success) return NextResponse.json({ error: "Invalid reconfirmation response" }, { status: 400, headers });
  if ((await requireCleanerJobAssignment(auth.cleanerId, id)).error) return NextResponse.json({ error: "Assignment required" }, { status: 403, headers });
  try { return NextResponse.json(await respondToReconfirmation({ jobId: id, cleanerId: auth.cleanerId, ...input.data }), { headers }); }
  catch { return NextResponse.json({ error: "This reconfirmation changed or a response is already recorded. Refresh before responding." }, { status: 409, headers }); }
}
