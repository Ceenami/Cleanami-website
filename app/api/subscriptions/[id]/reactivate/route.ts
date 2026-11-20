import { financeErrorMessage } from "@/lib/services/payment/rental-finance-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { reactivateRentalSubscription } from "@/lib/services/payment/rental-reactivation";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin || !auth.actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const input = z.object({ startDate: z.string(), endDate: z.string(), durationMonths: z.number().int().min(1).max(6), reason: z.string().trim().min(10).max(1000), requestId: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !input.success) return NextResponse.json({ error: "Provide explicit new dates, term, request ID and reason" }, { status: 400 });
  try { return NextResponse.json(await reactivateRentalSubscription(id, auth.actorId, input.data), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: financeErrorMessage(error, "Reactivation needs review") }, { status: 409 }); }
}
