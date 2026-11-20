import { financeErrorMessage } from "@/lib/services/payment/rental-finance-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCustomerAuth, customerAuthErrorStatus } from "@/lib/customer-auth";
import { customerFinanceAction, loadJobFinance } from "@/lib/services/payment/rental-finance-admin";
type Context = { params: Promise<{ id: string }> };
const inputSchema = z.object({ action: z.enum(["accept_topup", "pay_fee", "reconcile"]), expectedCents: z.number().int().nonnegative().optional() }).strict();
export async function GET(_request: NextRequest, { params }: Context) {
  const auth = await getCustomerAuth();
  if (!auth.customerId) return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: customerAuthErrorStatus(auth.error) });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  try { return NextResponse.json(await loadJobFinance(id, auth.customerId), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: financeErrorMessage(error, "Could not load payment") }, { status: 404 }); }
}
export async function POST(request: NextRequest, { params }: Context) {
  const auth = await getCustomerAuth();
  if (!auth.customerId) return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: customerAuthErrorStatus(auth.error) });
  const { id } = await params, input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !input.success) return NextResponse.json({ error: "Invalid payment action" }, { status: 400 });
  try { return NextResponse.json(await customerFinanceAction(id, auth.customerId, input.data.action, input.data.expectedCents), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: financeErrorMessage(error, "Payment needs review") }, { status: 409 }); }
}
