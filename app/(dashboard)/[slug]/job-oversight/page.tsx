
// import { getJobOversightData } from '@/lib/queries/jobs'; // You'll need to create this
import { JobOversightPageClient } from '@/components/dashbboard/admin/job-oversight/JobOversightPageClient';
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';
import { getJobsWithDetails } from '@/lib/queries/jobs';

export default async function Page() {
  return (
    <PrefetchedInfinitePage
      queryKey={['job-oversight']}
      queryFn={() => getJobsWithDetails({ page: 1, limit: 10 })}
    >
      <JobOversightPageClient />
    </PrefetchedInfinitePage>
  );
}