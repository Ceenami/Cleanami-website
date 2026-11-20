import { financeErrorMessage } from "@/lib/services/payment/rental-finance-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { adminFinanceAction, loadJobFinance } from "@/lib/services/payment/rental-finance-admin";
type Context = { params: Promise<{ id: string }> };
const inputSchema = z.object({ action: z.enum(["retry_fee", "reconcile", "waive_fee", "waive_clean_balance", "refund_fee", "release_credit_hold"]), reason: z.string().trim().min(10).max(1000), requestId: z.string().uuid() }).strict();
export async function GET(request: NextRequest, { params }: Context) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  try { return NextResponse.json(await loadJobFinance(id), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: financeErrorMessage(error, "Could not load financial history") }, { status: 404 }); }
}
export async function POST(request: NextRequest, { params }: Context) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin || !auth.actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params, input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !input.success) return NextResponse.json({ error: "Provide an action, request ID and 10–1000 character reason" }, { status: 400 });
  try { return NextResponse.json(await adminFinanceAction(id, auth.actorId, input.data), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: financeErrorMessage(error, "Financial action needs review") }, { status: 409 }); }
}
