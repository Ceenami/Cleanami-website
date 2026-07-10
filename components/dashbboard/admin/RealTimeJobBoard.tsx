"use client";

import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { Route } from "next";
import { usePathname } from "next/navigation";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { JobsWithDetails } from "@/lib/queries/jobs";
import { createClient } from "@/lib/supabase/client";
import { GetJobsResponse } from "@/app/api/jobs/route";
import { GetJobStatsResponse } from "@/app/api/jobs/stats/route";
import { getDashboardJobDateRange, DASHBOARD_FUTURE_DAYS, DASHBOARD_PAST_DAYS } from "@/lib/queries/dashboard-job-window";
import { KpiCard } from "./ui/KpiCard";
import { ClientTime } from "./ui/ClientTime";
import { getStatusBadge } from "../utils";
import { CustomerJobCancelButton } from "@/components/customer/CustomerJobCancelButton";

async function fetchJobs({
  pageParam = 1,
  ownerScope,
}: {
  pageParam: number;
  ownerScope: boolean;
}) {
  const { startDate, endDate } = getDashboardJobDateRange();
  const params = new URLSearchParams({
    dashboard: "1",
    page: String(pageParam),
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  });
  if (ownerScope) {
    params.set("ownerScope", "1");
  }
  const res = await fetch(`/api/jobs?${params}`);
  const result = (await res.json()) as GetJobsResponse & { error?: string };
  if (!res.ok) {
    throw new Error(result.error ?? "Could not load jobs");
  }
  return {
    jobs: result.data,
    nextPage: result.nextPage,
  };
}

export const RealTimeJobBoard = () => {
  const pathname = usePathname();
  const isOwnerPortal = pathname.startsWith("/customer");
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const userRole = user?.user_metadata?.role;
  const isAdmin = userRole === "admin" || userRole === "super_admin";
  const isCustomer = userRole === "user";
  const portalPrefix = isOwnerPortal ? "/customer" : "/admin";
  const showOwnerView = isCustomer || (isAdmin && isOwnerPortal);

  const queryClient = useQueryClient();
  const statsQueryKey = useMemo(
    () => ["jobs", "stats", { ownerScope: isOwnerPortal }],
    [isOwnerPortal]
  );
  const jobsQueryKey = useMemo(
    () => ["jobs", { ownerScope: isOwnerPortal, dashboard: true }],
    [isOwnerPortal]
  );

  const { data: stats } = useQuery({
    queryKey: statsQueryKey,
    queryFn: async () => {
      const scope = isOwnerPortal ? "?ownerScope=1" : "";
      const res = await fetch(`/api/jobs/stats${scope}`);
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to fetch stats");
      }
      return res.json() as Promise<GetJobStatsResponse>;
    },
    enabled: isAdmin || isCustomer,
    refetchInterval: 30000,
  });

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: jobsQueryKey,
    queryFn: ({ pageParam }) =>
      fetchJobs({ pageParam, ownerScope: isOwnerPortal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: isAdmin || isCustomer,
  });

  useEffect(() => {
    if (!isAdmin) return;

    const supabase = createClient();
    const channel = supabase
      .channel("realtime-jobs-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs" },
        () => {
          queryClient.invalidateQueries({ queryKey: jobsQueryKey });
          queryClient.invalidateQueries({ queryKey: statsQueryKey });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs_to_cleaners" },
        () => {
          queryClient.invalidateQueries({ queryKey: jobsQueryKey });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, isAdmin, jobsQueryKey, statsQueryKey]);

  const uniqueJobs = useMemo(() => {
    const allJobs = data?.pages.flatMap((page) => page.jobs) ?? [];
    const deduped = Array.from(
      new Map(
        allJobs.filter((job) => job != null).map((job) => [job.id, job])
      ).values()
    );
    return deduped.sort((a, b) => {
      const ta = a.checkInTime
        ? new Date(a.checkInTime).getTime()
        : Number.MAX_SAFE_INTEGER;
      const tb = b.checkInTime
        ? new Date(b.checkInTime).getTime()
        : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  }, [data]);

  if (userLoading) {
    return (
      <div className="rounded-lg bg-white p-8 text-center text-gray-500 shadow-md">
        Loading your dashboard…
      </div>
    );
  }

  if (!isAdmin && !isCustomer) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-amber-900">
        <p className="font-medium">Dashboard unavailable</p>
        <p className="mt-2 text-sm">
          This view is for property owners and administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">
          {showOwnerView ? "Your properties" : "Dashboard"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Check-in order · last {DASHBOARD_PAST_DAYS} days through{" "}
          {DASHBOARD_FUTURE_DAYS} days ahead
          {showOwnerView ? " (your properties)" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats && (
          <>
            <KpiCard
              title="Scheduled jobs"
              value={stats.totalInScheduleWindow.toString()}
            />
            <KpiCard title="Active Jobs" value={stats.totalActive.toString()} />
            <KpiCard
              title="Today's check-in schedule"
              value={stats.totalToday.toString()}
            />
            <KpiCard
              title="Completed"
              value={stats.totalCompleted.toString()}
            />
          </>
        )}
      </div>

      <div>
        <h2 className="mb-4 text-2xl font-bold text-gray-800">
          {showOwnerView ? "Your clean schedule" : "Real-Time Job Board"}
        </h2>
        <div className="overflow-hidden rounded-lg bg-white shadow-md">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Property
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Cleaners
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    Check-in time
                  </th>
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {status === "pending" ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center">
                      Loading jobs…
                    </td>
                  </tr>
                ) : status === "error" ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-red-500">
                      {error.message}
                    </td>
                  </tr>
                ) : uniqueJobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-gray-500">
                      No jobs scheduled yet. Jobs appear here after your
                      property calendar syncs.
                    </td>
                  </tr>
                ) : (
                  uniqueJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                        {job.property?.address ?? "N/A"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {job.assignedCleaners.length > 0
                          ? job.assignedCleaners
                              .map(
                                (
                                  c: JobsWithDetails["data"][number]["assignedCleaners"][number]
                                ) => c.fullName
                              )
                              .join(", ")
                          : "Awaiting assignment"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${getStatusBadge(
                            job.status || ""
                          )}`}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {job.checkInTime ? (
                          <ClientTime dateString={job.checkInTime} />
                        ) : (
                          <span>N/A</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                        <div className="flex flex-col items-end gap-2">
                          {showOwnerView && (
                            <CustomerJobCancelButton
                              jobId={job.id}
                              status={job.status}
                              checkInTime={
                                job.checkInTime
                                  ? String(job.checkInTime)
                                  : null
                              }
                            />
                          )}
                          <Link
                            href={
                              `${portalPrefix}/job-oversight/${job.id}` as Route
                            }
                            className="text-teal-600 hover:text-teal-900"
                          >
                            Details
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {uniqueJobs.length > 0 && (
            <div className="flex justify-center p-4">
              <button
                onClick={() => fetchNextPage()}
                disabled={!hasNextPage || isFetchingNextPage}
                className="rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white shadow-md hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {isFetchingNextPage
                  ? "Loading more…"
                  : hasNextPage
                    ? "Load more"
                    : "Nothing more to load"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
