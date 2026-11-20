import { financeErrorMessage } from "@/lib/services/payment/rental-finance-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { getCustomerAuth, customerAuthErrorStatus } from "@/lib/customer-auth";
import { propertyPrepayment, refundCredit } from "@/lib/services/payment/rental-finance-admin";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  const admin = await getAdminAuth(request);
  const owner = admin.isAdmin ? null : await getCustomerAuth();
  if (!admin.isAdmin && !owner?.customerId) return NextResponse.json({ error: "Unauthorized" }, { status: customerAuthErrorStatus(owner?.error ?? null) });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid property" }, { status: 400 });
  try { return NextResponse.json(await propertyPrepayment(id, owner?.customerId ?? undefined), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "Property not found" }, { status: 404 }); }
}
export async function POST(request: NextRequest, { params }: Context) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin || !auth.actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const input = z.object({ entitlementId: z.string().uuid(), cents: z.number().int().positive(), reason: z.string().trim().min(10).max(1000), requestId: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !input.success) return NextResponse.json({ error: "Provide an amount, prepayment, request ID and reason" }, { status: 400 });
  try {
    const balances = await propertyPrepayment(id);
    if (!balances.some(b => b.id === input.data.entitlementId)) return NextResponse.json({ error: "Prepayment not found" }, { status: 404 });
    const op = await refundCredit(input.data.entitlementId, auth.actorId, input.data.reason, input.data.requestId, input.data.cents);
    return NextResponse.json({ state: op?.state, balances: await propertyPrepayment(id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: financeErrorMessage(error, "Refund needs review") }, { status: 409 }); }
}
