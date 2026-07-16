import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { getCleanerLegalDocuments } from "@/lib/services/legal-docs/legal-docs.service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const documents = await getCleanerLegalDocuments(id);
    return NextResponse.json({ documents });
  } catch (err) {
    console.error("[GET /api/cleaners/[id]/legal-documents]", err);
    return NextResponse.json(
      { error: "Failed to load documents" },
      { status: 500 }
    );
  }
}
