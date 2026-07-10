'use client';

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { SearchBar } from "../ui/SearchBar";

interface SwapRequestRow {
  id: string;
  jobId: string;
  status: string;
  requestedAt: string;
  expiresAt: string;
  originalCleanerName: string;
  replacementCleanerName?: string | null;
  propertyAddress?: string | null;
}

async function fetchSwapRequests(query: string) {
  const params = new URLSearchParams({ status: "pending" });

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

  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  const { data, status, error, refetch } = useQuery({
    queryKey: ["swapRequests", searchTerm],
    queryFn: () => fetchSwapRequests(searchTerm),
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
        outcome?: "backup_promoted" | "awaiting_accept" | "removed_from_job";
        replacementCleanerName?: string;
        notifiedCount?: number;
      }>;
    },
    onSuccess: (data, variables) => {
      setActiveRequestId(null);
      if (variables.action === "accept") {
        if (data.outcome === "backup_promoted" && data.replacementCleanerName) {
          toast.success(
            `Swap approved. ${data.replacementCleanerName} was promoted to primary.`
          );
        } else if (data.outcome === "awaiting_accept") {
          toast.success(
            `Swap approved. ${data.notifiedCount ?? 0} cleaner(s) notified — first to accept gets the job.`
          );
        } else if (data.outcome === "removed_from_job") {
          toast.success(
            "Swap approved. The requesting cleaner was removed from the job."
          );
        } else {
          toast.success("Swap approved.");
        }
      } else if (variables.action === "deny") {
        toast.success("Swap request denied.");
      }
      refetch();
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
          <p className="text-sm text-gray-500">
            Approve to release the cleaner and notify eligible replacements (first accept wins), or deny to keep the current assignment.
          </p>
        </div>

        <SearchBar onSearch={setSearchTerm} placeholder="Search by property, cleaner, or job ID..." />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">From Cleaner</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Replacement</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Requested</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {status === "pending" ? (
                <tr>
                  <td colSpan={7} className="px-6 py-6 text-center text-gray-500">Loading swap requests...</td>
                </tr>
              ) : status === "error" ? (
                <tr>
                  <td colSpan={7} className="px-6 py-6 text-center text-red-500">{(error as Error)?.message ?? "Failed to load swap requests."}</td>
                </tr>
              ) : swapRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-6 text-center text-gray-500">No pending swap requests found.</td>
                </tr>
              ) : (
                swapRequests.map((request: SwapRequestRow) => (
                  <tr key={request.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{request.jobId}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.propertyAddress ?? "Unknown"}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{request.originalCleanerName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {request.replacementCleanerName ?? "First accept / backup"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(request.requestedAt).toLocaleString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{request.status}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
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
