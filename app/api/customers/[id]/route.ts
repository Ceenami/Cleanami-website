import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import {
  deleteCustomer,
  updateCustomerContact,
} from "@/lib/services/customer-record.service";
import {
  adminCustomerUpdateSchema,
  deleteCustomerParamsSchema,
} from "@/lib/validations/customer-record";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = adminCustomerUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const customer = await updateCustomerContact(id, parsed.data);

    return NextResponse.json({ success: true, customer });
  } catch (err) {
    console.error("[PATCH /api/customers/[id]]", err);
    const message =
      err instanceof Error ? err.message : "Failed to update customer";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const parsed = deleteCustomerParamsSchema.safeParse({ customerId: id });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "This customer record looks invalid. Refresh the page and try again.",
          code: "INVALID_CUSTOMER",
        },
        { status: 400 }
      );
    }

    const result = await deleteCustomer(parsed.data.customerId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[DELETE /api/customers/[id]]", err);
    const message =
      err instanceof Error ? err.message : "Failed to delete customer";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message, code: "DELETE_BLOCKED" }, { status });
  }
}
