"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SchedulePlan } from "@/lib/jobs/property-schedule";

type Preview = SchedulePlan & { token: string };
const when = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  });

export function PropertyScheduleSync({
  propertyId,
  disabled,
}: {
  propertyId: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(action: "preview" | "apply") {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/properties/${propertyId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "apply" ? { token: preview?.token } : {}),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          result.error ?? "Could not check booking times. Please try again.",
        );
      if (action === "preview") setPreview(result);
      else {
        setPreview(null);
        setMessage(
          `Updated ${result.updatedBookings} upcoming booking${result.updatedBookings === 1 ? "" : "s"}.`,
        );
        router.refresh();
      }
    } catch (failure) {
      setPreview(null);
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not update booking times.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="mt-5 border-t border-gray-200 pt-4 text-sm">
      <p className="font-medium text-gray-800">Previously listed bookings</p>
      <p className="mt-1 text-gray-600">
        Check older upcoming bookings against the home&apos;s saved times. Save
        any changes above first.
      </p>
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => void run("preview")}
        className="mt-3 min-h-11 rounded-md border border-teal-600 px-3 py-2 font-medium text-teal-700 disabled:opacity-50"
      >
        {busy === "preview" ? "Checking…" : "Preview booking time updates"}
      </button>
      {preview && (
        <div className="mt-3 space-y-3" aria-live="polite">
          <p>
            {preview.changes.length} booking
            {preview.changes.length === 1 ? "" : "s"} will change.{" "}
            {preview.preserved.length} will keep their schedules.
          </p>
          {preview.changes.length > 0 && (
            <>
              <ul className="max-h-72 space-y-3 overflow-y-auto">
                {preview.changes.map((change) => (
                  <li key={change.jobId} className="rounded-md bg-gray-50 p-3">
                    <span className="font-medium">
                      Booking on{" "}
                      {new Date(change.start).toLocaleDateString("en-US", {
                        dateStyle: "medium",
                        timeZone: "America/New_York",
                      })}
                    </span>
                    <p className="mt-1">
                      Start: {when(change.beforeStart)} → {when(change.start)}{" "}
                      ET
                    </p>
                    <p>
                      Finish by: {when(change.beforeDeadline)} →{" "}
                      {when(change.deadline)} ET
                    </p>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy !== null || disabled}
                onClick={() => void run("apply")}
                className="min-h-11 rounded-md bg-teal-600 px-3 py-2 font-semibold text-white disabled:opacity-50"
              >
                {busy === "apply"
                  ? "Updating…"
                  : `Update ${preview.changes.length} booking${preview.changes.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="mt-3 text-green-700">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
