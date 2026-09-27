"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

type Range = { start: string; end: string };

type Schedule = {
  range: Range;
  cleaners: Array<{
    id: string;
    fullName: string;
    accountStatus: string;
    eligibleForAssignments: boolean;
    reliabilityScore: string | null;
  }>;
  availability: Array<{
    cleanerId: string;
    date: string;
    onCallEligible: boolean | null;
    openPoolEligible: boolean | null;
    startTime: string;
    endTime: string;
  }>;
  submissions: Array<{
    cleanerId: string;
    periodStart: string;
    periodEnd: string;
    submissionMode: "full" | "override";
    firstSubmittedAt: string;
    lastUpdatedAt: string;
  }>;
  jobs: Array<{
    id: string;
    status: string;
    checkInTime: string | null;
    checkOutTime: string | null;
    serviceType: string;
    propertyAddress: string;
    assignments: Array<{ cleanerId: string; role: string }>;
  }>;
};

function easternDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

function buildDates(range: Range): string[] {
  const cursor = new Date(`${range.start}T12:00:00.000Z`);
  const last = new Date(`${range.end}T12:00:00.000Z`);
  const dates: string[] = [];
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function shiftRange(range: Range, days: number): Range {
  const start = new Date(`${range.start}T12:00:00.000Z`);
  const end = new Date(`${range.end}T12:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() + days);
  end.setUTCDate(end.getUTCDate() + days);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function displayDay(iso: string): string {
  return new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function displayTime(value: string | null): string {
  if (!value) return "Time TBD";
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function displayTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function roleLabel(role: string): string {
  return role.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function CleanerStaffingView() {
  const [selectedRange, setSelectedRange] = useState<Range | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const rangeQuery = selectedRange
    ? `?start=${selectedRange.start}&end=${selectedRange.end}`
    : "";

  const { data, isPending, isError, error } = useQuery<Schedule>({
    queryKey: ["cleaner-staffing", selectedRange?.start ?? "current", selectedRange?.end ?? "current"],
    queryFn: async () => {
      const response = await fetch(`/api/admin/cleaner-schedule${rangeQuery}`);
      const body = (await response.json()) as Schedule & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load staffing schedule");
      return body;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const dates = useMemo(() => (data ? buildDates(data.range) : []), [data]);
  const availabilityByCell = useMemo(() => {
    const rows = new Map<string, Schedule["availability"][number]>();
    data?.availability.forEach((row) => rows.set(`${row.cleanerId}:${row.date}`, row));
    return rows;
  }, [data]);
  const submissionsByCleaner = useMemo(() => {
    const rows = new Map<string, Schedule["submissions"]>();
    data?.submissions.forEach((row) => {
      const existing = rows.get(row.cleanerId) ?? [];
      existing.push(row);
      rows.set(row.cleanerId, existing);
    });
    return rows;
  }, [data]);
  const jobsByCell = useMemo(() => {
    const rows = new Map<string, Array<Schedule["jobs"][number] & { role: string }>>();
    data?.jobs.forEach((job) => {
      const date = easternDate(job.checkInTime);
      if (!date) return;
      job.assignments.forEach((assignment) => {
        const key = `${assignment.cleanerId}:${date}`;
        const existing = rows.get(key) ?? [];
        existing.push({ ...job, role: assignment.role });
        rows.set(key, existing);
      });
    });
    return rows;
  }, [data]);

  if (isPending) return <p className="text-sm text-gray-500">Loading cleaner staffing…</p>;
  if (isError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error instanceof Error ? error.message : "Unable to load cleaner staffing."}
      </div>
    );
  }

  const visibleCleaners = showInactive
    ? data.cleaners
    : data.cleaners.filter((cleaner) => cleaner.eligibleForAssignments);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Cleaner Staffing</h2>
          <p className="text-sm text-gray-500">
            Availability, submissions, and assigned cleans in Eastern Time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedRange(shiftRange(data.range, -dates.length))}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setSelectedRange(null)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Current block
          </button>
          <button
            type="button"
            onClick={() => setSelectedRange(shiftRange(data.range, dates.length))}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(event) => setShowInactive(event.target.checked)}
        />
        Show ineligible and inactive cleaners
      </label>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3 text-xs text-gray-600">
          Green: marked available. Blue: assigned clean. Gray “No submission” means
          this period predates the submission ledger or the cleaner has not submitted.
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-max divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="sticky left-0 z-10 min-w-60 bg-gray-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Cleaner
                </th>
                {dates.map((date) => (
                  <th key={date} className="min-w-36 px-3 py-3 text-left text-xs font-semibold text-gray-500">
                    {displayDay(date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {visibleCleaners.map((cleaner) => (
                <tr key={cleaner.id}>
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 align-top">
                    <p className="font-semibold text-gray-900">{cleaner.fullName}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {cleaner.eligibleForAssignments ? "Assignment eligible" : "Not assignment eligible"}
                    </p>
                    {submissionsByCleaner.get(cleaner.id)?.map((submission) => (
                      <p key={submission.periodStart} className="mt-1 text-xs text-teal-700">
                        {submission.submissionMode === "override" ? "Catch-up" : "Submitted"} {displayTimestamp(submission.firstSubmittedAt)}
                        {submission.lastUpdatedAt !== submission.firstSubmittedAt && ` · changed ${displayTimestamp(submission.lastUpdatedAt)}`}
                      </p>
                    ))}
                  </td>
                  {dates.map((date) => {
                    const availability = availabilityByCell.get(`${cleaner.id}:${date}`);
                    const submitted = submissionsByCleaner
                      .get(cleaner.id)
                      ?.some((row) => row.periodStart <= date && row.periodEnd >= date) ?? false;
                    const jobs = jobsByCell.get(`${cleaner.id}:${date}`) ?? [];
                    return (
                      <td key={date} className="px-3 py-3 align-top">
                        <div className="space-y-2">
                          {availability ? (
                            <div className="rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
                              <p className="font-semibold">Available</p>
                              <p>{availability.startTime.slice(0, 5)}–{availability.endTime.slice(0, 5)}</p>
                              {(availability.onCallEligible || availability.openPoolEligible) && (
                                <p className="mt-1 text-[11px]">
                                  {[availability.onCallEligible && "On-call", availability.openPoolEligible && "Open Pool"].filter(Boolean).join(" · ")}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-500">
                              {submitted ? "Submitted — unavailable" : "No submission"}
                            </div>
                          )}
                          {jobs.map((job) => (
                            <a
                              key={`${job.id}:${job.role}`}
                              href={`/admin/job-oversight/${job.id}`}
                              className="block rounded-md bg-sky-50 px-2 py-1.5 text-xs text-sky-900 hover:bg-sky-100"
                              title={`${job.propertyAddress} · ${job.status}`}
                            >
                              <p className="font-semibold">{roleLabel(job.role)} · {displayTime(job.checkInTime)}</p>
                              <p className="mt-0.5 truncate">{job.propertyAddress}</p>
                            </a>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {visibleCleaners.length === 0 && (
                <tr><td colSpan={dates.length + 1} className="px-4 py-8 text-center text-sm text-gray-500">No eligible cleaners found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
