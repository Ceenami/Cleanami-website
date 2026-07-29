import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { db } from "@/db";
import { swapRequests } from "@/db/schemas";
import { eq } from "drizzle-orm";

/** `?status=` values the queue understands; anything else falls back to open. */
const STATUS_FILTERS = [
  "pending",
  "accepted",
  "expired",
  "cancelled",
  "urgent",
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function isStatusFilter(value: string | null): value is StatusFilter {
  return STATUS_FILTERS.includes(value as StatusFilter);
}

/**
 * Swap queue for the admin console. Defaults to the open requests that need
 * attention; `?status=all` returns the full history for review and auditing.
 */
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
    const statusParam = request.nextUrl.searchParams.get("status");
    const showAll = statusParam === "all";
    const status: StatusFilter = isStatusFilter(statusParam)
      ? statusParam
      : "pending";

    const requests = await db.query.swapRequests.findMany({
      where: showAll ? undefined : eq(swapRequests.status, status),
      with: {
        job: {
          columns: {
            checkInTime: true,
            checkOutTime: true,
          },
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
        reason: request.reason,
        scheduledAt: request.job?.checkInTime ?? null,
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
