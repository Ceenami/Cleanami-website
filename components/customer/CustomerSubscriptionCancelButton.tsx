"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SubscriptionsWithDetails } from "@/lib/queries/subscriptions";

type CustomerSubscriptionCancelButtonProps = {
  subscription: SubscriptionsWithDetails["data"][number];
};

export function CustomerSubscriptionCancelButton({
  subscription,
}: CustomerSubscriptionCancelButtonProps) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (subscription.status !== "active") return null;

  const start = new Date(subscription.startDate);
  const firstMonthEnd = new Date(start);
  firstMonthEnd.setMonth(firstMonthEnd.getMonth() + 1);
  const inFirstMonth = new Date() < firstMonthEnd;

  async function handleCancel() {
    const confirmed = window.confirm(
      inFirstMonth
        ? "Subscriptions cannot be canceled during the first month. Cancel individual cleans from your dashboard instead."
        : "Cancel this subscription? Upcoming scheduled cleans will be canceled too."
    );
    if (!confirmed || inFirstMonth) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/customer/subscriptions/${subscription.id}/cancel`,
        { method: "POST" }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Cancel failed");
      }
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      alert(data.message ?? "Subscription canceled");
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
        disabled={loading || inFirstMonth}
        className="text-sm font-medium text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40"
        title={
          inFirstMonth
            ? "First month is a minimum commitment"
            : "Cancel subscription"
        }
      >
        {loading ? "Canceling…" : "Cancel subscription"}
      </button>
      {inFirstMonth && (
        <span className="text-xs text-gray-500">First-month minimum</span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
