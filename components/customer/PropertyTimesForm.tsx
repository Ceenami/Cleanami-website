"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { Card } from "@/components/dashbboard/admin/properties/Card";
import { PropertyScheduleSync } from "@/components/dashbboard/admin/properties/PropertyScheduleSync";

type Props = {
  propertyId: string;
  defaultCheckOutTime: string | null;
  defaultCheckInTime: string | null;
  updatedAt: string;
};
const clock = (value: string) => (value.length === 5 ? `${value}:00` : value);

export function PropertyTimesForm({
  propertyId,
  defaultCheckOutTime,
  defaultCheckInTime,
  updatedAt,
}: Props) {
  const router = useRouter();
  const id = useId();
  const [checkOut, setCheckOut] = useState(defaultCheckOutTime ?? "09:00:00");
  const [checkIn, setCheckIn] = useState(defaultCheckInTime ?? "16:00:00");
  const [version, setVersion] = useState(updatedAt);
  const [savedTimes, setSavedTimes] = useState({
    checkOut: defaultCheckOutTime ?? "09:00:00",
    checkIn: defaultCheckInTime ?? "16:00:00",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  useEffect(() => {
    setCheckOut(defaultCheckOutTime ?? "09:00:00");
    setCheckIn(defaultCheckInTime ?? "16:00:00");
    setVersion(updatedAt);
    setSavedTimes({
      checkOut: defaultCheckOutTime ?? "09:00:00",
      checkIn: defaultCheckInTime ?? "16:00:00",
    });
  }, [propertyId, defaultCheckOutTime, defaultCheckInTime, updatedAt]);
  const dirty =
    clock(checkOut) !== clock(savedTimes.checkOut) ||
    clock(checkIn) !== clock(savedTimes.checkIn);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/properties/${propertyId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultCheckOutTime: checkOut,
          defaultCheckInTime: checkIn,
          expectedUpdatedAt: version,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          result.error ?? "Could not save property times. Please try again.",
        );
      setVersion(result.updatedAt);
      setSavedTimes({ checkOut, checkIn });
      const count = result.updatedBookings;
      setSuccess(
        `Times saved. ${count} upcoming clean${count === 1 ? "" : "s"} updated.${result.preservedBookings ? ` ${result.preservedBookings} kept their schedules.` : ""}`,
      );
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save property times.",
      );
    } finally {
      setSaving(false);
    }
  }
  const inputClass =
    "mt-1 block min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-teal-500";
  return (
    <Card icon={<Clock />} title="Guest check-in and check-out times">
      <p className="text-sm text-gray-600">
        All times are Eastern. Changes also update upcoming cleans that use your
        home&apos;s default times.
      </p>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`${id}-checkout`}
              className="block text-sm font-medium text-gray-700"
            >
              Guest check-out
            </label>
            <input
              id={`${id}-checkout`}
              type="time"
              step="1"
              required
              disabled={saving}
              value={checkOut}
              onChange={(event) => setCheckOut(event.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-sm text-gray-500">
              Cleaning starts at this time.
            </p>
          </div>
          <div>
            <label
              htmlFor={`${id}-checkin`}
              className="block text-sm font-medium text-gray-700"
            >
              Guest check-in
            </label>
            <input
              id={`${id}-checkin`}
              type="time"
              step="1"
              required
              disabled={saving}
              value={checkIn}
              onChange={(event) => setCheckIn(event.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-sm text-gray-500">
              Cleaning must finish by this time.
            </p>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm text-green-700">
            {success}
          </p>
        )}
        <button
          type="submit"
          disabled={saving || !dirty}
          className="min-h-11 w-full rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {saving ? "Saving..." : "Save times"}
        </button>
      </form>
      <PropertyScheduleSync
        key={`${propertyId}:${defaultCheckOutTime}:${defaultCheckInTime}`}
        propertyId={propertyId}
        disabled={saving || dirty}
      />
    </Card>
  );
}
