'use client';

import { JobListView } from "./JobListView";
import { JobCalendarView } from "./JobCalendarView";
import { SwapRequestsView } from "./SwapRequestsView";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

export function JobOversightPageClient() {
  const searchParams = useSearchParams();
  const view = searchParams.get('view') || 'list';

  // Pending swaps used to be visible only to someone who already thought to
  // open this tab. The count makes an outstanding request obvious from the
  // Job Oversight landing view.
  const { data: pendingSwapCount = 0 } = useQuery({
    queryKey: ["swapRequests", "pendingCount"],
    queryFn: async () => {
      const response = await fetch("/api/swap-requests?status=pending");
      if (!response.ok) return 0;
      const rows = (await response.json()) as unknown[];
      return Array.isArray(rows) ? rows.length : 0;
    },
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="-mx-4 overflow-x-auto border-b border-gray-200 px-4 sm:mx-0 sm:px-0">
        <nav className="flex min-w-max" aria-label="Job oversight views">
        <Link
          href="?view=list"
          className={`whitespace-nowrap px-4 py-3 text-sm font-medium sm:px-6 ${
            view === "list"
              ? "border-b-2 border-teal-500 text-teal-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Job List
        </Link>
        <Link
          href="?view=calendar"
          className={`whitespace-nowrap px-4 py-3 text-sm font-medium sm:px-6 ${
            view === "calendar"
              ? "border-b-2 border-teal-500 text-teal-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Calendar View
        </Link>
        <Link
          href="?view=swaps"
          className={`flex items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-medium sm:px-6 ${
            view === "swaps"
              ? "border-b-2 border-teal-500 text-teal-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Swap Requests
          {pendingSwapCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
              {pendingSwapCount}
            </span>
          )}
        </Link>
        </nav>
      </div>
      <div>
        {view === 'list' && <JobListView />}
        {view === 'calendar' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-900">Job Calendar</h2>
            <JobCalendarView />
          </div>
        )}
        {view === 'swaps' && <SwapRequestsView />}
      </div>
    </div>
  );
}
