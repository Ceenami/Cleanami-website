import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { listDisputes } from "@/lib/queries/disputes";

export async function GET(request: NextRequest) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const disputes = await listDisputes();
    return NextResponse.json({ disputes });
  } catch (err) {
    console.error("[GET /api/disputes]", err);
    return NextResponse.json(
      { error: "Failed to load disputes" },
      { status: 500 }
    );
  }
}
