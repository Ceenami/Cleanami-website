import { NextRequest, NextResponse } from "next/server";
import { getPropertiesWithOwner } from "@/lib/queries/properties";
import { createClient } from "@/lib/supabase/server";
import {
  customerAuthErrorStatus,
  resolvePortalCustomerScope,
} from "@/lib/customer-auth";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const userRole = data?.claims?.user_metadata?.role as string | undefined;

    const scope = await resolvePortalCustomerScope(request, userRole);
    if (scope.error) {
      return NextResponse.json(
        { error: scope.error, data: [], nextPage: null },
        { status: customerAuthErrorStatus(scope.error) }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const query = searchParams.get("query") || "";

    const result = await getPropertiesWithOwner({
      page,
      limit,
      query,
      customerId: scope.customerId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching properties:", error);
    return NextResponse.json(
      { error: "Failed to fetch properties" },
      { status: 500 }
    );
  }
}
