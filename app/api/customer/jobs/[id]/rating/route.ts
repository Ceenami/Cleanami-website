import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  customerAuthErrorStatus,
  getCustomerAuth,
} from "@/lib/customer-auth";
import { submitRating } from "@/lib/services/ratings/ratings.service";

const ratingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { customerId, error } = await getCustomerAuth();
  if (!customerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: customerAuthErrorStatus(error) }
    );
  }

  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = ratingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Rating must be 1–5 stars." },
        { status: 400 }
      );
    }

    const result = await submitRating({
      jobId: id,
      customerId,
      stars: parsed.data.stars,
      comment: parsed.data.comment,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[POST /api/customer/jobs/[id]/rating]", err);
    const message = err instanceof Error ? err.message : "Failed to submit rating";
    const status =
      message === "Forbidden" ? 403 : message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
