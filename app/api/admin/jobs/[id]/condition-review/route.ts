import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { actOnConditionReview, ConditionReviewError, conditionReviewActionSchema, loadConditionReview } from "@/lib/services/condition-review.service";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  try {
    return NextResponse.json(await loadConditionReview(id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ConditionReviewError ? error.message : "Could not load condition review" }, { status: error instanceof ConditionReviewError ? error.status : 500 });
  }
}
export async function POST(request: NextRequest, { params }: Context) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin || !auth.actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const input = conditionReviewActionSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !input.success)
    return NextResponse.json({ error: "Provide a valid action and a reason for rejection (up to 2000 characters)." }, { status: 400 });
  try {
    return NextResponse.json(await actOnConditionReview(id, auth.actorId, input.data));
  } catch (error) {
    console.error("[condition-review] action failed", error);
    return NextResponse.json({ error: error instanceof ConditionReviewError ? error.message : "Could not complete the action. Reload to check the recorded rejection and refund before retrying." }, { status: error instanceof ConditionReviewError ? error.status : 500 });
  }
}
