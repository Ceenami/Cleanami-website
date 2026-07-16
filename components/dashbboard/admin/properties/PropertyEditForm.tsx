"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "./Card";
import { PencilIcon } from "lucide-react";
import type { PropertyDetails } from "@/lib/queries/properties";

type LaundryType = "in_unit" | "off_site" | "none";
type DrainCadence =
  | "4_weeks"
  | "6_weeks"
  | "2_months"
  | "3_months"
  | "4_months";

interface Props {
  property: PropertyDetails;
}

export const PropertyEditForm = ({ property }: Props) => {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    address: property.address ?? "",
    sqFt: property.sqFt?.toString() ?? "",
    bedCount: property.bedCount?.toString() ?? "",
    bathCount: property.bathCount?.toString() ?? "",
    hasHotTub: property.hasHotTub ?? false,
    laundryType: (property.laundryType ?? "none") as LaundryType,
    laundryLoads: property.laundryLoads?.toString() ?? "",
    hotTubServiceLevel: property.hotTubServiceLevel ?? false,
    hotTubDrain: property.hotTubDrain ?? false,
    hotTubDrainCadence: (property.hotTubDrainCadence ?? "") as
      | DrainCadence
      | "",
    iCalUrl: property.iCalUrl ?? "",
    defaultCheckInTime: property.defaultCheckInTime ?? "16:00:00",
    defaultCheckOutTime: property.defaultCheckOutTime ?? "09:00:00",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const payload: Record<string, unknown> = {
      address: form.address.trim(),
      sqFt: form.sqFt === "" ? null : Number(form.sqFt),
      bedCount: Number(form.bedCount),
      bathCount: Number(form.bathCount),
      hasHotTub: form.hasHotTub,
      laundryType: form.laundryType,
      laundryLoads: form.laundryLoads === "" ? null : Number(form.laundryLoads),
      hotTubServiceLevel: form.hotTubServiceLevel,
      hotTubDrain: form.hotTubDrain,
      hotTubDrainCadence:
        form.hotTubDrainCadence === "" ? null : form.hotTubDrainCadence,
      iCalUrl: form.iCalUrl.trim() === "" ? null : form.iCalUrl.trim(),
      defaultCheckInTime: form.defaultCheckInTime,
      defaultCheckOutTime: form.defaultCheckOutTime,
    };

    try {
      const res = await fetch(`/api/properties/${property.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update property");
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update property");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-teal-500";
  const labelClass = "block text-sm font-medium text-gray-600";

  return (
    <Card icon={<PencilIcon />} title="Edit Property">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Address</label>
          <input
            className={inputClass}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            required
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Sq. Ft.</label>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={form.sqFt}
              onChange={(e) => setForm({ ...form, sqFt: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>Bedrooms</label>
            <input
              type="number"
              min={1}
              className={inputClass}
              value={form.bedCount}
              onChange={(e) => setForm({ ...form, bedCount: e.target.value })}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Bathrooms</label>
            <input
              type="number"
              min={0.5}
              step={0.5}
              className={inputClass}
              value={form.bathCount}
              onChange={(e) => setForm({ ...form, bathCount: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Laundry</label>
            <select
              className={inputClass}
              value={form.laundryType}
              onChange={(e) =>
                setForm({ ...form, laundryType: e.target.value as LaundryType })
              }
            >
              <option value="none">None</option>
              <option value="in_unit">In-Unit</option>
              <option value="off_site">Off-Site</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Laundry Loads</label>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={form.laundryLoads}
              onChange={(e) =>
                setForm({ ...form, laundryLoads: e.target.value })
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.hasHotTub}
              onChange={(e) =>
                setForm({ ...form, hasHotTub: e.target.checked })
              }
            />
            Has hot tub
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.hotTubServiceLevel}
              onChange={(e) =>
                setForm({ ...form, hotTubServiceLevel: e.target.checked })
              }
            />
            Hot tub service
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.hotTubDrain}
              onChange={(e) =>
                setForm({ ...form, hotTubDrain: e.target.checked })
              }
            />
            Needs drain
          </label>
        </div>

        {form.hotTubDrain && (
          <div>
            <label className={labelClass}>Drain Cadence</label>
            <select
              className={inputClass}
              value={form.hotTubDrainCadence}
              onChange={(e) =>
                setForm({
                  ...form,
                  hotTubDrainCadence: e.target.value as DrainCadence | "",
                })
              }
            >
              <option value="">—</option>
              <option value="4_weeks">4 weeks</option>
              <option value="6_weeks">6 weeks</option>
              <option value="2_months">2 months</option>
              <option value="3_months">3 months</option>
              <option value="4_months">4 months</option>
            </select>
          </div>
        )}

        <div>
          <label className={labelClass}>iCal URL</label>
          <input
            type="url"
            className={inputClass}
            value={form.iCalUrl}
            onChange={(e) => setForm({ ...form, iCalUrl: e.target.value })}
            placeholder="https://..."
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Default Check-in</label>
            <input
              type="time"
              step={1}
              className={inputClass}
              value={form.defaultCheckInTime}
              onChange={(e) =>
                setForm({ ...form, defaultCheckInTime: e.target.value })
              }
            />
          </div>
          <div>
            <label className={labelClass}>Default Check-out</label>
            <input
              type="time"
              step={1}
              className={inputClass}
              value={form.defaultCheckOutTime}
              onChange={(e) =>
                setForm({ ...form, defaultCheckOutTime: e.target.value })
              }
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && (
          <p className="text-sm text-green-600">Property updated.</p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </Card>
  );
};
