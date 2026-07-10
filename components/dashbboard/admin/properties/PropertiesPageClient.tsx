'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useMemo } from 'react';
import { useDebounce } from 'use-debounce';
import { usePathname } from 'next/navigation';
import { PropertiesTable } from '@/components/dashbboard/admin/properties/PropertiesTable';
import { PropertiesWithOwner } from '@/lib/queries/properties';
import { createClient } from '@/lib/supabase/client';
import { ConfirmationModal } from '@/components/dashbboard/admin/ui/ConfirmationModal';
import { TriangleAlertIcon } from 'lucide-react';
import { SearchBar } from '@/components/dashbboard/admin/ui/SearchBar';
import { useCurrentUser } from '@/hooks/useCurrentUser';

async function fetchProperties({
  pageParam = 1,
  queryKey,
}: {
  pageParam?: number;
  queryKey: unknown[];
}) {
  const [, { search, ownerScope }] = queryKey as [
    string,
    { search: string; ownerScope: boolean },
  ];
  const scope = ownerScope ? "&ownerScope=1" : "";
  const res = await fetch(
    `/api/properties?page=${pageParam}&query=${search}${scope}`
  );
  if (!res.ok) {
    throw new Error('Network response was not ok');
  }
  return res.json() as Promise<PropertiesWithOwner>;
}

export const PropertiesPageClient = () => {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { data: user } = useCurrentUser();
  const portalPrefix = pathname.startsWith('/customer') ? '/customer' : '/admin';
  const isOwnerPortal = portalPrefix === '/customer';
  const isAdmin =
    user?.user_metadata?.role === 'admin' ||
    user?.user_metadata?.role === 'super_admin';
  const [propertyToDelete, setPropertyToDelete] = useState<PropertiesWithOwner['data'][number] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm] = useDebounce(searchTerm, 500);

  const queryKey = useMemo(
    () => ['properties', { search: debouncedSearchTerm, ownerScope: isOwnerPortal }],
    [debouncedSearchTerm, isOwnerPortal]
  );

  const {
    data, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey,
    queryFn: fetchProperties,
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel('realtime-properties')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' },
        () => queryClient.invalidateQueries({ queryKey: ['properties'] })
      ).subscribe();
    return () => { supabase.removeChannel(channel) };
  }, [queryClient]);
  
  const handleDeleteProperty = async () => {
      if (!propertyToDelete) return;
      console.log("Deleting property:", propertyToDelete.id);
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      setPropertyToDelete(null);
  }

  const allProperties = data?.pages.flatMap(page => page.data) ?? [];

  return (
     <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <SearchBar onSearch={setSearchTerm} placeholder="Search by address, owner, email, or phone..." />
          {/* <button className="w-full md:w-auto flex items-center justify-center bg-teal-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-teal-600">
            <PlusIcon className="mr-2 h-5 w-5" />
            Add Property
          </button> */}
        </div>
        
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <PropertiesTable
              properties={allProperties}
              onDelete={setPropertyToDelete}
              portalPrefix={portalPrefix}
              showDelete={isAdmin && !isOwnerPortal}
            />
        </div>

        <div className="p-4 flex justify-center">
            <button
                onClick={() => fetchNextPage()}
                disabled={!hasNextPage || isFetchingNextPage}
                className="px-4 py-2 bg-teal-600 text-white font-semibold rounded-lg shadow-md hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
                {isFetchingNextPage ? 'Loading more...' : hasNextPage ? 'Load More' : 'Nothing more to load'}
            </button>
        </div>

        {propertyToDelete && (
            <ConfirmationModal
                isOpen={!!propertyToDelete}
                onClose={() => setPropertyToDelete(null)}
                onConfirm={handleDeleteProperty}
                title="Delete Property"
                confirmButtonText="Delete"
                confirmButtonClassName="bg-red-600 hover:bg-red-500"
                icon={<div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100"><TriangleAlertIcon className="h-6 w-6 text-red-600" /></div>}
            >
                Are you sure you want to delete the property at <strong>{propertyToDelete.address}</strong>? This action cannot be undone.
            </ConfirmationModal>
        )}
    </div>
  );
};

