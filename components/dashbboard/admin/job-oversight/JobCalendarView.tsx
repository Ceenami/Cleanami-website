'use client';

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMonths, format, isToday, startOfMonth, endOfMonth } from "date-fns";
import Link from "next/link";
import { getStatusBadge } from "../../utils";

interface CalendarJob {
  id: string;
  status: string;
  checkInTime: string | null;
  property: {
    address: string;
  } | null;
  cleaners: Array<{
    cleaner: { fullName: string } | null;
  }>;
}

export const JobCalendarView = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const startDate = startOfMonth(currentDate);
  const endDate = endOfMonth(currentDate);
  const dateKey = format(startDate, "yyyy-MM-dd");

  const { data: jobsByDate, isLoading, error } = useQuery({
    queryKey: ["jobs-calendar", dateKey],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
      const response = await fetch(`/api/jobs/calendar?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Unable to load calendar jobs");
      }
      return response.json() as Promise<Record<string, CalendarJob[]>>;
    },
    staleTime: 30000,
  });

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const firstDayOfWeek = startDate.getDay();
  const daysInMonth = endOfMonth(currentDate).getDate();

  const calendarDays = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, index) => {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), index + 1);
      const key = format(date, "yyyy-MM-dd");
      return {
        date,
        key,
        jobs: (jobsByDate as Record<string, CalendarJob[]> | undefined)?.[key] ?? [],
      };
    });
  }, [currentDate, daysInMonth, jobsByDate]);

  const selectedDayJobs = selectedDay ? (jobsByDate as Record<string, CalendarJob[]> | undefined)?.[selectedDay] ?? [] : [];

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Job Calendar</h3>
          <p className="text-sm text-gray-500">
            {format(currentDate, "MMMM yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentDate(addMonths(currentDate, -1))}
            className="px-3 py-2 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            className="px-3 py-2 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            →
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading calendar...</div>
        ) : error ? (
          <div className="text-center py-12 text-red-500">{(error as Error).message}</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-7 gap-2 text-center mb-2">
              {weekdays.map((weekday) => (
                <div key={weekday} className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
                <div key={`empty-${idx}`} className="min-h-[120px] rounded-lg bg-gray-50" />
              ))}
              {calendarDays.map((day) => {
                const isTodayDay = isToday(day.date);
                return (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => setSelectedDay(day.key)}
                    className={`min-h-[120px] rounded-lg border p-3 text-left transition ${
                      isTodayDay ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-white hover:border-teal-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-900">{day.date.getDate()}</span>
                      {day.jobs.length > 0 && (
                        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-teal-700">
                          {day.jobs.length} job{day.jobs.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 text-xs text-gray-600">
                      {day.jobs.slice(0, 2).map((job: CalendarJob) => (
                        <div key={job.id} className="rounded-md p-2 bg-gray-50">
                          <div className="font-semibold text-gray-800">{job.property?.address ?? 'Unknown'}</div>
                          <div className={getStatusBadge(job.status)}>{job.status}</div>
                        </div>
                      ))}
                      {day.jobs.length > 2 && (
                        <div className="text-[11px] text-gray-500">+{day.jobs.length - 2} more</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {selectedDay && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Jobs on {format(new Date(selectedDay), 'MMM d, yyyy')}</h4>
                <p className="text-xs text-gray-500">Tap a job for details.</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="text-sm text-teal-600 hover:text-teal-800"
              >
                Close
              </button>
            </div>
            <div className="space-y-3">
              {selectedDayJobs.length === 0 ? (
                <p className="text-sm text-gray-600">No jobs scheduled for this day.</p>
              ) : (
                selectedDayJobs.map((job: CalendarJob) => (
                  <Link
                    key={job.id}
                    href={`/admin/job-oversight/${job.id}`}
                    className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-teal-300"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-semibold text-gray-900">{job.id}</p>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${getStatusBadge(job.status)}`}>
                        {job.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{job.property?.address ?? 'Unknown address'}</p>
                    <p className="text-sm text-gray-500">Cleaner: {job.cleaners.map((entry: any) => entry.cleaner?.fullName).filter(Boolean).join(', ') || 'Unassigned'}</p>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
