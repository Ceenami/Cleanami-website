import { redirect } from 'next/navigation';
import { JobOversightPageClient } from '@/components/dashbboard/admin/job-oversight/JobOversightPageClient';
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';
import { getJobsWithDetails } from '@/lib/queries/jobs';
import { getSessionRole } from '@/lib/auth/server-roles';
import { getCustomerAuth } from '@/lib/customer-auth';

export default async function Page() {
  // This route is shared by /admin and /customer. Resolve role before the
  // server-side prefetch: the API scopes customer data, but this direct query
  // otherwise serialises every job into a customer's RSC payload.
  const userRole = await getSessionRole();
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';
  const isCustomer = userRole === 'user';

  if (!isAdmin && !isCustomer) redirect('/sign-in');

  let customerId: string | undefined;
  if (!isAdmin) {
    const { customerId: resolvedCustomerId, error } = await getCustomerAuth();
    if (!resolvedCustomerId) {
      redirect(
        `/?portalBlocked=1&message=${encodeURIComponent(
          error ?? 'Portal unavailable'
        )}`
      );
    }
    customerId = resolvedCustomerId;
  }

  return (
    <PrefetchedInfinitePage
      queryKey={['job-oversight']}
      queryFn={() => getJobsWithDetails({ page: 1, limit: 10, customerId })}
    >
      <JobOversightPageClient isAdmin={isAdmin} />
    </PrefetchedInfinitePage>
  );
}
