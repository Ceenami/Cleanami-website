import { NextRequest, NextResponse } from "next/server";
import { getCleaners } from "@/lib/queries/cleaners";
import { getAdminAuth } from "@/lib/admin-auth";
import { getDbOrNull, getDatabaseUnavailableMessage } from "@/db";

export async function GET(request: NextRequest) {
  try {
    const { isAdmin, error: authError } = await getAdminAuth(request);

    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized", data: [], nextPage: null },
        { status: 401 }
      );
    }

    if (!getDbOrNull()) {
      return NextResponse.json(
        {
          error: getDatabaseUnavailableMessage(),
          data: [],
          nextPage: null,
        },
        { status: 503 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get("limit") || "15", 10) || 15)
    );
    const query = searchParams.get("query") || "";

    const result = await getCleaners({ page, limit, query });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching cleaners:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch cleaners";
    return NextResponse.json(
      { error: message, data: [], nextPage: null },
      { status: 500 }
    );
  }
}
