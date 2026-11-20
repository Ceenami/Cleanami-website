import { NextResponse } from "next/server";
import { z } from "zod";
import { getCleanerAuth, cleanerAuthErrorStatus, requireCleanerJobAssignment } from "@/lib/cleaner-auth";
import { readOfferCoverage, respondToOffer } from "@/lib/services/assignment/offers.service";
import { respondToPriorityMove } from "@/lib/services/assignment/priority.service";

type Context = { params: Promise<{ id: string }> };
const responseSchema = z.object({ offerId: z.uuid(), version: z.number().int().positive(), scheduleVersion: z.number().int().positive(), role: z.enum(["primary", "laundry_lead", "backup"]), response: z.enum(["accepted", "declined"]) }).strict();
const moveSchema = z.object({action:z.literal("priority_move"),planId:z.uuid(),targetScheduleVersion:z.number().int().positive(),response:z.enum(["accepted","declined"])}).strict();
const headers = { "Cache-Control": "private, no-store" };
export async function GET(_request: Request, { params }: Context) {
  const auth = await getCleanerAuth();
  if (!auth.cleanerId) return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: cleanerAuthErrorStatus(auth.error), headers });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid job" }, { status: 400, headers });
  if ((await requireCleanerJobAssignment(auth.cleanerId, id)).error) return NextResponse.json({ error: "Assignment required" }, { status: 403, headers });
  try { return NextResponse.json(await readOfferCoverage(id, auth.cleanerId), { headers }); }
  catch { return NextResponse.json({ error: "Could not load offers" }, { status: 503, headers }); }
}
export async function POST(request: Request, { params }: Context) {
  const auth = await getCleanerAuth();
  if (!auth.cleanerId) return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: cleanerAuthErrorStatus(auth.error), headers });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const move = moveSchema.safeParse(body);
  if (z.uuid().safeParse(id).success && move.success) {
    try { return NextResponse.json(await respondToPriorityMove({sourceJobId:id,cleanerId:auth.cleanerId,planId:move.data.planId,targetScheduleVersion:move.data.targetScheduleVersion,response:move.data.response}),{headers}); }
    catch { return NextResponse.json({error:"This priority proposal changed or expired. Refresh your assignments."},{status:409,headers}); }
  }
  const input = responseSchema.safeParse(body);
  if (!z.uuid().safeParse(id).success || !input.success) return NextResponse.json({ error: "Invalid offer response" }, { status: 400, headers });
  if ((await requireCleanerJobAssignment(auth.cleanerId, id)).error) return NextResponse.json({ error: "Assignment required" }, { status: 403, headers });
  try { return NextResponse.json(await respondToOffer({ jobId: id, cleanerId: auth.cleanerId, ...input.data }), { headers }); }
  catch { return NextResponse.json({ error: "This offer is no longer available or eligible. Refresh to check your recorded response." }, { status: 409, headers }); }
}
