"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMonths, format, startOfMonth, endOfMonth } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, List } from "lucide-react";
import Link from "next/link";
import { getStatusBadge } from "../../utils";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { JobCardOperations } from "@/components/operations/JobCardOperations";
import type { AdminJobOperations } from "@/lib/jobs/admin-job-summary";

interface CalendarJob {
  openRestockCount?: number;
  id: string;
  status: string;
  serviceLabel: string;
  warnings: string[];
  operations: AdminJobOperations | null;
  checkInTime: string | null;
  property: { address: string } | null;
  cleaners: Array<{
    role: string;
    cleaner: { fullName: string } | null;
  }>;
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const focusStyle = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-700";

function CalendarJobCard({ job }: { job: CalendarJob }) {
  return (
    <Link
      href={`/admin/job-oversight/${job.id}`}
      className={`block min-w-0 rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-teal-500 motion-reduce:transition-none ${focusStyle}`}
    >
      <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
        <div className="w-full min-w-0 sm:flex-1">
          <p className="font-medium text-gray-900 [overflow-wrap:anywhere]">
            {job.property?.address ?? "Unknown address"}
          </p>
          <p className="mt-1 text-sm text-teal-800">{job.serviceLabel}</p>
        </div>
        <span className={`max-w-full rounded-full px-2 py-1 text-xs font-semibold [overflow-wrap:anywhere] ${getStatusBadge(job.status)}`}>
          {job.status.replaceAll("_", " ")}
        </span>
      </div>
      <div className="mt-3"><JobCardOperations operations={job.operations} /></div>
      {!!job.openRestockCount && <p className="mt-2 text-xs font-semibold text-teal-800">Restocking · {job.openRestockCount} open</p>}
    </Link>
  );
}

export const JobCalendarView = () => {
  const [currentDate, setCurrentDate] = useState(() =>
    toZonedTime(new Date(), "America/New_York"),
  );
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);

  const startDate = startOfMonth(currentDate);
  const endDate = endOfMonth(currentDate);
  const dateKey = format(startDate, "yyyy-MM-dd");
  const monthLabel = format(currentDate, "MMMM yyyy");
  const today = format(toZonedTime(new Date(), "America/New_York"), "yyyy-MM-dd");

