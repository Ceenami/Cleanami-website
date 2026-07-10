import { getPropertiesWithOwner } from '@/lib/queries/properties';
import { PropertiesPageClient } from '@/components/dashbboard/admin/properties/PropertiesPageClient';
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';

export default async function Page() {
  return (
    <PrefetchedInfinitePage
      queryKey={['properties', { search: '' }]}
      queryFn={() => getPropertiesWithOwner({ page: 1, limit: 10, query: '' })}
    >
      <PropertiesPageClient />
    </PrefetchedInfinitePage>
  );
}