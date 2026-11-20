import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { reconcileRecordedOperation } from "@/lib/services/payment/rental-finance-admin";
import { financeErrorMessage } from "@/lib/services/payment/rental-finance-error";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAdminAuth(request);
  if (!auth.isAdmin || !auth.actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const input = z.object({ providerId: z.string().regex(/^(pi|re)_[A-Za-z0-9_-]{1,200}$/), reason: z.string().trim().min(10).max(1000), requestId: z.string().uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !input.success) return NextResponse.json({ error: "Provide the recorded provider ID, request ID and review reason" }, { status: 400 });
  try {
    const op = await reconcileRecordedOperation(id, input.data.providerId, auth.actorId, input.data.reason, input.data.requestId);
    return NextResponse.json({ state: op?.state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: financeErrorMessage(error) }, { status: 409 }); }
}
