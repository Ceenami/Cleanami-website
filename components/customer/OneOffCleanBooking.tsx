"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PropertyItem = { id: string; address: string | null; price: number | null };

function minDate(): string {
  // Two days out (matches the server buffer), formatted yyyy-mm-dd.
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

export function OneOffCleanBooking({
  properties,
}: {
  properties: PropertyItem[];
}) {
  const router = useRouter();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    amountCents: number;
    promoCode?: string;
  } | null>(null);

  const [promoInput, setPromoInput] = useState("");
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promo, setPromo] = useState<{
    code: string;
    discountCents: number;
    finalAmountCents: number;
    capped: boolean;
  } | null>(null);

  const selected = useMemo(
    () => properties.find((p) => p.id === propertyId) ?? null,
    [properties, propertyId]
  );
  const earliest = useMemo(minDate, []);

  if (properties.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
        You don&apos;t have any properties yet. Add a property first to book a
        clean.
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <h2 className="text-lg font-semibold text-green-800">Clean booked ✅</h2>
        <p className="mt-1 text-sm text-green-700">
          We charged ${(confirmed.amountCents / 100).toFixed(2)}
          {confirmed.promoCode ? ` (${confirmed.promoCode} applied)` : ""} and
          are assigning a cleaner. You&apos;ll see it in your upcoming cleans.
        </p>
        <button
          type="button"
          onClick={() => {
            setConfirmed(null);
            setDate("");
          }}
          className="mt-4 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
        >
          Book another
        </button>
      </div>
    );
  }

  const canSubmit = propertyId && date && !submitting;
  // What the button will actually charge.
  const chargeDollars =
    promo != null ? promo.finalAmountCents / 100 : (selected?.price ?? null);

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code || !propertyId) return;

    setPromoChecking(true);
    setPromoError(null);
    try {
      const res = await fetch("/api/customer/one-off/preview-promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, code }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setPromo(null);
        throw new Error(data.message ?? "That promo code is not valid.");
      }
      setPromo({
        code: data.code,
        discountCents: data.discountCents,
        finalAmountCents: data.finalAmountCents,
        capped: data.capped,
      });
      setPromoInput("");
    } catch (e) {
      setPromoError(
        e instanceof Error ? e.message : "That promo code is not valid."
      );
    } finally {
      setPromoChecking(false);
    }
  }

  function clearPromo() {
    setPromo(null);
    setPromoError(null);
    setPromoInput("");
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/customer/one-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          date,
          ...(promo ? { promoCode: promo.code } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not book the clean.");
      setConfirmed({ amountCents: data.amountCents, promoCode: data.promoCode });
      clearPromo();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not book the clean.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Property
        </label>
        <select
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            // The quote was priced against the previous property.
            clearPromo();
          }}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-teal-500"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.address ?? "Property"}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Clean date
        </label>
        <input
          type="date"
          min={earliest}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-teal-500 focus:outline-none focus:ring-teal-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          Choose a date at least 2 days out so we can assign a cleaner.
        </p>
      </div>

      {selected?.price != null && (
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Promo code <span className="font-normal text-gray-400">(optional)</span>
          </label>
          {promo ? (
            <div className="mt-1 flex items-center justify-between rounded-md border border-teal-200 bg-teal-50 px-3 py-2">
              <span className="text-sm font-medium text-teal-800">
                {promo.code} applied
              </span>
              <button
                type="button"
                onClick={clearPromo}
                disabled={submitting}
                className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={promoInput}
                onChange={(e) => {
                  setPromoInput(e.target.value.toUpperCase());
                  setPromoError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void applyPromo();
                  }
                }}
                placeholder="CODE"
                autoComplete="off"
                spellCheck={false}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm uppercase tracking-wide text-gray-800 placeholder:normal-case focus:border-teal-500 focus:outline-none focus:ring-teal-500"
              />
              <button
                type="button"
                onClick={() => void applyPromo()}
                disabled={promoChecking || !promoInput.trim()}
                className="shrink-0 rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {promoChecking ? "Checking…" : "Apply"}
              </button>
            </div>
          )}
          {promoError && (
            <p className="mt-1 text-xs text-red-600">{promoError}</p>
          )}
          {promo?.capped && (
            <p className="mt-1 text-xs text-gray-500">
              Discount reduced to keep the charge above the minimum.
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            One code per customer, applied to this clean only.
          </p>
        </div>
      )}

      <div className="space-y-1 rounded-lg bg-gray-50 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-700">Price for this clean</span>
          <span
            className={
              promo
                ? "text-gray-500 line-through"
                : "font-semibold text-gray-900"
            }
          >
            {selected?.price != null
              ? `$${selected.price.toFixed(2)}`
              : "Custom quote — contact us"}
          </span>
        </div>
        {promo && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-teal-700">{promo.code}</span>
              <span className="text-teal-700">
                −${(promo.discountCents / 100).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 pt-1 text-sm">
              <span className="font-medium text-gray-700">Total today</span>
              <span className="font-semibold text-gray-900">
                ${(promo.finalAmountCents / 100).toFixed(2)}
              </span>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit || selected?.price == null}
        className="w-full rounded-lg bg-teal-600 py-3 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        {submitting
          ? "Booking…"
          : chargeDollars != null
            ? `Book & pay $${chargeDollars.toFixed(2)}`
            : "Custom quote required"}
      </button>
      <p className="text-center text-xs text-gray-400">
        Your card on file will be charged now for this one-off clean.
      </p>
    </div>
  );
}
