"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateFirstCleanDiscount } from "@/lib/actions/platform-config.actions";

export function FirstCleanDiscountControl({
  initialPercent,
}: {
  initialPercent: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(initialPercent));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    const res = await updateFirstCleanDiscount(Number(value));
    setSaving(false);
    setMessage(res.success ? "Saved." : res.error ?? "Failed");
    if (res.success) router.refresh();
  }

  return (
    <div className="bg-white shadow-md rounded-lg p-6">
      <p className="text-sm text-gray-600 mb-3">
        A percentage discount applied to every customer&apos;s prepaid first
        clean at signup. Set to 0 to disable.
      </p>
      <div className="flex items-center gap-3">
        <div className="relative">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-28 rounded-md border border-gray-300 px-3 py-2 pr-7 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-teal-500"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
            %
          </span>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {message && (
          <span className="text-sm text-gray-500">{message}</span>
        )}
      </div>
    </div>
  );
}
