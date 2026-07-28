"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type CustomerJobPromoCodeFieldProps = {
  jobId: string;
  status: string | null;
  checkInTime: string | null;
  paymentIntentId: string | null;
  paymentStatus: string | null;
  appliedPromoCode: string | null;
};

export function CustomerJobPromoCodeField({
  jobId,
  status,
  checkInTime,
  paymentIntentId,
  paymentStatus,
  appliedPromoCode,
}: CustomerJobPromoCodeFieldProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Only an upcoming clean that hasn't been pre-authorized (or failed
  // pre-authorization — that state is never retried, so it must not be
  // treated as still open) is eligible for a promo-code change.
  const canShow =
    checkInTime &&
    new Date(checkInTime) > new Date() &&
    (status === "unassigned" || status === "assigned") &&
    paymentIntentId === null &&
    paymentStatus === null;

  if (!canShow) return null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["jobs"] });
  }

  async function handleApply() {
    const trimmed = code.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/customer/jobs/${jobId}/promo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not apply that promo code.");
      }
      setMessage(`${data.code} applied to this clean`);
      setEditing(false);
      setCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply that promo code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove() {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/customer/jobs/${jobId}/promo`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Could not remove that promo code.");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that promo code.");
    } finally {
      setLoading(false);
    }
  }

  if (appliedPromoCode) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-teal-700">
            {appliedPromoCode} applied
          </span>
          <button
            type="button"
            onClick={handleRemove}
            disabled={loading}
            className="text-red-600 hover:text-red-800 disabled:opacity-50"
          >
            {loading ? "Removing…" : "Remove"}
          </button>
        </div>
        {error && <span className="max-w-xs text-right text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-teal-600 hover:text-teal-800"
        >
          Have a promo code?
        </button>
        {message && <span className="max-w-xs text-right text-xs text-green-700">{message}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <input
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleApply();
            }
          }}
          placeholder="CODE"
          autoComplete="off"
          spellCheck={false}
          className="w-24 rounded border border-gray-300 px-2 py-1 text-xs uppercase tracking-wide text-gray-800 placeholder:normal-case focus:border-teal-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={loading || !code.trim()}
          className="rounded bg-gray-800 px-2 py-1 text-xs font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading ? "…" : "Apply"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setCode("");
            setError(null);
          }}
          disabled={loading}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
      {error && <span className="max-w-xs text-right text-xs text-red-600">{error}</span>}
    </div>
  );
}
