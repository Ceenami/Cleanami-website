import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { getAdminAuth } from "@/lib/admin-auth";
import { buildCandidates } from "@/lib/services/assignment/assignment-engine.service";
import { assignmentEligibility } from "@/lib/services/assignment/eligibility";
import { selectCompleteTeam } from "@/lib/services/assignment/policy";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAdminAuth(request)).isAdmin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
  if (!job?.propertyId)
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const ordered = await buildCandidates(job.propertyId),
    profiles = await db.query.cleaners.findMany({
      columns: { id: true, fullName: true },
    });
  const results = [];
  for (const candidate of ordered.slice(0, 100)) {
    const policy = await assignmentEligibility(candidate.cleanerId, id, {
      requireCompleteTeam: false,
    });
    const reasons = [...policy.reasons];
    if (candidate.score < 80) reasons.push("reliability_below_80");
    results.push({
      ...candidate,
      name:
        profiles.find((p) => p.id === candidate.cleanerId)?.fullName ??
        "Cleaner",
      reasons,
      eligible: reasons.length === 0,
    });
  }
  const cap = (
    job.checklistSnapshot as {
      capabilityRequirements?: { hotTub: boolean; laundryLead: boolean };
    } | null
  )?.capabilityRequirements;
  const team =
    job.addonsSnapshot?.requiresManualStaffing ||
    job.addonsSnapshot?.teamSize === null
      ? null
      : selectCompleteTeam(
          results.filter((c) => c.eligible),
          job.addonsSnapshot?.teamSize ?? 1,
          !!cap?.hotTub ||
            (!!job.addonsSnapshot?.hotTubServiceLevel &&
              job.addonsSnapshot.hotTubServiceLevel !== "none"),
          !!cap?.laundryLead || job.addonsSnapshot?.laundryType === "off_site",
        );
  return NextResponse.json({
    candidates: results,
    team: team?.map((c) => ({ cleanerId: c.cleanerId, name: c.name })) ?? null,
    message: team
      ? "Suggested coverage only. Assignment rechecks all locks and requirements."
      : "No complete qualified team found; admin review required.",
  });
}
