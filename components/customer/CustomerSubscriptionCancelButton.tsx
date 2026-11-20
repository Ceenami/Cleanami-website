"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SubscriptionsWithDetails } from "@/lib/queries/subscriptions";
import { canCancelSubscription } from "@/lib/cancellation/rules";
import { subscriptionMinimumLabel } from "@/lib/subscriptions/minimum";

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

  const eligibility = canCancelSubscription(subscription);
  const inMinimum = !eligibility.allowed;
  const minimumLabel = subscriptionMinimumLabel(subscription.cancellationMinimum);

  async function handleCancel() {
    const confirmed = window.confirm(
      inMinimum
        ? eligibility.reason ?? "Your minimum commitment has not ended."
        : "Cancel this subscription? Upcoming scheduled cleans will be canceled too."
    );
    if (!confirmed || inMinimum) return;

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
        disabled={loading || inMinimum}
        className="text-sm font-medium text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40"
        title={
          inMinimum
            ? minimumLabel
            : "Cancel subscription"
        }
      >
        {loading ? "Canceling…" : "Cancel subscription"}
      </button>
      {inMinimum && (
        <span className="text-xs text-gray-500">{minimumLabel}</span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
