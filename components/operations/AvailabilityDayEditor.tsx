"use client";
import { useState } from "react";

export type AvailabilityEditTarget = {
  cleanerId: string;
  cleanerName: string;
  date: string;
  revision: number;
  isAvailable: boolean;
  onCallEligible: boolean;
  openPoolEligible: boolean;
  workingJobs: Array<{ id: string; address: string }>;
};

export function AvailabilityDayEditor({
  target,
  onSaved,
  onClose,
}: {
  target: AvailabilityEditTarget;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [flags, setFlags] = useState({
    isAvailable: target.isAvailable,
    onCallEligible: target.onCallEligible,
    openPoolEligible: target.openPoolEligible,
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const assigned = target.workingJobs.length > 0;
  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cleanerId: target.cleanerId,
          day: { date: target.date, revision: target.revision, ...flags },
          reason,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Edit failed");
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="border border-teal-200 rounded-lg bg-teal-50 p-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3 className="font-semibold">
        Edit availability · {target.cleanerName} · {target.date}
      </h3>
      <p className="text-xs text-gray-600">
        Admin edits may change locked dates. This does not submit a two-week
        acknowledgement on the cleaner’s behalf.
      </p>
      {assigned && (
        <div className="text-sm text-amber-900">
          Reassign working coverage before removing availability or existing
          pool opt-ins.
          {target.workingJobs.map((job) => (
            <a
              className="block underline"
              key={job.id}
              href={`/admin/job-oversight/${job.id}`}
            >
              {job.address} · Manage assignment
            </a>
          ))}
        </div>
      )}
      <label className="block text-sm">
        <input
          type="checkbox"
          checked={flags.isAvailable}
          disabled={saving || (assigned && target.isAvailable)}
          onChange={(event) =>
            setFlags(
              event.target.checked
                ? { ...flags, isAvailable: true }
                : {
                    isAvailable: false,
                    onCallEligible: false,
                    openPoolEligible: false,
                  },
            )
          }
        />{" "}
        Available
      </label>
      <label className="block text-sm">
        <input
          type="checkbox"
          checked={flags.onCallEligible}
          disabled={
            saving || !flags.isAvailable || (assigned && target.onCallEligible)
          }
          onChange={(event) =>
            setFlags({ ...flags, onCallEligible: event.target.checked })
          }
        />{" "}
        On-call
      </label>
      <label className="block text-sm">
        <input
          type="checkbox"
          checked={flags.openPoolEligible}
          disabled={
            saving ||
            !flags.isAvailable ||
            (assigned && target.openPoolEligible)
          }
          onChange={(event) =>
            setFlags({ ...flags, openPoolEligible: event.target.checked })
          }
        />{" "}
        Open Pool
      </label>
      <label className="block text-sm">
        Reason for admin edit
        <input
          className="block border rounded p-2 mt-1 w-full"
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error} Reload the schedule if another edit changed this date.
        </p>
      )}
      <button
        disabled={saving || reason.trim().length < 3}
        className="bg-teal-700 text-white rounded px-3 py-2"
      >
        {saving ? "Saving…" : "Save availability edit"}
      </button>
      <button
        type="button"
        disabled={saving}
        className="ml-3"
        onClick={onClose}
      >
        Cancel
      </button>
    </form>
  );
}