  const { data: jobsByDate, isLoading, error } = useQuery({
    queryKey: ["jobs-calendar", dateKey],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: fromZonedTime(
          `${format(startDate, "yyyy-MM-dd")}T00:00:00`, "America/New_York",
        ).toISOString(),
        endDate: fromZonedTime(
          `${format(endDate, "yyyy-MM-dd")}T23:59:59.999`, "America/New_York",
        ).toISOString(),
      });
      const response = await fetch(`/api/jobs/calendar?${params.toString()}`);
      if (!response.ok) throw new Error("Unable to load calendar jobs");
      return response.json() as Promise<Record<string, CalendarJob[]>>;
    },
    staleTime: 30000,
    refetchInterval: 30000,
  });

  const calendarDays = useMemo(() =>
    Array.from({ length: endOfMonth(currentDate).getDate() }, (_, index) => {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), index + 1);
      const key = format(date, "yyyy-MM-dd");
      return { date, key, jobs: jobsByDate?.[key] ?? [] };
    }), [currentDate, jobsByDate]);

  const cells = [...Array.from({ length: startDate.getDay() }, () => null), ...calendarDays];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const scheduledDays = calendarDays.filter((day) => day.jobs.length > 0);
  const jobCount = calendarDays.reduce((total, day) => total + day.jobs.length, 0);
  const selectedDayJobs = selectedDay ? jobsByDate?.[selectedDay] ?? [] : [];

  useEffect(() => {
    if (selectedDay) detailHeading.current?.focus();
  }, [selectedDay]);

  function changeMonth(offset: number) {
    setSelectedDay(null);
    setCurrentDate((date) => addMonths(startOfMonth(date), offset));
  }

  function closeDay() {
    setSelectedDay(null);
    selectedButton.current?.focus();
  }

  return (
    <section aria-label="Job calendar" className="min-w-0 overflow-hidden rounded-lg bg-white shadow-md">
      <div className="space-y-4 border-b border-gray-200 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900">Job Calendar</h3>
            <p id="calendar-month" aria-live="polite" aria-atomic="true" className="text-sm text-gray-600">{monthLabel}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)} className={`flex size-11 items-center justify-center rounded-md text-gray-700 transition-colors hover:bg-gray-100 motion-reduce:transition-none ${focusStyle}`}>
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Next month" onClick={() => changeMonth(1)} className={`flex size-11 items-center justify-center rounded-md text-gray-700 transition-colors hover:bg-gray-100 motion-reduce:transition-none ${focusStyle}`}>
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Calendar layout" className="inline-flex rounded-lg bg-gray-100 p-1">
            {([{ value: "grid", label: "Grid", Icon: CalendarDays }, { value: "list", label: "List", Icon: List }] as const).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={layout === value}
                aria-controls="calendar-content"
                onClick={() => { setLayout(value); setSelectedDay(null); }}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors motion-reduce:transition-none ${focusStyle} ${layout === value ? "bg-white text-teal-800 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
              >
                <Icon size={16} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            {isLoading ? "Loading jobs…" : error ? "Eastern Time" : `${jobCount} ${jobCount === 1 ? "job" : "jobs"} · Eastern Time`}
          </p>
        </div>
      </div>

      <div id="calendar-content" aria-busy={isLoading} className="min-w-0">
        {isLoading ? (
          <p role="status" className="px-4 py-12 text-center text-sm text-gray-500">Loading calendar…</p>
        ) : error ? (
          <p role="alert" className="px-4 py-12 text-center text-sm text-red-600">{(error as Error).message}</p>
        ) : layout === "list" ? (
          <div className="space-y-6 p-4 sm:p-5">
            {scheduledDays.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">No jobs scheduled this month.</p>
            ) : scheduledDays.map((day) => (
              <section key={day.key} aria-labelledby={`list-day-${day.key}`}>
                <h4 id={`list-day-${day.key}`} className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-gray-900">
                  <time dateTime={day.key}>{format(day.date, "EEEE, MMM d")}</time>
                  <span className="text-xs font-normal text-gray-500">{day.jobs.length} {day.jobs.length === 1 ? "job" : "jobs"}</span>
                </h4>
                <div className="space-y-3">{day.jobs.map((job) => <CalendarJobCard key={job.id} job={job} />)}</div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-4 px-2 pb-4 pt-3 sm:p-5">
            <p className="px-2 text-xs text-gray-500 sm:px-0">Select a date to view its jobs.</p>
            <table aria-labelledby="calendar-month" className="w-full table-fixed border-collapse">
              <thead><tr>{weekdays.map((day) => (
                <th key={day} scope="col" aria-label={day} className="pb-2 text-center text-[11px] font-medium text-gray-500 sm:text-xs">
                  <abbr title={day} className="no-underline">{day.slice(0, 3)}</abbr>
                </th>
              ))}</tr></thead>
              <tbody>{weeks.map((week, index) => (
                <tr key={index}>{week.map((day, column) => (
                  <td key={day?.key ?? `blank-${column}`} className="border border-gray-200 p-0 align-top">
                    {day ? (
                      <button
                        type="button"
                        aria-label={`${format(day.date, "EEEE, MMMM d, yyyy")}, ${day.jobs.length} ${day.jobs.length === 1 ? "job" : "jobs"}`}
                        aria-pressed={selectedDay === day.key}
                        aria-current={day.key === today ? "date" : undefined}
                        aria-controls="calendar-day-details"
                        onClick={(event) => { selectedButton.current = event.currentTarget; setSelectedDay(day.key); if (selectedDay === day.key) detailHeading.current?.focus(); }}
                        className={`flex min-h-20 w-full min-w-0 flex-col gap-2 p-1 text-left transition-colors motion-reduce:transition-none sm:min-h-24 sm:p-2 xl:min-h-44 ${focusStyle} ${selectedDay === day.key ? "bg-teal-50 ring-2 ring-inset ring-teal-700" : "bg-white hover:bg-gray-50"}`}
                      >
                        <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold sm:size-7 sm:text-sm ${day.key === today ? "bg-teal-700 text-white" : "text-gray-900"}`}>{day.date.getDate()}</span>
                        {day.jobs.length > 0 && (
                          <span className="text-center text-[10px] font-semibold leading-tight text-teal-800 sm:text-xs">
                            <span className="block sm:inline">{day.jobs.length}</span>{" "}<span>{day.jobs.length === 1 ? "job" : "jobs"}</span>
                          </span>
                        )}
                        <span className="hidden w-full min-w-0 space-y-2 xl:block">
                          {day.jobs.slice(0, 2).map((job) => (
                            <span key={job.id} className="block border-l-2 border-teal-600 pl-2 text-xs">
                              <span className="line-clamp-2 font-medium text-gray-900 [overflow-wrap:anywhere]">{job.property?.address ?? "Unknown address"}</span>
                              <span className="mt-1 block break-words text-gray-500">{job.serviceLabel}</span>
                              {!!job.openRestockCount && <span className="mt-1 block font-semibold text-teal-800">Restocking · {job.openRestockCount} open</span>}
                              <span className={`mt-1 inline-block max-w-full rounded px-1 py-0.5 text-[10px] [overflow-wrap:anywhere] ${getStatusBadge(job.status)}`}>{job.status.replaceAll("_", " ")}</span>
                            </span>
                          ))}
                          {day.jobs.length > 2 && <span className="block text-xs text-gray-500">+{day.jobs.length - 2} more</span>}
                        </span>
                      </button>
                    ) : <div aria-hidden="true" className="min-h-20 bg-gray-50 sm:min-h-24 xl:min-h-44" />}
                  </td>
                ))}</tr>
              ))}</tbody>
            </table>
            {jobCount === 0 && <p className="px-2 text-sm text-gray-500 sm:px-0">No jobs scheduled this month.</p>}
            <section id="calendar-day-details" aria-label="Selected date jobs" className={selectedDay ? "border-t border-gray-200 px-2 pt-4 sm:px-0" : "hidden"}>
              {selectedDay && <>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 ref={detailHeading} tabIndex={-1} className="rounded text-sm font-semibold text-gray-900 focus-visible:outline-2 focus-visible:outline-teal-700">
                      {format(new Date(`${selectedDay}T12:00:00`), "EEEE, MMM d, yyyy")}
                    </h4>
                    <p className="mt-1 text-xs text-gray-500">{selectedDayJobs.length} {selectedDayJobs.length === 1 ? "job" : "jobs"} · Eastern Time</p>
                  </div>
                  <button type="button" onClick={closeDay} className={`min-h-11 shrink-0 rounded-md px-3 text-sm font-medium text-teal-800 hover:bg-teal-50 ${focusStyle}`}>Back to calendar</button>
                </div>
                {selectedDayJobs.length === 0 ? (
                  <p className="py-3 text-sm text-gray-500">No jobs scheduled for this day.</p>
                ) : <div className="space-y-3">{selectedDayJobs.map((job) => <CalendarJobCard key={job.id} job={job} />)}</div>}
              </>}
            </section>
          </div>
        )}
      </div>
    </section>
  );
};
