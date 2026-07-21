import { NextRequest, NextResponse } from "next/server";
import { getCustomersWithPropertyCount } from "@/lib/queries/customers";
import { getAdminAuth } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    const { isAdmin, error: authError } = await getAdminAuth(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized" },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const query = searchParams.get("query") || "";

    const result = await getCustomersWithPropertyCount({ page, limit, query });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching customers:", error);
    return NextResponse.json(
      { error: "Failed to fetch customers" },
      { status: 500 }
    );
  }
}
