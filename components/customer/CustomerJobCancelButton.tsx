"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type CustomerJobCancelButtonProps = {
  jobId: string;
  status: string | null;
  checkInTime: string | null;
};

export function CustomerJobCancelButton({
  jobId,
  status,
  checkInTime,
}: CustomerJobCancelButtonProps) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canShow =
    checkInTime &&
    new Date(checkInTime) > new Date() &&
    (status === "unassigned" || status === "assigned");

  if (!canShow) return null;

  async function handleCancel() {
    const confirmed = window.confirm(
      "Cancel this clean? If a cleaner is already assigned and it is less than 24 hours before check-in, you may still be charged and the cleaner will be paid."
    );
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/customer/jobs/${jobId}/cancel`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Cancel failed");
      }
      setMessage(data.message ?? "Clean canceled");
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["jobs", "stats"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleCancel}
        disabled={loading}
        className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
      >
        {loading ? "Canceling…" : "Cancel clean"}
      </button>
      {message && <span className="max-w-xs text-right text-xs text-green-700">{message}</span>}
      {error && <span className="max-w-xs text-right text-xs text-red-600">{error}</span>}
    </div>
  );
}
