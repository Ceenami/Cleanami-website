import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { customers } from "@/db/schemas";
import {
  customerAuthErrorStatus,
  getCustomerAuth,
} from "@/lib/customer-auth";
import { updateCustomerContact } from "@/lib/services/customer-record.service";
import { customerSelfUpdateSchema } from "@/lib/validations/customer-record";
import { eq } from "drizzle-orm";

export async function GET() {
  const { customerId, error } = await getCustomerAuth();
  if (!customerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: customerAuthErrorStatus(error) }
    );
  }

  try {
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, customerId),
      columns: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
    });

    if (!customer) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json({ profile: customer });
  } catch (err) {
    console.error("[GET /api/customer/profile]", err);
    return NextResponse.json(
      { error: "Failed to load profile" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const { customerId, error } = await getCustomerAuth();
  if (!customerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: customerAuthErrorStatus(error) }
    );
  }

  try {
    const body = await request.json();
    const parsed = customerSelfUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const profile = await updateCustomerContact(customerId, parsed.data);

    return NextResponse.json({
      success: true,
      profile,
      message: parsed.data.email
        ? "Contact details updated. Your login email and billing records were updated too."
        : "Contact details updated.",
    });
  } catch (err) {
    console.error("[PATCH /api/customer/profile]", err);
    const message =
      err instanceof Error ? err.message : "Failed to update profile";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
