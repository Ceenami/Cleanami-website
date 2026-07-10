'use client';

import { JobListView } from "./JobListView";
import { JobCalendarView } from "./JobCalendarView";
import { SwapRequestsView } from "./SwapRequestsView";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export function JobOversightPageClient() {
  const searchParams = useSearchParams();
  const view = searchParams.get('view') || 'list';

  return (
    <div className="space-y-6">
      <div className="flex border-b border-gray-200">
        <Link
          href="?view=list"
          className={`py-3 px-6 text-sm font-medium ${
            view === "list"
              ? "border-b-2 border-teal-500 text-teal-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Job List
        </Link>
        <Link
          href="?view=calendar"
          className={`py-3 px-6 text-sm font-medium ${
            view === "calendar"
              ? "border-b-2 border-teal-500 text-teal-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Calendar View
        </Link>
        <Link
          href="?view=swaps"
          className={`py-3 px-6 text-sm font-medium ${
            view === "swaps"
              ? "border-b-2 border-teal-500 text-teal-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Swap Requests
        </Link>
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