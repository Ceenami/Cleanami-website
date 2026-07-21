import {
  getAllEligibleCleanersForJob,
  getAvailableCleanersForJob,
} from "@/lib/queries/cleaners-proximity";
import { getAdminAuth } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";

const SERVICE_RADIUS_MILES = 25;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { isAdmin, error: authError } = await getAdminAuth(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Get query params for options
    const searchParams = request.nextUrl.searchParams;
    const includeAll = searchParams.get("all") === "true";
    const radiusMiles = includeAll
      ? null
      : searchParams.get("radius")
        ? parseInt(searchParams.get("radius")!)
        : SERVICE_RADIUS_MILES;
    const includeOnJob = searchParams.get("includeOnJob") !== "false";

    const result = includeAll
      ? await getAllEligibleCleanersForJob(id, { includeOnJob })
      : await getAvailableCleanersForJob(id, {
          radiusMiles,
          includeOnJob,
        });

    return NextResponse.json({
      cleaners: result.cleaners,
      radiusMiles: includeAll ? null : radiusMiles,
      includeAll,
      propertyAddress: result.propertyAddress,
    });
  } catch (error) {
    console.error("Error fetching available cleaners:", error);

    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to fetch available cleaners" },
      { status: 500 }
    );
  }
}

export type GetAvailableCleanersForJobResponse = {
  cleaners: Awaited<
    ReturnType<typeof getAvailableCleanersForJob>
  >["cleaners"];
  radiusMiles: number | null;
  includeAll?: boolean;
  propertyAddress: string;
};
