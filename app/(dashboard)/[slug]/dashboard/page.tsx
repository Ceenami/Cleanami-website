import { getJobsWithDetails } from '@/lib/queries/jobs';
import { getDashboardJobDateRange } from '@/lib/queries/dashboard-job-window';
import { RealTimeJobBoard } from "@/components/dashbboard/admin/RealTimeJobBoard";
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';
import { getCustomerAuth } from '@/lib/customer-auth';
import { redirect } from 'next/navigation';

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { startDate, endDate } = getDashboardJobDateRange();

  // This page is shared with /admin/dashboard — without this, the
  // server-side prefetch below has no customer filter and every job in the
  // system (property address, schedule) gets embedded in the SSR payload for
  // /customer/dashboard, before the client's own scoped refetch corrects
  // what's actually rendered.
  let customerId: string | undefined;
  if (slug === 'customer') {
    const auth = await getCustomerAuth();
    if (!auth.customerId) {
      redirect(`/?portalBlocked=1&message=${encodeURIComponent(auth.error ?? 'Portal unavailable')}`);
    }
    customerId = auth.customerId;
  }

  return (
    <PrefetchedInfinitePage
      queryKey={['jobs', { dashboard: true }]}
      queryFn={async () => {
        const result = await getJobsWithDetails({
          page: 1,
          limit: 20,
          startDate,
          endDate,
          sortByCheckIn: 'asc',
          customerId,
        });
        return {
          jobs: result.data,
          nextPage: result.nextPage,
        };
      }}
      getNextPageParam={(lastPage) => lastPage.nextPage}
    >
      <RealTimeJobBoard />
    </PrefetchedInfinitePage>
  );
}
