import { NextRequest, NextResponse } from "next/server";
import { getJobDetails } from "@/lib/queries/jobs";
import { createClient } from "@/lib/supabase/server";
import {
  customerAuthErrorStatus,
  customerOwnsJob,
  getCustomerAuth,
} from "@/lib/customer-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const user = data?.claims;
    const userRole = user?.user_metadata?.role;

    const isAdmin = userRole === "admin" || userRole === "super_admin";
    const isCustomer = userRole === "user";

    if (!isAdmin && !isCustomer) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    if (isCustomer) {
      const { customerId, error } = await getCustomerAuth();
      if (!customerId) {
        return NextResponse.json(
          { error: error ?? "Unauthorized" },
          { status: customerAuthErrorStatus(error) }
        );
      }

      const ownsJob = await customerOwnsJob(customerId, id);
      if (!ownsJob) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const job = await getJobDetails(id);
    return NextResponse.json(job);
  } catch (error) {
    console.error("Error fetching job details:", error);
    return NextResponse.json(
      { error: "Failed to fetch job details" },
      { status: 500 }
    );
  }
}
