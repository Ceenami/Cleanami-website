// "use client";
// import {
//   ChevronDownIcon,
//   ChevronUpIcon,
//   TriangleAlertIcon,
// } from "lucide-react";
// import { useMemo, useState } from "react";
// import { getStatusBadge } from "../../utils";
// import { Route } from "next";
// import Link from "next/link";
// import { jobs } from "@/db/schemas";
// import { useCurrentUser } from "@/hooks/useCurrentUser";

// type SortDirection = "ascending" | "descending";
// type SortableKey =
//   | "id"
//   | "propertyName"
//   | "cleanerName"
//   | "status"
//   | "scheduledDateTime";

// interface SortConfig {
//   key: SortableKey;
//   direction: SortDirection;
// }

// async function fetchJobs({ pageParam = 1 }: { pageParam: number }) {
//   const res = await fetch(`/api/jobs?page=${pageParam}`);
//   if (!res.ok) {
//     throw new Error("Network response was not ok");
//   }
//   const result: GetJobsResponse = await res.json();
//   return {
//     jobs: result.data,
//     nextPage: result.nextPage,
//   };
// }

// export const JobListView = () => {

//   const { data: user } = useCurrentUser();
//     const isAdmin =
//       user?.user_metadata.role === "admin" ||
//       user?.user_metadata.role === "super_admin";

//     const { data: stats } = useQuery({
//         queryKey: ["jobs", "stats"],
//         queryFn: async () => {
//           const res = await fetch("/api/jobs/stats");
//           if (!res.ok) throw new Error("Failed to fetch stats");
//           return res.json() as Promise<GetJobStatsResponse>;
//         },
//         refetchInterval: 30000,
//       });
//   const {
//       data,
//       error,
//       fetchNextPage,
//       hasNextPage,
//       isFetching,
//       isFetchingNextPage,
//       status,
//     } = useInfiniteQuery({
//       queryKey: ["jobs"],
//       queryFn: fetchJobs,
//       initialPageParam: 1,
//       getNextPageParam: (lastPage) => lastPage.nextPage,
//     });

//   const [activeFilter, setActiveFilter] = useState<
//     JobStatus | "All" | "Flagged"
//   >("All");
//   const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);

//   const filters: (JobStatus | "All" | "Flagged")[] = [
//     "All",
//     "Pending",
//     "Assigned",
//     "In Progress",
//     "Awaiting Capture",
//     "Canceled",
//     "Flagged",
//   ];

//   const enrichedJobs = useMemo(() => {
//     return jobs.map((job) => {
//       const property = properties.find((p) => p.id === job.propertyId);
//       const cleaner = cleaners.find((c) => c.id === job.cleanerId);
//       return {
//         ...job,
//         propertyName: property?.address || "N/A",
//         cleanerName: cleaner?.name || "Unassigned",
//       };
//     });
//   }, []);

//   const filteredJobs = useMemo(
//     () =>
//       enrichedJobs.filter((job) => {
//         if (activeFilter === "All") return true;
//         if (activeFilter === "Flagged")
//           return job.flags.some((f) => !f.resolved);
//         return job.status === activeFilter;
//       }),
//     [enrichedJobs, activeFilter]
//   );

//   const sortedJobs = useMemo(() => {
//     let sortableItems = [...filteredJobs];
//     if (sortConfig !== null) {
//       sortableItems.sort((a, b) => {
//         if (a[sortConfig.key] < b[sortConfig.key]) {
//           return sortConfig.direction === "ascending" ? -1 : 1;
//         }
//         if (a[sortConfig.key] > b[sortConfig.key]) {
//           return sortConfig.direction === "ascending" ? 1 : -1;
//         }
//         return 0;
//       });
//     }
//     return sortableItems;
//   }, [filteredJobs, sortConfig]);

//   const requestSort = (key: SortableKey) => {
//     let direction: SortDirection = "ascending";
//     if (
//       sortConfig &&
//       sortConfig.key === key &&
//       sortConfig.direction === "ascending"
//     ) {
//       direction = "descending";
//     }
//     setSortConfig({ key, direction });
//   };

//   const headers: { key: SortableKey; label: string }[] = [
//     { key: "id", label: "Job ID" },
//     { key: "propertyName", label: "Property" },
//     { key: "cleanerName", label: "Cleaner" },
//     { key: "status", label: "Status" },
//     { key: "scheduledDateTime", label: "Scheduled For" },
//   ];

