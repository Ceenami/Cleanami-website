"use client";
import { useQuery } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";

type Request = {
  id: string;
  propertyAddress: string | null;
  item: string;
  quantity: number;
  urgency: string;
  status: string;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
};
export function RestockRequestsClient({ requestId }: { requestId?: string }) {
  const query = useQuery<{ requests: Request[] }>({
    queryKey: ["cleaner-restock-requests"],
    queryFn: async () => {
      const response = await fetch("/api/cleaner/restock-requests", {
        cache: "no-store",
      });
      if (!response.ok) throw Error("Could not load your supply requests.");
      return response.json();
    },
    staleTime: 0,
    refetchInterval: 30000,
  });
  const rows = query.data?.requests ?? [];
  const focused = rows.find((row) => row.id === requestId);
  const ordered = focused
    ? [focused, ...rows.filter((row) => row.id !== focused.id)]
    : rows;
  return (
    <div className="space-y-4 p-4">
      <Link
        href="/cleaner/jobs"
        className="text-sm font-medium text-brand hover:underline"
      >
        ← My jobs
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          My supply requests
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Track office updates on the restocking requests you submitted.
        </p>
      </div>
      {query.isPending ? (
        <p role="status">Loading requests…</p>
      ) : query.isError ? (
        <p role="alert">
          Could not load requests.{" "}
          <button
            type="button"
            onClick={() => query.refetch()}
            className="font-medium text-brand underline"
          >
            Try again
          </button>
        </p>
      ) : (
        <>
          {requestId && !focused && (
            <p className="text-sm text-gray-600">
              This request is no longer available in your account.
            </p>
          )}
          {!rows.length && (
            <p className="text-sm text-gray-600">
              No supply requests yet. You can submit one from a job.
            </p>
          )}
          <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white px-4">
            {ordered.map((row) => (
              <li
                key={row.id}
                className={`py-4 ${row.id === requestId ? "border-l-4 border-teal-600 pl-3" : ""}`}
              >
                {row.id === requestId && (
                  <p className="mb-1 text-xs font-medium text-teal-800">
                    Selected request
                  </p>
                )}
                <h2 className="break-words font-semibold text-gray-900">
                  {row.quantity} × {row.item}
                </h2>
                <p className="mt-1 text-sm font-medium capitalize text-teal-800">
                  {row.status === "requested"
                    ? "Awaiting office review"
                    : row.status}
                </p>
                <p className="mt-1 break-words text-sm text-gray-600">
                  {row.propertyAddress ?? "Property unavailable"}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {row.urgency} priority ·{" "}
                  {formatInTimeZone(
                    row.createdAt,
                    "America/New_York",
                    "MMM d, yyyy h:mm a zzz",
                  )}
                </p>
                {row.notes && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-700">
                    {row.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
