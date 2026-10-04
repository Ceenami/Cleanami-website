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
import {
  getPaymentDisplay,
  type PaymentDisplay,
} from "@/lib/constants/payment-status";
import { getJobDisplay, type JobDisplay } from "@/lib/constants/service-type";
import { getArrivalWindow } from "@/lib/scheduling/arrival-windows";
import { getStatusBadge } from "../utils";
import { CustomerJobCancelButton } from "@/components/customer/CustomerJobCancelButton";
import { CustomerJobPromoCodeField } from "@/components/customer/CustomerJobPromoCodeField";

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

const JOB_TONE_BADGE: Record<JobDisplay["tone"], string> = {
  vacation_rental: "bg-sky-100 text-sky-800",
  residential: "bg-violet-100 text-violet-800",
  labeled: "bg-amber-100 text-amber-900",
};

const PAYMENT_TONE_BADGE: Record<PaymentDisplay["tone"], string> = {
  positive: "bg-green-100 text-green-800",
  negative: "bg-red-100 text-red-800",
  pending: "bg-yellow-100 text-yellow-800",
  neutral: "bg-gray-100 text-gray-700",
};

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

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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
        <div className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white md:hidden">
          {status === "pending" ? (
            <p className="p-6 text-center text-sm text-gray-500">Loading jobs…</p>
          ) : status === "error" ? (
            <p className="p-6 text-center text-sm text-red-500">{error.message}</p>
          ) : uniqueJobs.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">No jobs scheduled yet. Jobs appear here after your property calendar syncs.</p>
          ) : uniqueJobs.map((job) => (
            <details key={job.id} className="group p-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{job.property?.address ?? "N/A"}</p>
                  <p className="mt-1 text-sm text-gray-500">{job.checkInTime ? <ClientTime dateString={job.checkInTime} /> : "N/A"}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${getStatusBadge(job.status || "")}`}>{job.status}</span>
              </summary>
              <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4 text-sm">
                <p><span className="text-gray-500">Cleaners: </span>{job.assignedCleaners.length > 0 ? job.assignedCleaners.map((c: JobsWithDetails["data"][number]["assignedCleaners"][number]) => c.fullName).join(", ") : "Awaiting assignment"}</p>
                {showOwnerView && <div className="grid gap-2"><CustomerJobPromoCodeField jobId={job.id} status={job.status} checkInTime={job.checkInTime ? String(job.checkInTime) : null} paymentIntentId={job.paymentIntentId ?? null} paymentStatus={job.paymentStatus ?? null} appliedPromoCode={job.appliedPromoCode ?? null} /><CustomerJobCancelButton jobId={job.id} status={job.status} checkInTime={job.checkInTime ? String(job.checkInTime) : null} /></div>}
                <Link href={`${portalPrefix}/job-oversight/${job.id}` as Route} className="pt-1 font-medium text-teal-700 hover:text-teal-900">{job.evidencePacket?.photoCount ? `Details · ${job.evidencePacket.photoCount} photo${job.evidencePacket.photoCount === 1 ? "" : "s"}` : "Details"}</Link>
              </div>
            </details>
          ))}
        </div>

        <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white md:block">
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
                    Service
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
                    Payment
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
                    <td colSpan={7} className="p-4 text-center">
                      Loading jobs…
                    </td>
                  </tr>
                ) : status === "error" ? (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-red-500">
                      {error.message}
                    </td>
                  </tr>
                ) : uniqueJobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-gray-500">
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
                      <td className="whitespace-nowrap px-6 py-4">
                        {(() => {
                          // A manual reclean/correction label wins over the
                          // service type; one resolver decides that, here and
                          // on every other screen that names a job.
                          const display = getJobDisplay(job);
                          return (
                            <span
                              className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${JOB_TONE_BADGE[display.tone]}`}
                            >
                              {display.short}
                            </span>
                          );
                        })()}
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
                      <td className="whitespace-nowrap px-6 py-4">
                        {(() => {
                          const payment = getPaymentDisplay(
                            job.status,
                            job.paymentStatus ?? null
                          );
                          // Null on every job that predates payment tracking.
                          // An empty cell is the honest answer there — those
                          // jobs are not unpaid, they simply never recorded a
                          // status. The PaymentIntent id is admin-only and is
                          // deliberately absent from this board's owner view.
                          if (!payment) {
                            return <span className="text-sm text-gray-400">—</span>;
                          }
                          return (
                            <span
                              className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${PAYMENT_TONE_BADGE[payment.tone]}`}
                            >
                              {showOwnerView ? payment.customer : payment.admin}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {(() => {
                          if (!job.checkInTime) return <span>N/A</span>;
                          // On a residential clean check_in_time is the START of
                          // an arrival window, and check_out_time is the finish
                          // deadline - neither is the window's end. The window
                          // exists only as a key on the job's snapshot, so this
                          // is the one place the real promise can be read from.
                          const window =
                            job.serviceType === "residential_one_time"
                              ? getArrivalWindow(job.arrivalWindow)
                              : undefined;
                          if (!window) {
                            return <ClientTime dateString={job.checkInTime} />;
                          }
                          return (
                            <div>
                              <ClientTime dateString={job.checkInTime} dateOnly />
                              <p className="text-xs text-gray-500">
                                {window.label}
                              </p>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                        <div className="flex flex-col items-end gap-2">
                          {showOwnerView && (
                            <>
                              <CustomerJobPromoCodeField
                                jobId={job.id}
                                status={job.status}
                                checkInTime={
                                  job.checkInTime
                                    ? String(job.checkInTime)
                                    : null
                                }
                                paymentIntentId={job.paymentIntentId ?? null}
                                paymentStatus={job.paymentStatus ?? null}
                                appliedPromoCode={job.appliedPromoCode ?? null}
                              />
                              <CustomerJobCancelButton
                                jobId={job.id}
                                status={job.status}
                                checkInTime={
                                  job.checkInTime
                                    ? String(job.checkInTime)
                                    : null
                                }
                              />
                            </>
                          )}
                          <Link
                            href={
                              `${portalPrefix}/job-oversight/${job.id}` as Route
                            }
                            className="text-teal-600 hover:text-teal-900"
                          >
                            {job.evidencePacket?.photoCount
                              ? `Details · ${job.evidencePacket.photoCount} photo${
                                  job.evidencePacket.photoCount === 1 ? "" : "s"
                                }`
                              : "Details"}
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
