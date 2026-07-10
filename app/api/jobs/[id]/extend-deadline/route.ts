import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const user = data?.claims;
    const userRole = user?.user_metadata?.role;

    if (userRole !== "admin" && userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { newDeadline } = await request.json();

    if (!newDeadline) {
      return NextResponse.json(
        { error: "New deadline is required" },
        { status: 400 }
      );
    }

    await db
      .update(jobs)
      .set({
        checkInTime: new Date(newDeadline),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error extending deadline:", error);
    return NextResponse.json(
      { error: "Failed to extend deadline" },
      { status: 500 }
    );
  }
}

// import { NextRequest, NextResponse } from 'next/server';

// export async function POST(
//   request: NextRequest,
// ) {
//   return NextResponse.json(
//       { error: 'Placeholder route' },
//       { status: 500 }
//     );
// }
