import { JobDetailsClient } from '@/components/dashbboard/admin/job-oversight/JobDetailPage';
import { PrefetchedPage } from '@/components/PrefetchedPage';
import { getJobDetails } from '@/lib/queries/jobs';

interface PageProps {
  params: Promise<{ 
    id: string;
  }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;

  return (
    <PrefetchedPage
      queryKey={['job-details', id]}
      queryFn={() => getJobDetails(id)}
    >
      <JobDetailsClient jobId={id} />
    </PrefetchedPage>
  );
}