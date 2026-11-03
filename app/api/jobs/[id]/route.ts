import { NextRequest, NextResponse } from "next/server";
import { getJobDetails } from "@/lib/queries/jobs";
import { loadCustomerJobReport } from "@/lib/services/customer-report";
import { getSessionRole } from "@/lib/auth/server-roles";
import {
  customerAuthErrorStatus,
  customerOwnsJob,
  getCustomerAuth,
} from "@/lib/customer-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userRole = await getSessionRole();

    const isAdmin = userRole === "admin" || userRole === "super_admin";
    const isCustomer = userRole === "user";

    if (!isAdmin && !isCustomer) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const customerView =
      isCustomer || request.nextUrl.searchParams.get("ownerScope") === "1";
    if (customerView) {
      const { customerId, error } = await getCustomerAuth();
      if (!customerId) {
        return NextResponse.json(
          { error: error ?? "Unauthorized" },
          { status: customerAuthErrorStatus(error) },
        );
      }

      const ownsJob = await customerOwnsJob(customerId, id);
      if (!ownsJob) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    return NextResponse.json(
      customerView ? await loadCustomerJobReport(id) : await getJobDetails(id),
    );
  } catch (error) {
    console.error("Error fetching job details:", error);
    return NextResponse.json(
      { error: "Failed to fetch job details" },
      { status: 500 },
    );
  }
}
