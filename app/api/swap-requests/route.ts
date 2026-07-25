import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { db } from "@/db";
import { swapRequests } from "@/db/schemas";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { isAdmin, error: authError } = await getAdminAuth(request);
    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized" },
        { status: 401 }
      );
    }

    const query = request.nextUrl.searchParams.get("query")?.toLowerCase() || "";

    const requests = await db.query.swapRequests.findMany({
      where: eq(swapRequests.status, "pending"),
      with: {
        job: {
          with: {
            property: {
              columns: {
                address: true,
              },
            },
          },
        },
        originalCleaner: {
          columns: {
            fullName: true,
          },
        },
        replacementCleaner: {
          columns: {
            fullName: true,
          },
        },
      },
      orderBy: (swapRequests, { desc }) => [desc(swapRequests.requestedAt)],
    });

    const filteredRequests = query
      ? requests.filter((request) => {
          return (
            request.jobId.toLowerCase().includes(query) ||
            request.job?.property?.address?.toLowerCase().includes(query) ||
            request.originalCleaner?.fullName?.toLowerCase().includes(query) ||
            request.replacementCleaner?.fullName?.toLowerCase().includes(query)
          );
        })
      : requests;

    return NextResponse.json(
      filteredRequests.map((request) => ({
        id: request.id,
        jobId: request.jobId,
        status: request.status,
        requestedAt: request.requestedAt,
        expiresAt: request.expiresAt,
        originalCleanerName: request.originalCleaner?.fullName ?? "Unknown",
        replacementCleanerName: request.replacementCleaner?.fullName ?? null,
        propertyAddress: request.job?.property?.address ?? null,
      }))
    );
  } catch (error) {
    console.error("Error fetching swap requests:", error);
    return NextResponse.json(
      { error: "Failed to fetch swap requests" },
      { status: 500 }
    );
  }
}
