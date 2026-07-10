import { NextRequest, NextResponse } from "next/server";
import {
  customerAuthErrorStatus,
  getCustomerAuth,
} from "@/lib/customer-auth";
import { cancelSubscriptionForCustomer } from "@/lib/services/customer-cancellation.service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { customerId, error } = await getCustomerAuth();
  if (!customerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: customerAuthErrorStatus(error) }
    );
  }

  try {
    const { id } = await params;
    const result = await cancelSubscriptionForCustomer(id, customerId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[POST /api/customer/subscriptions/[id]/cancel]", err);
    const message =
      err instanceof Error ? err.message : "Failed to cancel subscription";
    const status =
      message === "Forbidden" ? 403 : message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
