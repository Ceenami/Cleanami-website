import { redirect } from "next/navigation";
import { JobOversightPageClient } from "@/components/dashbboard/admin/job-oversight/JobOversightPageClient";
import { PrefetchedInfinitePage } from "@/components/PrefetchedInfinitePage";
import { getJobsWithDetails } from "@/lib/queries/jobs";
import { getSessionRole } from "@/lib/auth/server-roles";
import { getCustomerAuth } from "@/lib/customer-auth";
import { CustomerJobList } from "@/components/customer/CustomerJobList";
import { toCustomerJobListItem } from "@/lib/customer/job-list";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // This route is shared by /admin and /customer. Resolve role before the
  // server-side prefetch: the API scopes customer data, but this direct query
  // otherwise serialises every job into a customer's RSC payload.
  const userRole = await getSessionRole();
  const isAdmin = userRole === "admin" || userRole === "super_admin";
  const isCustomer = userRole === "user";

  if (!isAdmin && !isCustomer) redirect("/sign-in");

  let customerId: string | undefined;
  if (!isAdmin || slug === "customer") {
    const { customerId: resolvedCustomerId, error } = await getCustomerAuth();
    if (!resolvedCustomerId) {
      redirect(
        `/?portalBlocked=1&message=${encodeURIComponent(
          error ?? "Portal unavailable",
        )}`,
      );
    }
    customerId = resolvedCustomerId;
  }

  if (customerId)
    return (
      <PrefetchedInfinitePage
        queryKey={["customer-job-list"]}
        queryFn={async () => {
          const result = await getJobsWithDetails({
            page: 1,
            limit: 10,
            customerId,
            sortByCheckIn: "desc",
          });
          return {
            data: result.data.map(toCustomerJobListItem),
            nextPage: result.nextPage,
          };
        }}
      >
        <CustomerJobList />
      </PrefetchedInfinitePage>
    );

  return (
    <PrefetchedInfinitePage
      queryKey={["job-oversight"]}
      queryFn={() => getJobsWithDetails({ page: 1, limit: 10, customerId, includeRestockCounts: true })}
    >
      <JobOversightPageClient isAdmin={isAdmin} />
    </PrefetchedInfinitePage>
  );
}
