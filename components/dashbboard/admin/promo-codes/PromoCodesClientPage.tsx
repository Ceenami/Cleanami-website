"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatPromoValue } from "@/lib/pricing/promo-code";
import {
  createPromoCodeAction,
  deletePromoCodeAction,
  setPromoCodeActiveAction,
} from "@/lib/actions/promo.actions";

export type PromoCodeRow = {
  id: string;
  code: string;
  description: string | null;
  discountType: "percent" | "fixed";
  discountValue: number;
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

const emptyForm = {
  code: "",
  description: "",
  discountType: "percent" as "percent" | "fixed",
  discountValue: "",
  maxRedemptions: "",
  startsAt: "",
  expiresAt: "",
};

function statusOf(row: PromoCodeRow): { label: string; className: string } {
  if (!row.active) return { label: "inactive", className: "bg-gray-100 text-gray-700" };

  const now = Date.now();
  if (row.startsAt && new Date(row.startsAt).getTime() > now) {
    return { label: "scheduled", className: "bg-blue-100 text-blue-800" };
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now) {
    return { label: "expired", className: "bg-amber-100 text-amber-800" };
  }
  if (row.maxRedemptions !== null && row.redemptionCount >= row.maxRedemptions) {
    return { label: "used up", className: "bg-amber-100 text-amber-800" };
  }
  return { label: "live", className: "bg-green-100 text-green-800" };
}

export function PromoCodesClientPage({ codes }: { codes: PromoCodeRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    const result = await createPromoCodeAction({
      code: form.code,
      description: form.description || undefined,
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
      startsAt: form.startsAt || undefined,
      expiresAt: form.expiresAt || undefined,
    });
    setSaving(false);

    if (!result.success) {
      toast.error(result.error ?? "Could not create that code.");
      return;
    }

    toast.success(`${form.code.trim().toUpperCase()} created.`);
    setForm(emptyForm);
    router.refresh();
  };

  const toggle = async (row: PromoCodeRow) => {
    setBusyId(row.id);
    const result = await setPromoCodeActiveAction(row.id, !row.active);
    setBusyId(null);

    if (!result.success) {
      toast.error(result.error ?? "Could not update that code.");
      return;
    }
    router.refresh();
  };

  const remove = async (row: PromoCodeRow) => {
    if (!confirm(`Delete ${row.code}? This cannot be undone.`)) return;

    setBusyId(row.id);
    const result = await deletePromoCodeAction(row.id);
    setBusyId(null);

    if (!result.success) {
      toast.error(result.error ?? "Could not delete that code.");
      return;
    }
    toast.success(`${row.code} deleted.`);
    router.refresh();
  };

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Create a code
        </h2>
        <div className="bg-white shadow-md rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Code</span>
              <input
                type="text"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                placeholder="SPRING25"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase tracking-wide focus:border-teal-500 focus:outline-none focus:ring-teal-500"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Discount type
              </span>
              <select
                value={form.discountType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    discountType: e.target.value as "percent" | "fixed",
                  })
                }
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-teal-500"
              >
                <option value="percent">Percentage off</option>
                <option value="fixed">Fixed dollar amount off</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                {form.discountType === "percent"
                  ? "Percent off (1–100)"
                  : "Dollars off"}
              </span>
              <input
                type="number"
                min={form.discountType === "percent" ? 1 : 0.01}
                max={form.discountType === "percent" ? 100 : undefined}
                step={form.discountType === "percent" ? 1 : 0.01}
                value={form.discountValue}
                onChange={(e) =>
                  setForm({ ...form, discountValue: e.target.value })
                }
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-teal-500"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Max redemptions{" "}
                <span className="text-gray-400">(blank = unlimited)</span>
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={form.maxRedemptions}
                onChange={(e) =>
                  setForm({ ...form, maxRedemptions: e.target.value })
                }
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-teal-500"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Starts <span className="text-gray-400">(optional)</span>
              </span>
              <input
                type="date"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-teal-500"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Expires <span className="text-gray-400">(optional)</span>
              </span>
              <input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-teal-500"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Internal note <span className="text-gray-400">(optional)</span>
            </span>
            <input
              type="text"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Spring campaign, Facebook ad"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-teal-500"
            />
          </label>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !form.code.trim() || !form.discountValue}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {saving ? "Creating…" : "Create code"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          All codes ({codes.length})
        </h2>
        <div className="overflow-x-auto shadow-md rounded-lg bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {["Code", "Value", "Status", "Used", "Window", "Actions"].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {heading}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {codes.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-8 text-center text-sm text-gray-500"
                  >
                    No promo codes yet.
                  </td>
                </tr>
              )}
              {codes.map((row) => {
                const status = statusOf(row);
                return (
                  <tr key={row.id}>
                    <td className="px-6 py-4">
                      <div className="font-mono text-sm font-medium text-gray-900">
                        {row.code}
                      </div>
                      {row.description && (
                        <div className="text-xs text-gray-500">
                          {row.description}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-teal-600">
                      {formatPromoValue(row)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                      {row.redemptionCount}
                      {row.maxRedemptions !== null && ` / ${row.maxRedemptions}`}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {row.startsAt
                        ? format(new Date(row.startsAt), "MMM d, yyyy")
                        : "—"}
                      {" → "}
                      {row.expiresAt
                        ? format(new Date(row.expiresAt), "MMM d, yyyy")
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => void toggle(row)}
                          disabled={busyId === row.id}
                          className="font-medium text-teal-600 hover:text-teal-800 disabled:opacity-50"
                        >
                          {row.active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(row)}
                          disabled={busyId === row.id || row.redemptionCount > 0}
                          title={
                            row.redemptionCount > 0
                              ? "Redeemed codes cannot be deleted — deactivate instead."
                              : undefined
                          }
                          className="font-medium text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:text-gray-300"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
