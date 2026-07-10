import { getJobsWithDetails } from '@/lib/queries/jobs';
import { getDashboardJobDateRange } from '@/lib/queries/dashboard-job-window';
import { RealTimeJobBoard } from "@/components/dashbboard/admin/RealTimeJobBoard";
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';

export default async function Page() {
  const { startDate, endDate } = getDashboardJobDateRange();

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
