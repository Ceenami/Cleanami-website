import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePortalCustomerScope, customerAuthErrorStatus } from "@/lib/customer-auth";
import { ChecklistNotFound, loadJobChecklistView } from "@/lib/services/checklist-view.service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await resolvePortalCustomerScope(request);
    if (scope.error) return NextResponse.json({ error: "Unauthorized" }, { status: customerAuthErrorStatus(scope.error) });
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid job" }, { status: 400 });
    const checklist = await loadJobChecklistView(id, scope.customerId ? { kind: "customer", customerId: scope.customerId } : { kind: "admin" });
    return NextResponse.json({ checklist,
      snapshot: checklist.record === "issued",
      files: checklist.files.filter(file => file.url),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ChecklistNotFound ? "Not found" : "Could not load checklist. Refresh or contact management." }, { status: error instanceof ChecklistNotFound ? 404 : 500 });
  }
}
