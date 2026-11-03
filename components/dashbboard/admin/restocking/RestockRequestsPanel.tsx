"use client";
import { useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import { formatInTimeZone } from "date-fns-tz";
import { toast } from "sonner";
import type { RestockStatus } from "@/db/schemas";
import {
  RESTOCK_ACTIONS,
  RESTOCK_ACTION_LABELS,
  restockPropertyUrl,
  type RestockDetails,
  type RestockItem,
} from "@/lib/restocking/types";

export const restockFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2";
export const restockLink = `font-medium text-teal-700 hover:underline ${restockFocus}`;
export function restockDate(value: string, withTime = true) {
  return formatInTimeZone(
    value,
    "America/New_York",
    withTime ? "MMM d, yyyy h:mm a zzz" : "MMM d, yyyy",
  );
}
export async function fetchRestocking<T>(params: URLSearchParams): Promise<T> {
  const response = await fetch(`/api/admin/restocking?${params}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not load restocking requests.");
  return response.json();
}
function RequestRow({
  row,
  focused,
  onMove,
  busy,
}: {
  row: RestockItem;
  focused: boolean;
  onMove: (row: RestockItem, status: RestockStatus) => void;
  busy: boolean;
}) {
  return (
    <li
      id={`request-${row.id}`}
      className={`scroll-mt-24 py-5 ${focused ? "rounded-lg bg-teal-50 px-4 ring-1 ring-inset ring-teal-200" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {focused && (
            <p className="mb-1 text-xs font-medium text-teal-800">
              Selected request
            </p>
          )}
          <h3 className="break-words font-semibold text-gray-900">
            {row.quantity} × {row.item}
          </h3>
          <p
            className={`mt-1 text-sm ${row.urgency === "urgent" ? "font-semibold text-red-700" : "text-gray-600"}`}
          >
            {row.urgency} priority ·{" "}
            <span className="capitalize">{row.status}</span>
          </p>
        </div>
        <div
          className="flex flex-wrap gap-2"
          aria-label={`Actions for ${row.item}`}
        >
          {RESTOCK_ACTIONS[row.status].map((status) => (
            <button
              key={status}
              type="button"
              disabled={busy}
              onClick={() => onMove(row, status)}
              className={`min-h-10 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium disabled:opacity-50 ${restockFocus} ${status === "declined" ? "text-red-700 hover:bg-red-50" : "text-teal-800 hover:bg-teal-50"}`}
            >
              {RESTOCK_ACTION_LABELS[status]}
            </button>
          ))}
          {busy && (
            <span role="status" className="self-center text-xs text-gray-500">
              Saving…
            </span>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        {row.cleanerName ?? "Cleaner unavailable"} ·{" "}
        {restockDate(row.createdAt)}
      </p>
      {row.notes && (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-700">
          {row.notes}
        </p>
      )}
      {row.adminNotes && (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-600">
          <span className="font-medium">Office notes: </span>
          {row.adminNotes}
        </p>
      )}
      <p className="mt-2 text-sm">
        {row.jobId ? (
          <Link
            href={`/admin/job-oversight/${row.jobId}` as Route}
            className={restockLink}
          >
            View source job
            {row.jobDate ? ` · ${restockDate(row.jobDate, false)}` : ""}
          </Link>
        ) : (
          <span className="text-gray-500">Source job unavailable</span>
        )}
        {row.resolvedAt && (
          <span className="ml-3 text-gray-500">
            Closed {restockDate(row.resolvedAt, false)}
          </span>
        )}
      </p>
    </li>
  );
}
export function RestockRequestsPanel({
  propertyId,
  jobId,
  requestId,
  jobPropertyId,
}: {
  propertyId?: string;
  jobId?: string;
  requestId?: string;
  jobPropertyId?: string | null;
}) {
  const [includeResolved, setIncludeResolved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const qc = useQueryClient();
  const scope = propertyId ? "propertyId" : "jobId",
    id = propertyId ?? jobId!;
  const query = useInfiniteQuery({
    queryKey: ["restocking", "requests", scope, id, includeResolved, requestId],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        [scope]: id,
        includeResolved: includeResolved ? "1" : "0",
      });
      if (pageParam) params.set("cursor", pageParam);
      if (requestId) params.set("requestId", requestId);
      return fetchRestocking<RestockDetails>(params);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
    refetchInterval: 30000,
  });
  const first = query.data?.pages[0];
  const rows = [
    ...new Map(
      query.data?.pages.flatMap((p) => p.requests).map((r) => [r.id, r]) ?? [],
    ).values(),
  ];
  const focused = first?.focusedRequest;
  const propertyLinkId = jobPropertyId ?? rows[0]?.propertyId;
  async function move(row: RestockItem, status: RestockStatus) {
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/restock-requests/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not update request.");
      if (result.notificationStatus === "unavailable")
        toast.warning(
          `${row.item}: ${status}. The submitting cleaner is unavailable, so no alert was added.`,
        );
      else toast.success(`${row.item}: ${status}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update request.",
      );
    } finally {
      // Conflicts/unknown outcomes also need current server state.
      for (const key of [
        "restocking",
        "jobs",
        "job-oversight",
        "jobs-calendar",
      ])
        await qc.invalidateQueries({ queryKey: [key] });
      setBusyId(null);
    }
  }
  return (
    <section
      id={jobId ? "job-restocking" : "restocking"}
      aria-label={
        jobId
          ? "Restocking requests from this job"
          : "Property restocking requests"
      }
      className="min-w-0 rounded-lg border border-gray-200 bg-white p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {jobId ? "Restocking from this job" : "Restocking requests"}
            {first ? ` · ${first.openCount} open` : ""}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {jobId
              ? "Supply requests submitted during this visit."
              : "All visits at this property. Dates are Eastern."}
          </p>
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(e) => setIncludeResolved(e.target.checked)}
            className="accent-teal-700"
          />
          Include fulfilled and declined
        </label>
      </div>
      {jobId && propertyLinkId && (
        <p className="mt-3 text-sm">
          <Link
            href={restockPropertyUrl(propertyLinkId) as Route}
            className={restockLink}
          >
            All requests at this property
          </Link>
        </p>
      )}
      {query.isPending ? (
        <p role="status" className="py-5 text-sm text-gray-500">
          Loading requests…
        </p>
      ) : query.isError ? (
        <div role="alert" className="py-5 text-sm text-red-700">
          Could not load requests.{" "}
          <button
            type="button"
            onClick={() => query.refetch()}
            className={restockLink}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {requestId && !focused && (
            <p className="mt-4 text-sm text-gray-600">
              The selected request is unavailable at this property.
            </p>
          )}
          <ul className="divide-y divide-gray-200">
            {focused && !rows.some((r) => r.id === focused.id) && (
              <RequestRow
                row={focused}
                focused
                onMove={move}
                busy={busyId === focused.id}
              />
            )}
            {rows.map((row) => (
              <RequestRow
                key={row.id}
                row={row}
                focused={row.id === requestId}
                onMove={move}
                busy={busyId === row.id}
              />
            ))}
          </ul>
          {!rows.length && !focused && (
            <p className="py-5 text-sm text-gray-500">
              {first?.totalCount
                ? "No open requests. Include fulfilled and declined to view history."
                : "No restocking requests yet."}
            </p>
          )}
          {query.hasNextPage && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
              className={`mt-4 min-h-10 rounded-md border border-gray-300 px-4 text-sm disabled:opacity-50 ${restockFocus}`}
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more requests"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
export function PropertyRestockingSummary({
  propertyId,
}: {
  propertyId: string;
}) {
  const query = useQuery({
    queryKey: ["restocking", "property-summary", propertyId],
    queryFn: () =>
      fetchRestocking<Pick<RestockDetails, "openCount" | "totalCount">>(
        new URLSearchParams({ propertyId, countsOnly: "1" }),
      ),
    staleTime: 0,
    refetchInterval: 30000,
  });
  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-5"
      aria-label="Property restocking"
    >
      <h2 className="font-semibold text-gray-900">Restocking</h2>
      <p role="status" className="my-2 text-sm text-gray-600">
        {query.data
          ? `${query.data.openCount} open · ${query.data.totalCount} total requests`
          : query.isError
            ? "Count unavailable"
            : "Loading count…"}
      </p>
      <Link
        href={restockPropertyUrl(propertyId) as Route}
        className={`text-sm ${restockLink}`}
      >
        Open property requests
      </Link>
    </section>
  );
}
