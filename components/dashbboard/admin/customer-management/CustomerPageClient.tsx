"use client";

import { useMemo, useEffect, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { OwnersTable } from "@/components/dashbboard/admin/customer-management/OwnersTable";
import { CustomersResponse } from "@/lib/queries/customers";
import { createClient } from "@/lib/supabase/client";
import { SearchBar } from "@/components/dashbboard/admin/ui/SearchBar"; 
import { useDebounce } from "use-debounce";

async function fetchCustomers({ pageParam = 1, queryKey }: { pageParam: number, queryKey: any[] }) {
  const { search } = queryKey[1] as { search: string };
  const res = await fetch(`/api/customers?page=${pageParam}&query=${search}`);
  if (!res.ok) {
    throw new Error("Network response was not ok");
  }
  return res.json() as Promise<CustomersResponse>;
}

export function CustomerPageClient() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm] = useDebounce(searchTerm, 500);

  const queryKey = useMemo(() => ["customers", { search: debouncedSearchTerm }], [debouncedSearchTerm]);

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey,
    queryFn: fetchCustomers,
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("realtime-customers")
      .on( "postgres_changes", { event: "*", schema: "public", table: "customers" },
        () => { queryClient.invalidateQueries({ queryKey: ["customers"] }) }
      )
      .on( "postgres_changes", { event: "*", schema: "public", table: "properties" },
        () => { queryClient.invalidateQueries({ queryKey: ["customers"] }) }
      )
       .on( "postgres_changes", { event: "*", schema: "public", table: "subscriptions" },
        () => { queryClient.invalidateQueries({ queryKey: ["customers"] }) }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel) };
  }, [queryClient]);

  const allCustomers = useMemo( () => data?.pages.flatMap((page) => page.data) ?? [], [data] );
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <h1 className="text-3xl font-bold text-gray-900">
          Customer Management
        </h1>
        <SearchBar onSearch={setSearchTerm} placeholder="Search by name, email, or phone..."/>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Properties</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Active Subscriptions</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer Since</th>
                <th className="relative px-6 py-3"><span className="sr-only">View</span></th>
              </tr>
            </thead>
            {status === "pending" ? (
              <tbody><tr><td colSpan={7} className="p-4 text-center">Loading...</td></tr></tbody>
            ) : status === "error" ? (
              <tbody><tr><td colSpan={7} className="p-4 text-center text-red-500">Error: {error.message}</td></tr></tbody>
            ) : (
              <OwnersTable owners={allCustomers} />
            )}
             <tfoot>
                <tr>
                    {/* FIX: Updated colSpan to match the new number of columns */}
                    <td colSpan={7} className="p-4 text-center">
                        <button
                            onClick={() => fetchNextPage()}
                            disabled={!hasNextPage || isFetchingNextPage}
                            className="px-4 py-2 bg-teal-600 text-white font-semibold rounded-lg shadow-md hover:bg-teal-700 disabled:bg-gray-400"
                        >
                            {isFetchingNextPage ? "Loading..." : hasNextPage ? "Load More" : "No more customers"}
                        </button>
                    </td>
                </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

