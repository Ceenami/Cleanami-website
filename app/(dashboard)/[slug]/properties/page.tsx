import { getPropertiesWithOwner } from '@/lib/queries/properties';
import { PropertiesPageClient } from '@/components/dashbboard/admin/properties/PropertiesPageClient';
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';
import { getCustomerAuth } from '@/lib/customer-auth';
import { redirect } from 'next/navigation';

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // This page is shared with /admin/properties — without this, the
  // server-side prefetch below has no customer filter and every property in
  // the system (address, owner name) gets embedded in the SSR payload for
  // /customer/properties, before the client's own scoped refetch corrects
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
      queryKey={['properties', { search: '' }]}
      queryFn={() => getPropertiesWithOwner({ page: 1, limit: 10, query: '', customerId })}
    >
      <PropertiesPageClient />
    </PrefetchedInfinitePage>
  );
}