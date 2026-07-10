import { getCleaners } from '@/lib/queries/cleaners'; 
import { CleanersPageClient } from '@/components/dashbboard/admin/cleaner-management/CleanersPageClient';
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';

export default async function CleanerManagementPage() {
  return (
    <PrefetchedInfinitePage
      queryKey={['cleaners']}
      queryFn={() => getCleaners({ page: 1, limit: 15 })}
      getNextPageParam={(lastPage) => lastPage.nextPage}
    >
      <CleanersPageClient />
    </PrefetchedInfinitePage>
  );
}