import { getSubscriptionsWithDetails } from '@/lib/queries/subscriptions';
import { SubscriptionsPageClient } from '@/components/dashbboard/admin/subscriptions/SubscriptionsClientPage';
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';

export default async function Page() {
  return (
    <PrefetchedInfinitePage
      queryKey={['subscriptions', { status: 'all', search: '' }]}
      queryFn={() => getSubscriptionsWithDetails({ page: 1, limit: 10, status: 'all', query: '' })}
    >
      <SubscriptionsPageClient />
    </PrefetchedInfinitePage>
  );
}