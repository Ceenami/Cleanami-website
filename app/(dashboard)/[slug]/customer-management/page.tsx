import { getCustomersWithPropertyCount } from '@/lib/queries/customers';
import { CustomerPageClient } from '@/components/dashbboard/admin/customer-management/CustomerPageClient';
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';

export default async function Page() {
  return (
    <PrefetchedInfinitePage
      queryKey={['customers', { search: '' }]}
      queryFn={() => getCustomersWithPropertyCount({ page: 1, limit: 10 })}
    >
      <CustomerPageClient />
    </PrefetchedInfinitePage>
  );
}