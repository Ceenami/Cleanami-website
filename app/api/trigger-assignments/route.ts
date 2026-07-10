import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const user = data?.claims;
    const userRole = user?.user_metadata?.role;

    if (userRole !== "admin" && userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: result, error } = await supabase.functions.invoke(
      "job-assignment-engine",
      { body: {} }
    );

    if (error) {
      console.error("Edge function error:", error);
      return NextResponse.json(
        { error: "Failed to run assignment engine", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error triggering assignment engine:", error);
    return NextResponse.json(
      { error: "Failed to trigger assignment engine" },
      { status: 500 }
    );
  }
}
