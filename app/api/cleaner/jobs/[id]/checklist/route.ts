import { NextResponse } from "next/server";
import { z } from "zod";
import { getCleanerAuth, cleanerAuthErrorStatus } from "@/lib/cleaner-auth";
import { ChecklistNotFound, loadJobChecklistView } from "@/lib/services/checklist-view.service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { cleanerId, error } = await getCleanerAuth();
    if (!cleanerId) return NextResponse.json({ error: "Unauthorized" }, { status: cleanerAuthErrorStatus(error) });
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid job" }, { status: 400 });
    return NextResponse.json(await loadJobChecklistView(id, { kind: "cleaner", cleanerId }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ChecklistNotFound ? "Not found" : "Could not load checklist. Refresh or contact management." }, { status: error instanceof ChecklistNotFound ? 404 : 500 });
  }
}
