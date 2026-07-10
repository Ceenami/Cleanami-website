"use client";

import { useEffect, useRef, useState } from "react";
import { Loader } from "lucide-react";
import {
  formatDateRange,
  formatSubmissionSundayLabel,
} from "@/lib/cleaner/availability-deadline";
import { parseCleanerApiError } from "@/lib/cleaner/parse-api-error";
import { CleanerPageMessage } from "@/components/cleaner/CleanerPageMessage";
import { cn } from "@/lib/utils";

type AvailabilityDay = {
  date: string;
  label: string;
  isAvailable: boolean;
  onCallEligible: boolean;
  openPoolEligible: boolean;
};

type AvailabilityResponse = {
  period: { start: string; end: string; dates: string[] };
  days: AvailabilityDay[];
  displayMode: "submit" | "locked" | "override" | "preview";
  canLateOverride?: boolean;
  overrideMessage?: string | null;
  deadline: {
    pastDeadline: boolean;
    canSubmitRegular: boolean;
    canEditPreferences: boolean;
    closedReason: string | null;
    submissionSunday: string;
    nextSubmissionSunday: string;
  };
  closedMessage?: string | null;
};

export function AvailabilityPageClient() {
  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(
    null
  );
  const [displayMode, setDisplayMode] =
    useState<AvailabilityResponse["displayMode"]>("preview");
  const [deadline, setDeadline] = useState<AvailabilityResponse["deadline"] | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorVariant, setLoadErrorVariant] = useState<"warning" | "error">(
    "warning"
  );
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [canLateOverride, setCanLateOverride] = useState(false);
  const [overrideMessage, setOverrideMessage] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSaveRegular = deadline?.canSubmitRegular ?? false;
  const canSavePreferences = deadline?.canEditPreferences ?? false;
  const canSaveOverride = canLateOverride && displayMode === "override";
  const canSave = canSaveRegular || canSavePreferences || canSaveOverride;

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/cleaner/availability");
        const data = (await response.json()) as AvailabilityResponse & {
          error?: string;
        };
        if (!response.ok) {
          const parsed = parseCleanerApiError(response, data);
          setLoadError(parsed.message);
          setLoadErrorVariant(parsed.variant === "error" ? "error" : "warning");
          return;
        }
        setDays(data.days);
        setPeriod({ start: data.period.start, end: data.period.end });
        setDisplayMode(data.displayMode);
        setDeadline(data.deadline);
        setClosedMessage(data.closedMessage ?? null);
        setCanLateOverride(data.canLateOverride ?? false);
        setOverrideMessage(data.overrideMessage ?? null);
      } catch {
        setLoadError("Could not load availability. Please refresh and try again.");
        setLoadErrorVariant("error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function updateDay(
    date: string,
    patch: Partial<
      Pick<AvailabilityDay, "isAvailable" | "onCallEligible" | "openPoolEligible">
    >
  ) {
    setDays((prev) =>
      prev.map((day) => {
        if (day.date !== date) return day;
        const next = { ...day, ...patch };
        if (patch.isAvailable === false) {
          next.onCallEligible = false;
          next.openPoolEligible = false;
        }
        return next;
      })
    );
    setJustSaved(false);
    setSaveNotice(null);
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
  }

  async function handleSave() {
    if (saving || justSaved || !canSave) return;

    setSaving(true);
    setError(null);
    setJustSaved(false);
    setSaveNotice(null);

    const isPreferencesOnly =
      canSavePreferences && !canSaveRegular && !canSaveOverride;
    const isOverride = canSaveOverride;

    try {
      const response = await fetch("/api/cleaner/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isOverride
            ? {
                mode: "override",
                days: days.map((d) => ({
                  date: d.date,
                  isAvailable: d.isAvailable,
                  onCallEligible: d.onCallEligible,
                  openPoolEligible: d.openPoolEligible,
                })),
              }
            : isPreferencesOnly
            ? {
                mode: "preferences",
                preferences: days
                  .filter((d) => d.isAvailable)
                  .map((d) => ({
                    date: d.date,
                    onCallEligible: d.onCallEligible,
                    openPoolEligible: d.openPoolEligible,
                  })),
              }
            : {
                mode: "full",
                days: days.map((d) => ({
                  date: d.date,
                  isAvailable: d.isAvailable,
                  onCallEligible: d.onCallEligible,
                  openPoolEligible: d.openPoolEligible,
                })),
              }
        ),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Save failed");
      }

      if (data.message) {
        setSaveNotice(data.message);
      }

      if (isOverride) {
        const refresh = await fetch("/api/cleaner/availability");
        const refreshed = (await refresh.json()) as AvailabilityResponse;
        if (refresh.ok) {
          setDays(refreshed.days);
          setCanLateOverride(refreshed.canLateOverride ?? false);
          setOverrideMessage(refreshed.overrideMessage ?? null);
          setClosedMessage(refreshed.closedMessage ?? null);
          setDeadline(refreshed.deadline);
          setDisplayMode(refreshed.displayMode);
        }
      }

      setJustSaved(true);
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = setTimeout(() => {
        setJustSaved(false);
        savedTimerRef.current = null;
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (loadError) {
    return (
      <CleanerPageMessage
        title="Availability unavailable"
        message={loadError}
        variant={loadErrorVariant}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Availability</h1>
        <p className="text-sm text-gray-500">
          {period
            ? `2-week block: ${formatDateRange(period.start, period.end)}`
            : "Set your availability for the next two-week block"}
        </p>
        {canSaveRegular && (
          <p className="mt-1 text-sm text-gray-600">
            Submit every Sunday by{" "}
            {formatSubmissionSundayLabel(deadline!.submissionSunday)} at 6 PM ET.
          </p>
        )}
      </div>

      {overrideMessage && canSaveOverride && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          {overrideMessage}
        </div>
      )}

      {closedMessage && (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            displayMode === "locked"
              ? "border-indigo-200 bg-indigo-50 text-indigo-900"
              : "border-slate-200 bg-slate-50 text-slate-800"
          )}
        >
          {closedMessage}
        </div>
      )}

      {saveNotice && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {saveNotice}
        </div>
      )}

      <ul className="space-y-3">
        {days.map((day) => {
          const canEditDayPreferences =
            canSavePreferences && day.isAvailable && !canSaveRegular && !canSaveOverride;
          const canEditAvailable = canSaveRegular || canSaveOverride;
          const canEditPoolToggles =
            canSaveRegular || canSaveOverride || canEditDayPreferences;

          return (
            <li
              key={day.date}
              className="rounded-xl border bg-white p-4 shadow-sm"
            >
              <p className="mb-3 text-sm font-semibold text-gray-900">
                {day.label}
              </p>

              <div className="space-y-3">
                <label className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Available</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={day.isAvailable}
                    disabled={!canEditAvailable}
                    onClick={() =>
                      updateDay(day.date, { isAvailable: !day.isAvailable })
                    }
                    className={cn(
                      "relative h-6 w-11 rounded-full transition-colors",
                      day.isAvailable ? "bg-brand" : "bg-gray-300",
                      !canEditAvailable && "opacity-50"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                        day.isAvailable && "translate-x-5"
                      )}
                    />
                  </button>
                </label>

                {day.isAvailable && (
                  <>
                    <label className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">On-call</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={day.onCallEligible}
                        disabled={!canEditPoolToggles}
                        onClick={() =>
                          updateDay(day.date, {
                            onCallEligible: !day.onCallEligible,
                          })
                        }
                        className={cn(
                          "relative h-6 w-11 rounded-full transition-colors",
                          day.onCallEligible ? "bg-indigo-600" : "bg-gray-300",
                          !canEditPoolToggles && "opacity-50"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                            day.onCallEligible && "translate-x-5"
                          )}
                        />
                      </button>
                    </label>

                    <label className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Open Pool</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={day.openPoolEligible}
                        disabled={!canEditPoolToggles}
                        onClick={() =>
                          updateDay(day.date, {
                            openPoolEligible: !day.openPoolEligible,
                          })
                        }
                        className={cn(
                          "relative h-6 w-11 rounded-full transition-colors",
                          day.openPoolEligible ? "bg-teal-600" : "bg-gray-300",
                          !canEditPoolToggles && "opacity-50"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                            day.openPoolEligible && "translate-x-5"
                          )}
                        />
                      </button>
                    </label>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || justSaved || !canSave}
          className="min-w-40 flex-1 rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:px-8"
        >
          {saving
            ? "Saving…"
            : canSaveOverride
              ? "Save catch-up availability"
              : canSaveRegular
                ? "Save availability"
                : "Save preferences"}
        </button>
        {justSaved && (
          <span
            className="text-sm font-semibold text-green-700"
            role="status"
            aria-live="polite"
          >
            Saved ✓
          </span>
        )}
      </div>
    </div>
  );
}
