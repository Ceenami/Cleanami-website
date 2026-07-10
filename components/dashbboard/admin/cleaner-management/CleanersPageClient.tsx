'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { CleanersResponse } from '@/lib/queries/cleaners';
import { createClient } from '@/lib/supabase/client';
import { CleanersTable, SortableKey, SortConfig } from './CleanersTable';

const CLEANERS_PAGE_LIMIT = 15;

async function fetchCleaners({ pageParam = 1 }: { pageParam: number }) {
  const res = await fetch(
    `/api/cleaners?page=${pageParam}&limit=${CLEANERS_PAGE_LIMIT}`,
    { credentials: 'same-origin' }
  );
  const body = (await res.json().catch(() => ({}))) as CleanersResponse & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(
      body.error ?? `Could not load cleaners (HTTP ${res.status})`
    );
  }

  return body;
}

export function CleanersPageClient() {
  const queryClient = useQueryClient();
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig | null>({
    key: 'createdAt',
    direction: 'descending',
  });

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
    isPending,
    isError,
  } = useInfiniteQuery({
    queryKey: ['cleaners'],
    queryFn: fetchCleaners,
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    staleTime: 30_000,
    retry: 2,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('realtime-cleaners')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cleaners' },
        () => {
          if (invalidateTimerRef.current) {
            clearTimeout(invalidateTimerRef.current);
          }
          invalidateTimerRef.current = setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['cleaners'] });
          }, 1500);
        }
      )
      .subscribe();

    return () => {
      if (invalidateTimerRef.current) {
        clearTimeout(invalidateTimerRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const allCleaners = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data]
  );

  const uniqueCleaners = useMemo(
    () => Array.from(new Map(allCleaners.map((c) => [c.id, c])).values()),
    [allCleaners]
  );

  const sortedCleaners = useMemo(() => {
    const sortableItems = [...uniqueCleaners];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const key = sortConfig.key;
        const valA = a[key];
        const valB = b[key];

        if (valA === null) return 1;
        if (valB === null) return -1;

        if (valA < valB) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (valA > valB) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [uniqueCleaners, sortConfig]);

  const handleSort = (key: SortableKey) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (
      sortConfig &&
      sortConfig.key === key &&
      sortConfig.direction === 'ascending'
    ) {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const handleManageCleaner = (cleaner: CleanersResponse['data'][number]) => {
    console.log('Managing cleaner:', cleaner);
  };

  if (isPending && !data) {
    return <p className="text-gray-500">Loading cleaners…</p>;
  }

  if (isError && !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="font-semibold">Could not load cleaners</p>
        <p className="mt-2 text-sm">{error?.message ?? 'Unknown error'}</p>
        <button
          type="button"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ['cleaners'] })
          }
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Manage Cleaners</h1>
        {isFetching && !isFetchingNextPage && (
          <span className="text-sm text-gray-500">Refreshing…</span>
        )}
      </div>

      {isError && data && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Could not refresh the list: {error?.message}. Showing last loaded
          data.
          <button
            type="button"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ['cleaners'] })
            }
            className="ml-2 font-semibold underline"
          >
            Retry
          </button>
        </div>
      )}

      <CleanersTable
        cleaners={sortedCleaners}
        sortConfig={sortConfig}
        onSort={handleSort}
        onManageCleaner={handleManageCleaner}
      />

      <div className="flex justify-center py-4">
        <button
          onClick={() => fetchNextPage()}
          disabled={!hasNextPage || isFetchingNextPage}
          className="rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white shadow-md hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {isFetchingNextPage
            ? 'Loading…'
            : hasNextPage
              ? 'Load More'
              : 'No more cleaners'}
        </button>
      </div>
    </div>
  );
}
