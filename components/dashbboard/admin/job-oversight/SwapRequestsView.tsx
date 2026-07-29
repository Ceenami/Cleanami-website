'use client';

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SearchBar } from "../ui/SearchBar";

interface SwapRequestRow {
  id: string;
  jobId: string;
  status: string;
  requestedAt: string;
  expiresAt: string;
  reason?: string | null;
  scheduledAt?: string | null;
  originalCleanerName: string;
  replacementCleanerName?: string | null;
  propertyAddress?: string | null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Unscheduled";

  return new Date(value).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: "Open", className: "bg-amber-100 text-amber-800" },
  accepted: { label: "Covered", className: "bg-green-100 text-green-800" },
  urgent: { label: "Replacement open", className: "bg-orange-100 text-orange-800" },
  expired: { label: "Expired uncovered", className: "bg-red-100 text-red-800" },
  cancelled: { label: "Closed", className: "bg-gray-100 text-gray-600" },
};

async function fetchSwapRequests(query: string, showHistory: boolean) {
  const params = new URLSearchParams({
    status: showHistory ? "all" : "pending",
  });

  if (query.trim()) {
    params.append("query", query.trim());
  }

  const response = await fetch(`/api/swap-requests?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to load swap requests");
  }

  return response.json() as Promise<SwapRequestRow[]>;
}

export const SwapRequestsView = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, status, error, refetch } = useQuery({
    queryKey: ["swapRequests", searchTerm, showHistory],
    queryFn: () => fetchSwapRequests(searchTerm, showHistory),
  });

  const mutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "accept" | "deny" }) => {
      const response = await fetch(`/api/swap-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || "Failed to update swap request");
      }

      return response.json() as Promise<{
        success: boolean;
        outcome?: "backup_promoted" | "released_to_pool";
        replacementCleanerName?: string;
        notifiedCount?: number;
      }>;
    },
    onSuccess: (data, variables) => {
      setActiveRequestId(null);
      if (variables.action === "accept") {
        if (data.outcome === "backup_promoted" && data.replacementCleanerName) {
          toast.success(
            `Swap forced through. ${data.replacementCleanerName} moved from backup onto the job.`
          );
        } else if (data.outcome === "released_to_pool") {
          toast.success(
            `Cleaner released. ${data.notifiedCount ?? 0} cleaner(s) notified — first to accept gets the job.`
          );
        } else {
          toast.success("Swap approved.");
        }
      } else if (variables.action === "deny") {
        toast.success("Swap revoked. The cleaner stays on the job.");
      }
      refetch();
      // Keeps the tab's pending badge in step with the table.
      queryClient.invalidateQueries({ queryKey: ["swapRequests"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update swap request");
    },
  });

  const swapRequests = useMemo(() => data ?? [], [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Swap Requests</h2>
          <p className="max-w-3xl text-sm text-gray-500">
            Eligible cleaners are notified the moment a swap is raised and the
            first to accept takes over — no action is needed here for the normal
            case. Override it if you need to: <strong>Approve</strong> takes the
            cleaner off now (promoting the backup, or opening the job to the
            wider replacement pool), <strong>Deny</strong> revokes the request
            and keeps them assigned.
          </p>
        </div>

        <div className="flex flex-col gap-2 md:items-end">
          <SearchBar onSearch={setSearchTerm} placeholder="Search by property, cleaner, or job ID..." />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showHistory}
              onChange={(e) => setShowHistory(e.target.checked)}
              className="h-4 w-4 accent-teal-600"
            />
            Show resolved requests
          </label>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Clean</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">From Cleaner</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Replacement</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Requested</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {status === "pending" ? (
                <tr>
                  <td colSpan={8} className="px-6 py-6 text-center text-gray-500">Loading swap requests...</td>
                </tr>
              ) : status === "error" ? (
                <tr>
                  <td colSpan={8} className="px-6 py-6 text-center text-red-500">{(error as Error)?.message ?? "Failed to load swap requests."}</td>
                </tr>
              ) : swapRequests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-6 text-center text-gray-500">
                    {showHistory
                      ? "No swap requests on record."
                      : "No open swap requests."}
                  </td>
                </tr>
              ) : (
                swapRequests.map((request: SwapRequestRow) => (
                  <tr key={request.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      <Link
                        href={`/admin/job-oversight/${request.jobId}` as Route}
                        className="text-teal-600 hover:text-teal-900"
                      >
                        {formatDateTime(request.scheduledAt)}
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.propertyAddress ?? "Unknown"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.originalCleanerName}</td>
                    <td className="min-w-[14rem] max-w-sm px-6 py-4 text-sm text-gray-500">
                      {request.reason?.trim() ? request.reason : <span className="text-gray-400">Not given</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {request.replacementCleanerName ?? "First accept / backup"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(request.requestedAt).toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          STATUS_LABELS[request.status]?.className ??
                          "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {STATUS_LABELS[request.status]?.label ?? request.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      {request.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveRequestId(request.id);
                              mutation.mutate({ id: request.id, action: "accept" });
                            }}
                            disabled={mutation.isPending && activeRequestId === request.id}
                            className="rounded-md bg-teal-600 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveRequestId(request.id);
                              mutation.mutate({ id: request.id, action: "deny" });
                            }}
                            disabled={mutation.isPending && activeRequestId === request.id}
                            className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            Deny
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">Resolved</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
