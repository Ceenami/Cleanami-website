"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
export function PropertyExclusions({ propertyId }: { propertyId: string }) {
  const [cleanerId, setCleanerId] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const url = `/api/admin/properties/${propertyId}/exclusions`;
  const { data: rows = [], refetch } = useQuery<
    Array<{ cleanerId: string; reason: string }>
  >({
    queryKey: ["property-exclusions", propertyId],
    queryFn: async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error("Unable to load exclusions");
      return r.json();
    },
  });
  const { data: cleaners = [] } = useQuery<
    Array<{ id: string; fullName: string }>
  >({
    queryKey: ["exclusion-cleaners"],
    queryFn: async () => {
      const r = await fetch("/api/cleaners?limit=100");
      if (!r.ok) throw new Error("Unable to load cleaners");
      return (await r.json()).data;
    },
  });
  async function save(id: string, excluded: boolean) {
    setSaving(true);
    setError("");
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleanerId: id, excluded, reason }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      await refetch();
      setReason("");
      setCleanerId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="border-t pt-4 space-y-3">
      <h2 className="font-semibold">Do not assign</h2>
      <p className="text-sm text-gray-500">
        Hard exclusion for every assignment path. Existing jobs are not silently
        canceled.
      </p>
      {rows.map((row) => (
        <div key={row.cleanerId} className="border-b py-2 text-sm">
          <span>
            {cleaners.find((c) => c.id === row.cleanerId)?.fullName ??
              row.cleanerId}{" "}
            — {row.reason}
          </span>
          <button
            disabled={saving || reason.trim().length < 3}
            className="ml-3 text-teal-800"
            onClick={() => save(row.cleanerId, false)}
          >
            Remove with reason
          </button>
        </div>
      ))}
      <select
        aria-label="Cleaner to exclude"
        value={cleanerId}
        onChange={(e) => setCleanerId(e.target.value)}
        className="border rounded p-2"
      >
        <option value="">Select cleaner</option>
        {cleaners.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName}
          </option>
        ))}
      </select>
      <label className="block text-sm">
        Reason for exclusion or removal
        <input
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="block border rounded p-2 mt-1 w-full"
        />
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <button
        disabled={saving || !cleanerId || reason.trim().length < 3}
        onClick={() => save(cleanerId, true)}
        className="text-teal-800"
      >
        Exclude cleaner
      </button>
    </section>
  );
}
