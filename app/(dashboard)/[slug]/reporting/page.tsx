import { getJobStats } from '@/lib/queries/stats';
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';
import { ReportingClientPage } from '@/components/dashbboard/admin/reporting/ReportingClientPage';

export default async function Page() {
  return (
    <PrefetchedInfinitePage
      queryKey={["jobs", "stats"]}
      queryFn={() => getJobStats()}
    >
      <ReportingClientPage />
    </PrefetchedInfinitePage>
  );
}
