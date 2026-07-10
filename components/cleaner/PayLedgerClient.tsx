"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader } from "lucide-react";
import { PayBreakdown } from "@/components/cleaner/PayBreakdown";
import { CleanerPageMessage } from "@/components/cleaner/CleanerPageMessage";
import type { CleanerPayoutRow } from "@/lib/queries/cleaner-payouts";
import { parseCleanerApiError } from "@/lib/cleaner/parse-api-error";
import { cn } from "@/lib/utils";

const statusChip: Record<
  CleanerPayoutRow["status"],
  { label: string; className: string }
> = {
  released: { label: "Paid", className: "bg-green-100 text-green-800" },
  held: { label: "On Hold", className: "bg-yellow-100 text-yellow-900" },
  pending: { label: "Pending", className: "bg-slate-100 text-slate-700" },
};

export function PayLedgerClient() {
  const [payouts, setPayouts] = useState<CleanerPayoutRow[]>([]);
  const [totalEarnedThisMonth, setTotalEarnedThisMonth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorVariant, setErrorVariant] = useState<"warning" | "error">(
    "warning"
  );

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/cleaner/payouts");
        const data = (await response.json()) as {
          payouts?: CleanerPayoutRow[];
          totalEarnedThisMonth?: number;
          error?: string;
        };
        if (!response.ok) {
          const parsed = parseCleanerApiError(response, data);
          setError(parsed.message);
          setErrorVariant(parsed.variant === "error" ? "error" : "warning");
          return;
        }
        setPayouts(data.payouts ?? []);
        setTotalEarnedThisMonth(data.totalEarnedThisMonth ?? 0);
      } catch {
        setError("Could not load payout history. Please refresh and try again.");
        setErrorVariant("error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (error) {
    return (
      <CleanerPageMessage
        title="Pay unavailable"
        message={error}
        variant={errorVariant}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Pay</h1>
        <p className="text-sm text-gray-500">Your payout history</p>
      </div>

      <div className="rounded-xl border border-brand/20 bg-brand/5 p-4">
        <p className="text-sm text-gray-600">Total earned this month</p>
        <p className="text-2xl font-bold text-brand">
          ${totalEarnedThisMonth.toFixed(2)}
        </p>
      </div>

      {payouts.length === 0 ? (
        <CleanerPageMessage
          title="No payouts yet"
          message="Complete assigned jobs and submit evidence to see earnings and payout status here."
          variant="empty"
        />
      ) : (
        <ul className="space-y-4">
          {payouts.map((payout) => {
            const chip = statusChip[payout.status];

            return (
              <li
                key={payout.id}
                className="rounded-xl border bg-white p-4 shadow-sm"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {payout.propertyAddress ?? "Unknown property"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {payout.jobDate ?? "Date TBD"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      chip.className
                    )}
                  >
                    {chip.label}
                  </span>
                </div>

                {payout.status === "held" && payout.holdReason && (
                  <p className="mb-3 text-xs text-yellow-800">
                    {payout.holdReason}
                  </p>
                )}

                <PayBreakdown payout={payout.payBreakdown} className="border-0 p-0 shadow-none" />

                <Link
                  href={`/cleaner/jobs/${payout.jobId}`}
                  className="mt-3 inline-block text-xs font-medium text-brand hover:underline"
                >
                  View job
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
