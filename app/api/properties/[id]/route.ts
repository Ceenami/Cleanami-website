import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { deleteProperty } from "@/lib/queries/properties";
import { deletePropertyParamsSchema } from "@/lib/validations/customer-record";

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
    const parsed = deletePropertyParamsSchema.safeParse({ propertyId: id });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "This property record looks invalid. Refresh the page and try again.",
          code: "INVALID_PROPERTY",
        },
        { status: 400 }
      );
    }

    const result = await deleteProperty(parsed.data.propertyId);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[DELETE /api/properties/[id]]", err);
    const message =
      err instanceof Error ? err.message : "Failed to delete property";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message, code: "DELETE_BLOCKED" }, { status });
  }
}
