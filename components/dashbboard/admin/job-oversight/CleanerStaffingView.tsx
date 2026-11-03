"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AvailabilityDayEditor,
  type AvailabilityEditTarget,
} from "@/components/operations/AvailabilityDayEditor";

type Range = { start: string; end: string };

type Schedule = {
  range: Range;
  dateLocks: Record<string, boolean>;
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
  dayStates?: Array<{
    cleanerId: string;
    date: string;
    isAvailable: boolean;
    locked: boolean;
    late: boolean;
    revision: number;
    updatedAt: string;
    reopenedUntil: string | null;
  }>;
  jobs: Array<{
    id: string;
    status: string;
    checkInTime: string | null;
    checkOutTime: string | null;
    serviceType: string;
    serviceLabel?: string;
    warning?: string | null;
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
  return role
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function CleanerStaffingView() {
  const [selectedRange, setSelectedRange] = useState<Range | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [mobileCleanerId, setMobileCleanerId] = useState("");
  const [editTarget, setEditTarget] = useState<AvailabilityEditTarget | null>(
    null,
  );
  const [reopenTarget, setReopenTarget] = useState<{
      cleanerId: string;
      date: string;
    } | null>(null),
    [reason, setReason] = useState(""),
    [operationError, setOperationError] = useState(""),
    [reopening, setReopening] = useState(false);
  const rangeQuery = selectedRange
    ? `?start=${selectedRange.start}&end=${selectedRange.end}`
    : "";

  const { data, isPending, isError, error, refetch } = useQuery<Schedule>({
    queryKey: [
      "cleaner-staffing",
      selectedRange?.start ?? "current",
      selectedRange?.end ?? "current",
    ],
    queryFn: async () => {
      const response = await fetch(`/api/admin/cleaner-schedule${rangeQuery}`);
      const body = (await response.json()) as Schedule & { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Unable to load staffing schedule");
      return body;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const dates = useMemo(() => (data ? buildDates(data.range) : []), [data]);
  const availabilityByCell = useMemo(() => {
    const rows = new Map<string, Schedule["availability"][number]>();
    data?.availability.forEach((row) =>
      rows.set(`${row.cleanerId}:${row.date}`, row),
    );
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
    const rows = new Map<
      string,
      Array<Schedule["jobs"][number] & { role: string }>
    >();
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

  if (isPending)
    return <p className="text-sm text-gray-500">Loading cleaner staffing…</p>;
  if (isError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error instanceof Error
          ? error.message
          : "Unable to load cleaner staffing."}
      </div>
    );
  }

  const visibleCleaners = showInactive
    ? data.cleaners
    : data.cleaners.filter((cleaner) => cleaner.eligibleForAssignments);
  const mobileCleaner =
    visibleCleaners.find((c) => c.id === mobileCleanerId) ?? visibleCleaners[0];
  const uncovered = data.jobs.filter(
    (job) =>
      job.status === "unassigned" ||
      !job.checkInTime ||
      !job.assignments.some((a) =>
        ["primary", "laundry_lead"].includes(a.role),
      ),
  );
  const missed = visibleCleaners.filter((cleaner) =>
    dates.some(
      (date) =>
        data.dateLocks?.[date] &&
        !submissionsByCleaner
          .get(cleaner.id)
          ?.some((row) => row.periodStart <= date && row.periodEnd >= date),
    ),
  );
  async function reopen() {
    if (!reopenTarget) return;
    setReopening(true);
    try {
      const r = await fetch("/api/admin/availability/reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reopenTarget, reason }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      await refetch();
      setReopenTarget(null);
      setReason("");
    } catch (e) {
      setOperationError(e instanceof Error ? e.message : "Reopen failed");
    } finally {
      setReopening(false);
    }
  }

  function editDate(cleanerId: string, cleanerName: string, date: string) {
    const state = data!.dayStates?.find(
      (day) => day.cleanerId === cleanerId && day.date === date,
    );
    const available = availabilityByCell.get(`${cleanerId}:${date}`);
    setEditTarget({
      cleanerId,
      cleanerName,
      date,
      revision: state?.revision ?? 0,
      isAvailable: state?.isAvailable ?? !!available,
      onCallEligible: available?.onCallEligible ?? false,
      openPoolEligible: available?.openPoolEligible ?? false,
      workingJobs: (jobsByCell.get(`${cleanerId}:${date}`) ?? [])
        .filter((job) => ["primary", "laundry_lead"].includes(job.role))
        .map((job) => ({ id: job.id, address: job.propertyAddress })),
    });
  }

  return (
    <section className="min-w-0 space-y-4">
      {editTarget && (
        <AvailabilityDayEditor
          key={`${editTarget.cleanerId}:${editTarget.date}:${editTarget.revision}`}
          target={editTarget}
          onSaved={refetch}
          onClose={() => setEditTarget(null)}
        />
      )}
      {reopenTarget && (
        <form
          className="border-b pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            reopen();
          }}
        >
          <label className="text-sm">
            Reason to reopen {reopenTarget.date} for 24 hours
            <input
              required
              minLength={3}
              maxLength={500}
              className="block border rounded px-3 py-2 mt-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={reopening || reason.trim().length < 3}
            className="mt-2 mr-4 text-teal-800"
          >
            Reopen date
          </button>
          <button type="button" onClick={() => setReopenTarget(null)}>
            Cancel
          </button>
          <p className="text-xs mt-2">Assigned coverage remains protected.</p>
        </form>
      )}
      {operationError && (
        <p role="alert" className="text-red-700">
          {operationError}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Cleaner Staffing
          </h2>
          <p className="text-sm text-gray-500">
            Availability, submissions, and assigned cleans in Eastern Time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedRange(shiftRange(data.range, -dates.length))}
            className="min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setSelectedRange(null)}
            className="min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Current block
          </button>
          <button
            type="button"
            onClick={() => setSelectedRange(shiftRange(data.range, dates.length))}
            className="min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      </div>

      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(event) => setShowInactive(event.target.checked)}
        />
        Show ineligible and inactive cleaners
      </label>
      <p className="text-sm text-amber-800">
        {missed.length} cleaner(s) have unacknowledged locked dates ·{" "}
        {uncovered.length} uncovered/unscheduled job(s).
      </p>
      {uncovered.length > 0 && (
        <section className="border-l-2 border-amber-500 pl-3">
          <h3 className="font-medium">Coverage needs review</h3>
          {uncovered.map((job) => (
            <a
              key={job.id}
              href={`/admin/job-oversight/${job.id}`}
              className="block py-2 text-sm text-amber-900"
            >
              {job.serviceLabel ?? job.serviceType} · {job.propertyAddress} ·{" "}
              {job.checkInTime
                ? `${displayDay(easternDate(job.checkInTime)!)} ${displayTime(job.checkInTime)} ET`
                : "Arrival not scheduled"}
              {job.warning ? ` · ${job.warning}` : ""}
            </a>
          ))}
        </section>
      )}
      <section className="md:hidden border-t pt-4 space-y-3">
        <label className="block text-sm">
          Cleaner detail
          <select
            className="mt-2 block w-full border rounded p-3"
            value={mobileCleaner?.id ?? ""}
            onChange={(e) => setMobileCleanerId(e.target.value)}
          >
            {visibleCleaners.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        </label>
        {mobileCleaner &&
          dates.map((date) => {
            const state = data.dayStates?.find(
              (d) => d.cleanerId === mobileCleaner.id && d.date === date,
            );
            const available = availabilityByCell.get(
              `${mobileCleaner.id}:${date}`,
            );
            const acknowledged = submissionsByCleaner
              .get(mobileCleaner.id)
              ?.some((row) => row.periodStart <= date && row.periodEnd >= date);
            const locked = state?.locked ?? data.dateLocks?.[date];
            const cellJobs =
              jobsByCell.get(`${mobileCleaner.id}:${date}`) ?? [];
            return (
              <details key={date} className="border-b py-3">
                <summary className="text-sm font-medium">
                  {displayDay(date)} ·{" "}
                  {available
                    ? "Available"
                    : acknowledged
                      ? "Unavailable"
                      : "Not acknowledged"}{" "}
                  · {locked ? "Locked" : "Editable"}
                  {state?.late ? " · Late addition" : ""}
                </summary>
                <div className="mt-3 text-sm space-y-2">
                  <p>
                    9 AM–4 PM ET{available?.onCallEligible ? " · On-call" : ""}
                    {available?.openPoolEligible ? " · Open Pool" : ""}
                  </p>
                  {state && (
                    <p className="text-xs text-gray-500">
                      Revision {state.revision} · Last changed{" "}
                      {displayTimestamp(state.updatedAt)} ET
                    </p>
                  )}
                  {locked && (
                    <button
                      className="text-teal-800"
                      onClick={() => {
                        setReason("");
                        setReopenTarget({ cleanerId: mobileCleaner.id, date });
                      }}
                    >
                      Reopen with reason
                    </button>
                  )}
                  <button
                    className="block text-teal-800"
                    onClick={() =>
                      editDate(mobileCleaner.id, mobileCleaner.fullName, date)
                    }
                  >
                    Edit availability
                  </button>
                  {cellJobs.map((job) => (
                    <a
                      key={`${job.id}:${job.role}`}
                      className="block border-l-2 border-sky-500 pl-3"
                      href={`/admin/job-oversight/${job.id}`}
                    >
                      {job.serviceLabel ?? job.serviceType} ·{" "}
                      {displayTime(job.checkInTime)} ET
                      <br />
                      {job.propertyAddress}
                      <br />
                      {roleLabel(job.role)}
                      {job.role === "backup" ? " · Coverage only" : ""}
                      {job.warning && (
                        <span className="block text-amber-800">
                          {job.warning}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </details>
            );
          })}
      </section>

      <div className="min-w-0 max-w-full rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3 text-xs text-gray-600">
          Green: marked available. Blue: assigned clean. Gray “No submission”
          means this period predates the submission ledger or the cleaner has
          not submitted.
        </div>
        <p className="border-b border-gray-200 px-4 py-2 text-xs text-gray-500 sm:hidden">
          Swipe left or right to see more dates.
        </p>
        <div
          role="region"
          aria-label="Cleaner availability by date"
          tabIndex={0}
          className="w-full max-w-full overflow-x-auto overscroll-x-contain rounded-b-lg [--cleaner-column-width:9rem] focus-visible:outline-2 focus-visible:outline-teal-600 sm:[--cleaner-column-width:15rem]"
        >
          <table
            className="table-fixed divide-y divide-gray-200 text-sm"
            style={{ width: `calc(var(--cleaner-column-width) + ${dates.length * 9}rem)` }}
          >
            <colgroup>
              <col style={{ width: "var(--cleaner-column-width)" }} />
              {dates.map((date) => <col key={date} style={{ width: "9rem" }} />)}
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 sm:px-4">
                  Cleaner
                </th>
                {dates.map((date) => (
                  <th key={date} scope="col" className="px-3 py-3 text-left text-xs font-semibold text-gray-500">
                    {displayDay(date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {visibleCleaners.map((cleaner) => (
                <tr key={cleaner.id}>
                  <th scope="row" className="sticky left-0 z-10 break-words bg-white px-3 py-3 text-left align-top font-normal sm:px-4">
                    <p className="font-semibold text-gray-900">{cleaner.fullName}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {cleaner.eligibleForAssignments
                        ? "Assignment eligible"
                        : "Not assignment eligible"}
                    </p>
                    {submissionsByCleaner.get(cleaner.id)?.map((submission) => (
                      <p
                        key={submission.periodStart}
                        className="mt-1 text-xs text-teal-700"
                      >
                        {submission.submissionMode === "override"
                          ? "Catch-up"
                          : "Submitted"}{" "}
                        {displayTimestamp(submission.firstSubmittedAt)}
                        {submission.lastUpdatedAt !==
                          submission.firstSubmittedAt &&
                          ` · changed ${displayTimestamp(submission.lastUpdatedAt)}`}
                      </p>
                    ))}
                  </th>
                  {dates.map((date) => {
                    const state = data.dayStates?.find(
                      (day) =>
                        day.cleanerId === cleaner.id && day.date === date,
                    );
                    const availability = availabilityByCell.get(
                      `${cleaner.id}:${date}`,
                    );
                    const submitted =
                      submissionsByCleaner
                        .get(cleaner.id)
                        ?.some(
                          (row) =>
                            row.periodStart <= date && row.periodEnd >= date,
                        ) ?? false;
                    const jobs = jobsByCell.get(`${cleaner.id}:${date}`) ?? [];
                    const locked = state?.locked ?? data.dateLocks?.[date];
                    return (
                      <td key={date} className="px-3 py-3 align-top">
                        <div className="space-y-2">
                          {state && (
                            <p className="text-xs text-gray-500">
                              {state.locked ? "Locked" : "Editable"}
                              {state.late ? " · Late addition" : ""} · r
                              {state.revision}
                              <span className="block">
                                Changed {displayTimestamp(state.updatedAt)} ET
                              </span>
                            </p>
                          )}
                          {!state && (
                            <p className="text-xs text-gray-500">
                              {locked ? "Locked" : "Editable"}
                            </p>
                          )}
                          {locked && (
                            <button
                              className="text-xs text-teal-800"
                              onClick={() => {
                                setReopenTarget({
                                  cleanerId: cleaner.id,
                                  date,
                                });
                                setReason("");
                                setOperationError("");
                              }}
                            >
                              Reopen with reason
                            </button>
                          )}
                          <button
                            className="block text-xs text-teal-800"
                            onClick={() =>
                              editDate(cleaner.id, cleaner.fullName, date)
                            }
                          >
                            Edit availability
                          </button>
                          {availability ? (
                            <div className="rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
                              <p className="font-semibold">Available</p>
                              <p>
                                {availability.startTime.slice(0, 5)}–
                                {availability.endTime.slice(0, 5)}
                              </p>
                              {(availability.onCallEligible ||
                                availability.openPoolEligible) && (
                                <p className="mt-1 text-[11px]">
                                  {[
                                    availability.onCallEligible && "On-call",
                                    availability.openPoolEligible &&
                                      "Open Pool",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-500">
                              {submitted
                                ? "Submitted — unavailable"
                                : "No submission"}
                            </div>
                          )}
                          {jobs.map((job) => (
                            <a
                              key={`${job.id}:${job.role}`}
                              href={`/admin/job-oversight/${job.id}`}
                              className="block rounded-md bg-sky-50 px-2 py-1.5 text-xs text-sky-900 hover:bg-sky-100"
                              title={`${job.propertyAddress} · ${job.status}`}
                            >
                              <p className="font-semibold">
                                {roleLabel(job.role)} ·{" "}
                                {displayTime(job.checkInTime)}
                              </p>
                              <p className="mt-0.5 truncate">
                                {job.propertyAddress}
                              </p>
                              <p className="mt-0.5">
                                {job.serviceLabel ?? job.serviceType}
                                {["backup", "on-call"].includes(job.role)
                                  ? " · Coverage only"
                                  : ""}
                              </p>
                              {job.warning && (
                                <p className="mt-1 text-amber-800">
                                  {job.warning}
                                </p>
                              )}
                            </a>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {visibleCleaners.length === 0 && (
                <tr>
                  <td
                    colSpan={dates.length + 1}
                    className="px-4 py-8 text-center text-sm text-gray-500"
                  >
                    No eligible cleaners found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
