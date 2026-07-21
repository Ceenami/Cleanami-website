import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminAuth } from "@/lib/admin-auth";

export async function POST() {
  try {
    const { isAdmin, error: authError } = await getAdminAuth();
    if (!isAdmin) {
      return NextResponse.json(
        { error: authError ?? "Unauthorized" },
        { status: 401 }
      );
    }

    const supabase = await createClient();
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
