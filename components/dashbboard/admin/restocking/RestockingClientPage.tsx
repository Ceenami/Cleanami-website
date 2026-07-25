"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import type { RestockStatus, RestockUrgency } from "@/db/schemas";

export type RestockRow = {
  id: string;
  jobId: string | null;
  propertyId: string;
  propertyAddress: string | null;
  cleanerName: string | null;
  item: string;
  quantity: number;
  urgency: RestockUrgency;
  notes: string | null;
  status: RestockStatus;
  adminNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

const STATUS_STYLES: Record<RestockStatus, string> = {
  requested: "bg-blue-100 text-blue-800",
  approved: "bg-indigo-100 text-indigo-800",
  ordered: "bg-purple-100 text-purple-800",
  fulfilled: "bg-green-100 text-green-800",
  declined: "bg-gray-100 text-gray-700",
};

const URGENCY_STYLES: Record<RestockUrgency, string> = {
  low: "text-gray-500",
  normal: "text-gray-700",
  urgent: "text-red-600 font-semibold",
};

/** What an admin can do next from each state. */
const NEXT_ACTIONS: Record<RestockStatus, RestockStatus[]> = {
  requested: ["approved", "declined"],
  approved: ["ordered", "fulfilled", "declined"],
  ordered: ["fulfilled", "declined"],
  fulfilled: [],
  declined: ["requested"],
};

const ACTION_LABELS: Record<RestockStatus, string> = {
  requested: "Reopen",
  approved: "Approve",
  ordered: "Mark ordered",
  fulfilled: "Mark fulfilled",
  declined: "Decline",
};

export function RestockingClientPage({ requests }: { requests: RestockRow[] }) {
  const router = useRouter();
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      showResolved
        ? requests
        : requests.filter(
            (request) =>
              request.status !== "fulfilled" && request.status !== "declined"
          ),
    [requests, showResolved]
  );

  const openCount = requests.filter(
    (request) => request.status !== "fulfilled" && request.status !== "declined"
  ).length;

  async function move(row: RestockRow, status: RestockStatus) {
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/restock-requests/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not update that request.");
      }

      toast.success(`${row.item} → ${status}`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update that request."
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">
          {openCount} open{" "}
          <span className="text-sm font-normal text-gray-500">
            of {requests.length} total
          </span>
        </h2>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
          />
          Show fulfilled and declined
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow-md">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {["Item", "Property", "Requested by", "Status", "Actions"].map(
                (heading) => (
                  <th
                    key={heading}
                    className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                  >
                    {heading}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {visible.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-sm text-gray-500"
                >
                  {requests.length === 0
                    ? "No restock requests yet."
                    : "Nothing open — every request has been resolved."}
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <tr key={row.id}>
                <td className="px-6 py-4">
                  <div className="text-sm font-medium text-gray-900">
                    {row.quantity} × {row.item}
                  </div>
                  <div className={`text-xs ${URGENCY_STYLES[row.urgency]}`}>
                    {row.urgency} priority
                  </div>
                  {row.notes && (
                    <div className="mt-1 max-w-xs text-xs text-gray-500">
                      {row.notes}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-gray-700">
                  {row.propertyAddress ?? "—"}
                </td>
                <td className="px-6 py-4 text-sm text-gray-700">
                  <div>{row.cleanerName ?? "—"}</div>
                  <div className="text-xs text-gray-400">
                    {format(new Date(row.createdAt), "MMM d, yyyy h:mm a")}
                  </div>
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span
                    className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${STATUS_STYLES[row.status]}`}
                  >
                    {row.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm">
                  <div className="flex gap-3">
                    {NEXT_ACTIONS[row.status].map((next) => (
                      <button
                        key={next}
                        type="button"
                        onClick={() => void move(row, next)}
                        disabled={busyId === row.id}
                        className={`font-medium disabled:opacity-50 ${
                          next === "declined"
                            ? "text-red-600 hover:text-red-800"
                            : "text-teal-600 hover:text-teal-800"
                        }`}
                      >
                        {ACTION_LABELS[next]}
                      </button>
                    ))}
                    {NEXT_ACTIONS[row.status].length === 0 && (
                      <span className="text-xs text-gray-400">Closed</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
