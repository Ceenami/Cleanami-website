import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePortalCustomerScope, customerAuthErrorStatus } from "@/lib/customer-auth";
import { loadPhaseEvidence, PhaseEvidenceNotFound } from "@/lib/services/phase-evidence.service";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const scope = await resolvePortalCustomerScope(request);
    if (scope.error) return NextResponse.json({ error: "Unauthorized" }, { status: customerAuthErrorStatus(scope.error), headers });
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid job" }, { status: 400, headers });
    return NextResponse.json(await loadPhaseEvidence(id, scope.customerId), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof PhaseEvidenceNotFound ? "Not found" : "Could not load evidence. Please retry." }, { status: error instanceof PhaseEvidenceNotFound ? 404 : 503, headers });
  }
}
