import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cleaners, disputes } from "@/db/schemas";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import { notifyAdminsOfDispute } from "@/lib/queries/cleaner-notifications";
import { eq } from "drizzle-orm";

const VALID_TYPES = ["pay", "reliability_score", "job_assignment"] as const;

export async function POST(request: NextRequest) {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const body = (await request.json()) as {
      type?: string;
      description?: string;
    };

    if (
      !body.type ||
      !VALID_TYPES.includes(body.type as (typeof VALID_TYPES)[number])
    ) {
      return NextResponse.json(
        { error: "Valid dispute type is required" },
        { status: 400 }
      );
    }

    if (!body.description?.trim() || body.description.trim().length < 10) {
      return NextResponse.json(
        { error: "Please provide a description (at least 10 characters)" },
        { status: 400 }
      );
    }

    const cleaner = await db.query.cleaners.findFirst({
      where: eq(cleaners.id, cleanerId),
      columns: { fullName: true },
    });

    const [dispute] = await db
      .insert(disputes)
      .values({
        cleanerId,
        type: body.type as (typeof VALID_TYPES)[number],
        description: body.description.trim(),
        status: "pending",
      })
      .returning();

    if (cleaner) {
      await notifyAdminsOfDispute(cleaner.fullName, body.type);
    }

    return NextResponse.json({
      success: true,
      disputeId: dispute.id,
      message:
        "Your dispute has been submitted. We'll respond within 48 hours.",
    });
  } catch (err) {
    console.error("[POST /api/cleaner/disputes]", err);
    return NextResponse.json(
      { error: "Failed to submit dispute" },
      { status: 500 }
    );
  }
}
