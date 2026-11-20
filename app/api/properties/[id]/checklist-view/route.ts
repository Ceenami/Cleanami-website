import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePortalCustomerScope, customerAuthErrorStatus } from "@/lib/customer-auth";
import { ChecklistNotFound, loadPropertyChecklistView } from "@/lib/services/checklist-view.service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await resolvePortalCustomerScope(request);
    if (scope.error) return NextResponse.json({ error: "Unauthorized" }, { status: customerAuthErrorStatus(scope.error) });
    const { id } = await params;
    const level = z.enum(["standard", "deep"]).safeParse(request.nextUrl.searchParams.get("level") ?? "standard");
    if (!z.uuid().safeParse(id).success || !level.success) return NextResponse.json({ error: "Invalid checklist request" }, { status: 400 });
    return NextResponse.json(await loadPropertyChecklistView(id, level.data, scope.customerId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ChecklistNotFound ? "Not found" : "Could not load checklist. Refresh or contact management." }, { status: error instanceof ChecklistNotFound ? 404 : 500 });
  }
}
