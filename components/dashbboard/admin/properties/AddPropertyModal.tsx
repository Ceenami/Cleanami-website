"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type LaundryType = "in_unit" | "off_site" | "none";
type DrainCadence =
  | "4_weeks"
  | "6_weeks"
  | "2_months"
  | "3_months"
  | "4_months";

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-teal-500";
const labelClass = "block text-sm font-medium text-gray-600";

/**
 * Adds a property to an existing account.
 *
 * Before this, the only code path that created a property was the public
 * signup flow, which creates customer + property + subscription + first
 * payment in one transaction — so an existing customer could never add a
 * second property and staff could not add one at all.
 *
 * `customerId` is only sent when an admin is filling this in on someone's
 * behalf. For a customer it is omitted entirely and the server uses their own
 * id from the session; the field is not trusted from the browser.
 */
export function AddPropertyModal({
  open,
  onClose,
  customerId,
  pickCustomer = false,
  canOverrideServiceArea = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Admin only — whose account to create under. Omit in the customer portal. */
  customerId?: string;
  /**
   * Admin properties page: the owner is not implied by context, so ask. In the
   * customer portal this stays false and the server uses the session's own id.
   */
  pickCustomer?: boolean;
  /**
   * Whether to offer "save anyway" when the address falls outside the service
   * area. Cosmetic only — the server authorizes the override independently, so
   * a customer who forces the flag is still hard-blocked.
   */
  canOverrideServiceArea?: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [outOfAreaPrompt, setOutOfAreaPrompt] = useState<string | null>(null);
  const [owners, setOwners] = useState<{ id: string; name: string; email: string }[]>([]);
  const [ownerId, setOwnerId] = useState(customerId ?? "");

  useEffect(() => {
    if (!open || !pickCustomer) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/customers?page=1&limit=200");
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setOwners(body.data ?? []);
      } catch {
        // Non-fatal: the field stays empty and the form cannot submit, which
        // is a clearer failure than silently creating under the wrong owner.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pickCustomer]);

  const [form, setForm] = useState({
    address: "",
    sqFt: "",
    bedCount: "",
    bathCount: "",
    hasHotTub: false,
    laundryType: "none" as LaundryType,
    laundryLoads: "",
    hotTubServiceLevel: false,
    hotTubDrain: false,
    hotTubDrainCadence: "" as DrainCadence | "",
    iCalUrl: "",
    defaultCheckInTime: "16:00:00",
    defaultCheckOutTime: "09:00:00",
  });

  if (!open) return null;

  const submit = async (confirmOutOfServiceArea: boolean) => {
    setSaving(true);
    setError(null);
    setWarning(null);
    if (!confirmOutOfServiceArea) setOutOfAreaPrompt(null);

    const payload: Record<string, unknown> = {
      address: form.address.trim(),
      bedCount: Number(form.bedCount),
      bathCount: Number(form.bathCount),
      sqFt: form.sqFt === "" ? null : Number(form.sqFt),
      hasHotTub: form.hasHotTub,
      laundryType: form.laundryType,
      // Null only when there is no laundry service. Otherwise send the number
      // so the server rejects a blank rather than storing a $0-priced property.
      laundryLoads:
        form.laundryType === "none" || form.laundryLoads === ""
          ? null
          : Number(form.laundryLoads),
      // Only meaningful with a hot tub; the server enforces this too, since a
      // hot-tub service flag on a property without one is what made the
      // pricing engine bill hot-tub time it should not have (migration 0032).
      hotTubServiceLevel: form.hasHotTub ? form.hotTubServiceLevel : false,
      hotTubDrain: form.hasHotTub ? form.hotTubDrain : false,
      hotTubDrainCadence:
        form.hasHotTub && form.hotTubDrainCadence !== ""
          ? form.hotTubDrainCadence
          : null,
      iCalUrl: form.iCalUrl.trim() === "" ? null : form.iCalUrl.trim(),
      defaultCheckInTime: form.defaultCheckInTime,
      defaultCheckOutTime: form.defaultCheckOutTime,
      // Sent only by an admin. A customer omits it and the server fills in
      // their own id — it is never trusted from the browser.
      ...(pickCustomer || customerId ? { customerId: ownerId } : {}),
      ...(confirmOutOfServiceArea ? { confirmOutOfServiceArea: true } : {}),
    };

    try {
      const res = await fetch("/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        // Out-of-area is a refusal an admin may deliberately override, so it
        // gets a confirm step rather than a dead end. Anyone without the
        // capability just sees the message.
        if (data.code === "OUT_OF_SERVICE_AREA" && canOverrideServiceArea) {
          setOutOfAreaPrompt(data.error ?? "That address is outside our service area.");
          return;
        }
        setError(data.error ?? "Could not add the property.");
        return;
      }

      if (data.warning) {
        // Saved, but not locatable — worth stopping on rather than closing,
        // because an ungeocoded property cannot have its check-ins verified.
        setWarning(data.warning);
        router.refresh();
        return;
      }

      router.refresh();
      onClose();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(false);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-gray-500 bg-opacity-75"
        onClick={saving ? undefined : onClose}
      />
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="relative w-full max-w-2xl rounded-lg bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h3 className="text-lg font-semibold text-gray-800">
              Add a property
            </h3>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}
            {warning && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {warning}
              </div>
            )}
            {outOfAreaPrompt && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p>{outOfAreaPrompt}</p>
                <p className="mt-2">
                  Saving anyway will create a property we do not currently
                  service. Cleaner matching works from the property&apos;s
                  location, so it may find nobody nearby.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void submit(true)}
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:bg-gray-400"
                  >
                    {saving ? "Saving…" : "Save anyway"}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setOutOfAreaPrompt(null)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Change the address
                  </button>
                </div>
              </div>
            )}

            {pickCustomer && (
              <div>
                <label className={labelClass}>Owner</label>
                <select
                  className={inputClass}
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  required
                >
                  <option value="">Select a customer…</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} — {o.email}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={labelClass}>Address</label>
              <input
                className={inputClass}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="123 Ocean Ave, New Smyrna Beach, FL 32169"
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                Used to price the clean and to confirm the cleaner arrived on
                site, so a full street address matters.
              </p>
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
                  onChange={(e) =>
                    setForm({ ...form, bedCount: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <label className={labelClass}>Bathrooms</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className={inputClass}
                  value={form.bathCount}
                  onChange={(e) =>
                    setForm({ ...form, bathCount: e.target.value })
                  }
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
                    setForm({
                      ...form,
                      laundryType: e.target.value as LaundryType,
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="in_unit">In-Unit</option>
                  <option value="off_site">Off-Site</option>
                </select>
              </div>
              {/* Only shown when it is billable, and required when shown: a
                  blank count prices laundry at $0. Mirrors the booking form. */}
              {form.laundryType !== "none" && (
                <div>
                  <label className={labelClass}>
                    Estimated loads per turnover
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    required
                    className={inputClass}
                    value={form.laundryLoads}
                    onChange={(e) =>
                      setForm({ ...form, laundryLoads: e.target.value })
                    }
                    placeholder="e.g. 3"
                  />
                </div>
              )}
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
              {form.hasHotTub && (
                <>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.hotTubServiceLevel}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          hotTubServiceLevel: e.target.checked,
                        })
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
                </>
              )}
            </div>

            {form.hasHotTub && form.hotTubDrain && (
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
                  <option value="">Not set</option>
                  <option value="4_weeks">Every 4 weeks</option>
                  <option value="6_weeks">Every 6 weeks</option>
                  <option value="2_months">Every 2 months</option>
                  <option value="3_months">Every 3 months</option>
                  <option value="4_months">Every 4 months</option>
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Guest check-in time</label>
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
                <label className={labelClass}>Guest check-out time</label>
                <input
                  type="time"
                  step={1}
                  className={inputClass}
                  value={form.defaultCheckOutTime}
                  onChange={(e) =>
                    setForm({ ...form, defaultCheckOutTime: e.target.value })
                  }
                />
                <p className="mt-1 text-xs text-gray-500">
                  Cleaners cannot check in before this — the guest is still in
                  the property.
                </p>
              </div>
            </div>

            <div>
              <label className={labelClass}>Calendar (iCal) URL</label>
              <input
                className={inputClass}
                value={form.iCalUrl}
                onChange={(e) => setForm({ ...form, iCalUrl: e.target.value })}
                placeholder="https://… (optional)"
              />
              <p className="mt-1 text-xs text-gray-500">
                Cleans are scheduled automatically from this calendar. Without
                it, book each clean by hand.
              </p>
            </div>

            <div className="flex justify-end gap-3 border-t pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {warning ? "Done" : "Cancel"}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {saving ? "Adding…" : "Add property"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
