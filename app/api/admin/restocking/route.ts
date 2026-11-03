import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import {
  getAdminRestockCounts,
  getAdminRestockDetails,
  getAdminRestockSummary,
  RestockReadError,
} from "@/lib/queries/admin-restocking";

const inputSchema = z
  .object({
    propertyId: z.uuid().optional(),
    jobId: z.uuid().optional(),
    requestId: z.uuid().optional(),
    query: z.string().max(120).default(""),
    page: z.coerce.number().int().min(1).max(500).default(1),
    includeResolved: z.enum(["0", "1"]).default("0"),
    cursor: z.string().max(256).optional(),
    countsOnly: z.enum(["0", "1"]).default("0"),
  })
  .refine((v) => !(v.propertyId && v.jobId), "Choose one property or job.");

export async function GET(request: NextRequest) {
  try {
    // Deny before validation or reads, including cross-role requests.
    if (!(await getAdminAuth(request)).isAdmin)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = inputSchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid restocking filters." },
        { status: 400 },
      );
    const input = {
      ...parsed.data,
      includeResolved: parsed.data.includeResolved === "1",
    };
    const body =
      input.countsOnly === "1"
        ? await getAdminRestockCounts(input, request)
        : input.propertyId || input.jobId
          ? await getAdminRestockDetails(input, request)
          : await getAdminRestockSummary(input, request);
    return NextResponse.json(body, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof RestockReadError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    console.error("[restocking] read failed", error);
    return NextResponse.json(
      { error: "Could not load restocking requests." },
      { status: 500 },
    );
  }
}
