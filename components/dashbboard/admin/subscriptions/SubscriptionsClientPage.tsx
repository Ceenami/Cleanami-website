"use client";

import { usePathname } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useMemo } from 'react';
import { useDebounce } from 'use-debounce';
import { SubscriptionsTable } from '@/components/dashbboard/admin/subscriptions/SubscriptionsTable';
import { createClient } from '@/lib/supabase/client';
import SubscriptionDetailModal from '@/components/dashbboard/admin/subscriptions/SubscriptionsDetailModal';
import { SearchBar } from '@/components/dashbboard/admin/ui/SearchBar';
import { Subscription } from '@/db/schemas';
import { SubscriptionsWithDetails } from '@/lib/queries/subscriptions';

// Define status types based on your schema
type SubscriptionStatus = Subscription['status'];

// Client-safe fetcher for infinite scrolling
async function fetchSubscriptions({ pageParam = 1, queryKey }: { pageParam?: number, queryKey: any[] }) {
  const { status, search } = queryKey[1] as {
    status: SubscriptionStatus;
    search: string;
  };
  const res = await fetch(`/api/subscriptions?page=${pageParam}&status=${status}&query=${search}${typeof window !== 'undefined' && window.location.pathname.startsWith('/customer') ? '&ownerScope=1' : ''}`);
  if (!res.ok) {
    throw new Error('Network response was not ok');
  }
  return res.json() as Promise<SubscriptionsWithDetails>;
}

export const SubscriptionsPageClient = () => {
  const pathname = usePathname();
  const isCustomerPortal = pathname.startsWith("/customer");
  const queryClient = useQueryClient();
  const [selectedSubscription, setSelectedSubscription] = useState<SubscriptionsWithDetails['data'][number] | null>(null);
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | 'all'>(
    isCustomerPortal ? 'active' : 'all'
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm] = useDebounce(searchTerm, 500);

  const queryKey = useMemo(() => ['subscriptions', { status: statusFilter, search: debouncedSearchTerm }], [statusFilter, debouncedSearchTerm]);

  const {
    data, fetchNextPage, hasNextPage, isFetchingNextPage, status, error
  } = useInfiniteQuery({
    queryKey,
    queryFn: fetchSubscriptions,
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel('realtime-subscriptions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' },
        () => queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
      ).subscribe();
    return () => { supabase.removeChannel(channel) };
  }, [queryClient]);
  
  const handleUpdateSubscription = (updatedSub: Subscription) => {
    console.log("Updating subscription:", updatedSub);
    // Add API call logic here e.g., fetch(`/api/subscriptions/${updatedSub.id}`, { method: 'PUT', ... })
    queryClient.invalidateQueries({ queryKey });
    setSelectedSubscription(null);
  }

  const allSubscriptions = data?.pages.flatMap(page => page.data) ?? [];
  const uniqueSubscriptions = Array.from(new Map(allSubscriptions.map(sub => [sub.id, sub])).values());
  const statusOptions: (SubscriptionStatus | 'all')[] = ["all", "active", "pending", "canceled", "expired"];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <SearchBar onSearch={setSearchTerm} placeholder="Search by address or owner..."/>
        <div>
          <label htmlFor="status-filter" className="sr-only">Filter by status</label>
          <select
            id="status-filter" value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SubscriptionStatus | 'all')}
            className="block w-full md:w-auto pl-3 pr-10 py-2 text-base border-gray-300 rounded-md"
          >
            {statusOptions.map(opt => <option key={opt} value={opt} className="capitalize">{opt}</option>)}
          </select>
        </div>
      </div>
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Property / Owner</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Start Date</th>
                <th className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {status === 'pending' ? ( <tbody><tr><td colSpan={5} className="p-4 text-center">Loading...</td></tr></tbody> ) 
            : status === 'error' ? ( <tbody><tr><td colSpan={5} className="p-4 text-center text-red-500">Error: {error.message}</td></tr></tbody> ) 
            : ( <SubscriptionsTable subscriptions={uniqueSubscriptions} onManage={setSelectedSubscription} showCustomerActions={isCustomerPortal} /> )}
            <tfoot>
              <tr>
                <td colSpan={5} className="p-4 text-center">
                  <button onClick={() => fetchNextPage()} disabled={!hasNextPage || isFetchingNextPage} className="px-4 py-2 bg-teal-600 text-white rounded-lg disabled:bg-gray-400">
                    {isFetchingNextPage ? 'Loading...' : hasNextPage ? 'Load More' : 'Nothing more to load'}
                  </button>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {selectedSubscription && <SubscriptionDetailModal subscription={selectedSubscription} onClose={() => setSelectedSubscription(null)} onUpdate={handleUpdateSubscription} />}
    </div>
  );
};

