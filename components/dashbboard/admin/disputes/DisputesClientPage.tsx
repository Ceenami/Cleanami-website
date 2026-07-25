"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdminDispute } from "@/lib/queries/disputes";

const TYPE_LABELS: Record<AdminDispute["type"], string> = {
  pay: "Pay",
  reliability_score: "Reliability Score",
  job_assignment: "Job Assignment",
};

const STATUS_STYLES: Record<AdminDispute["status"], string> = {
  pending: "bg-yellow-100 text-yellow-800",
  resolved: "bg-green-100 text-green-800",
  denied: "bg-red-100 text-red-800",
};

async function fetchDisputes(): Promise<AdminDispute[]> {
  const res = await fetch("/api/disputes");
  if (!res.ok) throw new Error("Failed to load disputes");
  const body = (await res.json()) as { disputes: AdminDispute[] };
  return body.disputes;
}

export function DisputesClientPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["disputes"],
    queryFn: fetchDisputes,
  });

  const mutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "resolved" | "denied";
    }) => {
      const res = await fetch(`/api/disputes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Failed to update dispute");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["disputes"] });
    },
  });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Disputes &amp; Refunds</h2>

      {isLoading && <p className="text-sm text-gray-500">Loading disputes…</p>}
      {isError && (
        <p className="text-sm text-red-600">Failed to load disputes.</p>
      )}
      {!isLoading && !isError && data && data.length === 0 && (
        <p className="text-sm text-gray-500">No disputes have been filed.</p>
      )}

      <div className="space-y-2">
        {data?.map((d) => (
          <div
            key={d.id}
            className="flex items-start justify-between gap-4 rounded border border-gray-200 p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">
                  {d.cleanerName ?? "Unknown cleaner"}
                </span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                  {TYPE_LABELS[d.type]}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[d.status]}`}
                >
                  {d.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-700">{d.description}</p>
              <p className="mt-1 text-xs text-gray-400">
                {new Date(d.createdAt).toLocaleString()}
              </p>
            </div>
            {d.status === "pending" && (
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() =>
                    mutation.mutate({ id: d.id, status: "resolved" })
                  }
                  disabled={mutation.isPending}
                  className="rounded bg-teal-600 px-3 py-1 text-sm font-medium text-white hover:bg-teal-700 disabled:bg-gray-400"
                >
                  Resolve
                </button>
                <button
                  onClick={() => mutation.mutate({ id: d.id, status: "denied" })}
                  disabled={mutation.isPending}
                  className="rounded border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Deny
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