//   return (
//     <div className="space-y-6">
//       <div className="flex flex-wrap items-center gap-2">
//         {filters.map((filter) => (
//           <button
//             key={filter}
//             onClick={() => setActiveFilter(filter)}
//             className={`px-4 py-2 text-sm font-medium rounded-full transition-colors duration-200 ${
//               activeFilter === filter
//                 ? "bg-teal-500 text-white shadow"
//                 : "bg-white text-gray-600 hover:bg-gray-100"
//             }`}
//           >
//             {filter}
//           </button>
//         ))}
//       </div>
//       <div className="bg-white rounded-lg shadow-md overflow-hidden">
//         <div className="overflow-x-auto">
//           <table className="min-w-full divide-y divide-gray-200">
//             <thead className="bg-gray-50">
//               <tr>
//                 {headers.map((header) => (
//                   <th
//                     key={header.key}
//                     scope="col"
//                     className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
//                   >
//                     <button
//                       onClick={() => requestSort(header.key)}
//                       className="flex items-center group focus:outline-none"
//                     >
//                       {header.label}
//                       <span className="ml-2">
//                         {sortConfig?.key === header.key ? (
//                           sortConfig.direction === "ascending" ? (
//                             <ChevronUpIcon className="h-4 w-4" />
//                           ) : (
//                             <ChevronDownIcon className="h-4 w-4" />
//                           )
//                         ) : (
//                           <ChevronDownIcon className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
//                         )}
//                       </span>
//                     </button>
//                   </th>
//                 ))}
//                 <th scope="col" className="relative px-6 py-3">
//                   <span className="sr-only">Actions</span>
//                 </th>
//               </tr>
//             </thead>
//             <tbody className="bg-white divide-y divide-gray-200">
//               {sortedJobs.map((job) => (
//                 <tr key={job.id} className="hover:bg-gray-50">
//                   <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
//                     {job.id}
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
//                     {job.propertyName}
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
//                     {job.cleanerName}
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap">
//                     <div className="flex items-center">
//                       <span
//                         className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(
//                           job.status
//                         )}`}
//                       >
//                         {job.status}
//                       </span>
//                       {job.flags.some((f) => !f.resolved) && (
//                         <div className="ml-2 group relative">
//                           <TriangleAlertIcon className="h-5 w-5 text-red-500" />
//                         </div>
//                       )}
//                     </div>
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
//                     {/* {formatDate(job.scheduledDateTime)} */}
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
//                       <Link href={`/admin/job-oversight/${job.id}` as Route} className="text-teal-600 hover:text-teal-900">
//                           Details
//                       </Link>
//                   </td>
//                 </tr>
//               ))}
//             </tbody>
//           </table>
//         </div>
//         {sortedJobs.length === 0 && (
//           <div className="text-center py-12">
//             <p className="text-gray-500">No jobs match the current filter.</p>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

'use client';

import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Route } from "next";
import { getStatusBadge } from "../../utils";
import { SearchBar } from "../ui/SearchBar";
import {
  DASHBOARD_FUTURE_DAYS,
  DASHBOARD_PAST_DAYS,
  getDashboardJobDateRange,
} from "@/lib/queries/dashboard-job-window";

interface AssignedCleaner {
  id: string;
  fullName: string;
}

interface JobRecord {
  id: string;
  property?: { address: string } | null;
  assignedCleaners: AssignedCleaner[];
  status: string;
  checkInTime?: string | null;
}

interface GetJobsResponse {
  data: JobRecord[];
  nextPage?: number | null;
}

type JobStatus = "all" | "unassigned" | "assigned" | "in-progress" | "completed" | "canceled";



type FetchJobsContext = {
  pageParam?: number;
  queryKey: readonly [string, { status: JobStatus; query: string }];
};

async function fetchJobs(context: FetchJobsContext) {
  const { pageParam = 1, queryKey } = context;
  const { status, query } = queryKey[1] as { status: JobStatus; query: string };
  const { startDate, endDate } = getDashboardJobDateRange();
  const params = new URLSearchParams({
    page: String(pageParam),
    limit: "15",
    dashboard: "1",
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  });

  if (status !== "all") {
    params.append("status", status);
  }

  if (query.trim()) {
    params.append("query", query.trim());
  }

  const response = await fetch(`/api/jobs?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to fetch jobs");
  }

  return response.json() as Promise<GetJobsResponse>;
}

export const JobListView = () => {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<JobStatus>("all");

  const queryKey = useMemo(
    () => ["jobs", { status: statusFilter, query: searchTerm }] as const,
    [statusFilter, searchTerm]
  );

  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage, status } = useInfiniteQuery({
    queryKey,
    queryFn: fetchJobs,
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });

  useEffect(() => {
    const invalidateJobs = () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    };

    window.addEventListener("focus", invalidateJobs);

    return () => {
      window.removeEventListener("focus", invalidateJobs);
    };
  }, [queryClient]);

  const jobs = useMemo(() => {
    const merged = data?.pages.flatMap((page) => page.data) ?? [];
    return [...merged].sort((a, b) => {
      const ta = a.checkInTime ? new Date(a.checkInTime).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.checkInTime ? new Date(b.checkInTime).getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Job List</h2>
          <p className="text-sm text-gray-500">
            Check-in order · last {DASHBOARD_PAST_DAYS} days through{" "}
            {DASHBOARD_FUTURE_DAYS} days ahead
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchBar onSearch={setSearchTerm} placeholder="Search by job ID, address, or cleaner..." />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as JobStatus)}
            className="w-full sm:w-auto rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
          >
            <option value="all">All statuses</option>
            <option value="unassigned">Unassigned</option>
            <option value="assigned">Assigned</option>
            <option value="in-progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="canceled">Canceled</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cleaner</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Check-In</th>
                <th className="relative px-6 py-3"><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {status === "pending" ? (
                <tr>
                  <td colSpan={6} className="px-6 py-6 text-center text-gray-500">Loading jobs...</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-6 py-6 text-center text-red-500">Error loading jobs.</td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-6 text-center text-gray-500">No jobs found.</td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{job.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{job.property?.address ?? "Unknown"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {job.assignedCleaners.length > 0 ? job.assignedCleaners.map((cleaner) => cleaner.fullName).join(", ") : "Unassigned"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getStatusBadge(job.status)}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {job.checkInTime ? new Date(job.checkInTime).toLocaleString() : "N/A"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link href={`/admin/job-oversight/${job.id}` as Route} className="text-teal-600 hover:text-teal-900">
                        Details
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-center py-4">
        <button
          onClick={() => fetchNextPage()}
          disabled={!hasNextPage || isFetchingNextPage}
          className="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isFetchingNextPage ? "Loading more..." : hasNextPage ? "Load more" : "No more jobs"}
        </button>
      </div>
    </div>
  );
};