"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader } from "lucide-react";
import { toast } from "sonner";

type UrgentJobOffer = {
  jobId: string;
  propertyAddress: string | null;
  checkInTime: string | null;
  canAccept: boolean;
};

function formatCheckIn(iso: string | null) {
  if (!iso) return "Time TBD";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

export function UrgentJobsSection() {
  const [offers, setOffers] = useState<UrgentJobOffer[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const loadOffers = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setInitialLoading(true);
    }

    try {
      const response = await fetch("/api/cleaner/urgent-jobs");
      const data = (await response.json()) as {
        offers?: UrgentJobOffer[];
        error?: string;
      };

      if (!response.ok) {
        return;
      }

      setOffers(data.offers ?? []);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOffers(false);
    const interval = setInterval(() => loadOffers(true), 30_000);

    function onFocus() {
      loadOffers(true);
    }
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadOffers]);

  async function handleAccept(jobId: string) {
    setAcceptingId(jobId);
    try {
      const response = await fetch(`/api/cleaner/jobs/${jobId}/accept-urgent`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        toast.error(data.error ?? "Could not accept this job");
        setOffers((prev) => prev.filter((o) => o.jobId !== jobId));
        await loadOffers(true);
        return;
      }

      toast.success(data.message ?? "Urgent job accepted");
      setOffers((prev) => prev.filter((o) => o.jobId !== jobId));
    } catch {
      toast.error("Could not accept this job");
    } finally {
      setAcceptingId(null);
    }
  }

  if (initialLoading) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
        <Loader className="h-4 w-4 animate-spin" />
        Checking for urgent jobs…
      </section>
    );
  }

  if (offers.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-orange-900">
            Urgent jobs available
          </h3>
          <p className="text-xs text-orange-800">
            First to accept gets the job. Includes a $10 bonus.
          </p>
        </div>
        {refreshing && (
          <Loader className="h-4 w-4 shrink-0 animate-spin text-orange-700" />
        )}
      </div>
      <ul className="space-y-3">
        {offers.map((offer) => (
          <li
            key={offer.jobId}
            className="rounded-lg border border-orange-200 bg-white p-3"
          >
            <p className="text-sm font-medium text-gray-900">
              {offer.propertyAddress ?? "Property address pending"}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {formatCheckIn(offer.checkInTime)}
            </p>
            <button
              type="button"
              onClick={() => handleAccept(offer.jobId)}
              disabled={acceptingId === offer.jobId}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {acceptingId === offer.jobId && (
                <Loader className="h-4 w-4 animate-spin" />
              )}
              {acceptingId === offer.jobId ? "Accepting…" : "Accept urgent job"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
