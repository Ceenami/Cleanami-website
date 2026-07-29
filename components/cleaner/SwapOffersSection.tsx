"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader } from "lucide-react";
import { toast } from "sonner";

type SwapOffer = {
  swapRequestId: string;
  jobId: string;
  propertyAddress: string | null;
  checkInTime: string | null;
  originalCleanerName: string;
  reason: string | null;
};

const REFRESH_INTERVAL_MS = 30_000;

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

function firstName(fullName: string) {
  return fullName.split(" ")[0] ?? fullName;
}

/**
 * Cleans another cleaner has asked to hand off. First to accept takes the job,
 * so the list refreshes on a timer and whenever the tab regains focus.
 */
export function SwapOffersSection({ onAccepted }: { onAccepted?: () => void }) {
  const [offers, setOffers] = useState<SwapOffer[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const loadOffers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);

    try {
      const response = await fetch("/api/cleaner/swap-offers");
      const data = (await response.json()) as { offers?: SwapOffer[] };
      if (!response.ok) return;
      setOffers(data.offers ?? []);
    } catch {
      // Leave the last good list on screen rather than blanking the section.
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOffers(false);
    const interval = setInterval(() => loadOffers(true), REFRESH_INTERVAL_MS);

    function onFocus() {
      loadOffers(true);
    }
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadOffers]);

  async function handleAccept(offer: SwapOffer) {
    setAcceptingId(offer.swapRequestId);
    try {
      const response = await fetch(
        `/api/cleaner/swap-offers/${offer.swapRequestId}`,
        { method: "POST" }
      );
      const data = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        toast.error(data.error ?? "Could not take this clean");
        setOffers((prev) =>
          prev.filter((o) => o.swapRequestId !== offer.swapRequestId)
        );
        await loadOffers(true);
        return;
      }

      toast.success(data.message ?? "Swap accepted");
      setOffers((prev) =>
        prev.filter((o) => o.swapRequestId !== offer.swapRequestId)
      );
      onAccepted?.();
    } catch {
      toast.error("Could not take this clean");
    } finally {
      setAcceptingId(null);
    }
  }

  if (initialLoading || offers.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-teal-900">
            Cleans available to cover
          </h3>
          <p className="text-xs text-teal-800">
            Another cleaner asked to hand these off. First to accept takes the
            job.
          </p>
        </div>
        {refreshing && (
          <Loader className="h-4 w-4 shrink-0 animate-spin text-teal-700" />
        )}
      </div>

      <ul className="space-y-3">
        {offers.map((offer) => (
          <li
            key={offer.swapRequestId}
            className="rounded-lg border border-teal-200 bg-white p-3"
          >
            <p className="text-sm font-medium text-gray-900">
              {offer.propertyAddress ?? "Property address pending"}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {formatCheckIn(offer.checkInTime)} · from{" "}
              {firstName(offer.originalCleanerName)}
            </p>
            {offer.reason && (
              <p className="mt-1 text-xs italic text-gray-500">
                &ldquo;{offer.reason}&rdquo;
              </p>
            )}
            <button
              type="button"
              onClick={() => handleAccept(offer)}
              disabled={acceptingId === offer.swapRequestId}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {acceptingId === offer.swapRequestId && (
                <Loader className="h-4 w-4 animate-spin" />
              )}
              {acceptingId === offer.swapRequestId
                ? "Accepting…"
                : "Take this clean"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
