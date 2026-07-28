import { getSubscriptionsWithDetails } from '@/lib/queries/subscriptions';
import { SubscriptionsPageClient } from '@/components/dashbboard/admin/subscriptions/SubscriptionsClientPage';
import { PrefetchedInfinitePage } from '@/components/PrefetchedInfinitePage';
import { getCustomerAuth } from '@/lib/customer-auth';
import { redirect } from 'next/navigation';

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // This page is shared with /admin/subscriptions — without this, the
  // server-side prefetch below has no customer filter and every customer's
  // subscription (name, plan, dates) gets embedded in the SSR payload for
  // /customer/subscriptions, before the client's own scoped refetch corrects
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
      queryKey={['subscriptions', { status: 'all', search: '' }]}
      queryFn={() => getSubscriptionsWithDetails({ page: 1, limit: 10, status: 'all', query: '', customerId })}
    >
      <SubscriptionsPageClient />
    </PrefetchedInfinitePage>
  );
}