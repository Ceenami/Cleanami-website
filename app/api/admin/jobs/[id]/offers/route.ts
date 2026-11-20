import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { dispatchJobOffers, isOfferJob, offerPairedPromotion, readOfferCoverage, repairPairedBackups } from "@/lib/services/assignment/offers.service";
import { cancelPriorityPlan, planPropertyPriority, readPriorityPlans } from "@/lib/services/assignment/priority.service";
import { prioritySchemaReady } from "@/lib/services/assignment/priority-settings";
import { canUpgradeFutureAssignment, prepareFuturePriorityJob } from "@/lib/services/assignment/priority-preparation";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, { params }: Context) {
  if (!(await getAdminAuth(request)).isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid job" }, { status: 400, headers });
  try {
    const coverage = await readOfferCoverage(id);
    const priorityPlans = await readPriorityPlans(id);
    const canUpgradePolicy = await canUpgradeFutureAssignment(id);
    return NextResponse.json(coverage ? { ...coverage, priorityPlans,canUpgradePolicy } : prioritySchemaReady() ? { offers: [], priorityPlans,canUpgradePolicy,label: "Assignment coverage" } : null, { headers });
  }
  catch { return NextResponse.json({ error: "Could not load coverage" }, { status: 503, headers }); }
}
export async function POST(request: Request, { params }: Context) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin || !auth.actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const { id } = await params;
  const input = z.discriminatedUnion("action", [z.object({ action: z.literal("upgrade_future_policy") }).strict(), z.object({ action: z.literal("repair_backups") }).strict(), z.object({ action: z.literal("offer_promotion"), workerId: z.uuid() }).strict(), z.object({ action: z.literal("plan_priority") }).strict(), z.object({ action: z.literal("cancel_priority"), planId: z.uuid() }).strict()]).safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !input.success) return NextResponse.json({ error: "Invalid action" }, { status: 400, headers });
  try {
    if (input.data.action === "upgrade_future_policy") {
      if (!await canUpgradeFutureAssignment(id) || !await prepareFuturePriorityJob(id,auth.actorId)) return NextResponse.json({error:"Only a future unstarted job without a pending priority move can be upgraded."},{status:409,headers});
      await repairPairedBackups(id);await dispatchJobOffers(id);
      return NextResponse.json({success:true},{headers});
    }
    if (input.data.action === "plan_priority") {
      const plan = await planPropertyPriority(id, auth.actorId);
      return NextResponse.json(plan ? { success: true, planId: plan.id } : { error: "No safe property-priority plan is available. Review designation, responses, skills, availability and donor coverage." }, { status: plan ? 200 : 409, headers });
    }
    if (input.data.action === "cancel_priority") {
      await cancelPriorityPlan(id, input.data.planId, auth.actorId);
      return NextResponse.json({ success: true }, { headers });
    }
    if (!(await isOfferJob(id))) return NextResponse.json({ error: "Job is not enrolled" }, { status: 409, headers });
    if (input.data.action === "offer_promotion") await offerPairedPromotion(id, input.data.workerId, auth.actorId);
    else await repairPairedBackups(id);
    await dispatchJobOffers(id);
    return NextResponse.json({ success: true }, { headers });
  } catch { return NextResponse.json({ error: "Coverage changed or no qualified paired backup is available. Refresh and review coverage." }, { status: 409, headers }); }
}
