"use client";
import { useEffect, useState } from "react";
type Policy = {
  hotTubRequired: boolean;
  laundryLeadRequired: boolean;
  adminNotes: string;
  revision: number;
};
export function PropertyAssignmentPolicy({
  propertyId,
}: {
  propertyId: string;
}) {
  const [policy, setPolicy] = useState<Policy | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const url = `/api/admin/properties/${propertyId}/assignment-policy`;
  async function load() {
    const r = await fetch(url);
    if (!r.ok) throw new Error("Policy unavailable");
    setPolicy(await r.json());
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!policy) return;
    setSaving(true);
    setError("");
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotTubRequired: policy.hotTubRequired,
          laundryLeadRequired: policy.laundryLeadRequired,
          adminNotes: policy.adminNotes,
          revision: policy.revision,
          reason,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      await load();
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="border-t pt-4 space-y-3">
      <h2 className="font-semibold">Assignment requirements</h2>
      <p className="text-sm text-gray-500">
        Additional requirements are frozen into new jobs. Ordered
        hot-tub/off-site laundry services remain mandatory; these switches
        cannot waive them or change existing jobs.
      </p>
      {policy && (
        <>
          <label className="block text-sm">
            <input
              type="checkbox"
              checked={policy.hotTubRequired}
              onChange={(e) =>
                setPolicy({ ...policy, hotTubRequired: e.target.checked })
              }
            />{" "}
            Hot-tub capable worker required
          </label>
          <label className="block text-sm">
            <input
              type="checkbox"
              checked={policy.laundryLeadRequired}
              onChange={(e) =>
                setPolicy({ ...policy, laundryLeadRequired: e.target.checked })
              }
            />{" "}
            Certified laundry lead required
          </label>
          <label className="block text-sm">
            Private admin notes
            <textarea
              className="block w-full border rounded p-2"
              maxLength={3000}
              value={policy.adminNotes}
              onChange={(e) =>
                setPolicy({ ...policy, adminNotes: e.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            Change reason
            <input
              className="block w-full border rounded p-2"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            className="text-teal-800"
            disabled={saving || reason.trim().length < 3}
            onClick={save}
          >
            Save requirements
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
