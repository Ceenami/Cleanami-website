"use client";

import { useEffect, useState } from "react";
import { SmsConsentField } from "@/components/cleaner/SmsConsentField";
import { SMS_CONSENT_VERSION } from "@/lib/sms/consent";

export function SmsPreferences() {
  const [preference, setPreference] = useState<{ optedIn: boolean; carrierBlocked: boolean; phone: string | null } | null>(null);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/cleaner/sms-consent");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load SMS preference.");
        if (!cancelled) { setPreference(data); setChecked(data.optedIn); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load SMS preference.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/cleaner/sms-consent", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optedIn: checked, phone: preference?.phone ?? "", disclosureVersion: SMS_CONSENT_VERSION }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save SMS preference.");
      setPreference(data); setChecked(data.optedIn);
      setMessage(data.optedIn ? "SMS consent saved." : "SMS consent withdrawn. Continue checking your dashboard or email for assignments.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save SMS preference.");
    } finally { setSaving(false); }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="font-semibold text-gray-900">Operational SMS</h2>
      {preference ? <>
        <p className="text-sm text-gray-600">Mobile number: {preference.phone ?? "No valid mobile number on file. Contact operations to update it."}</p>
        <SmsConsentField checked={checked} onChange={setChecked} disabled={saving || !preference.phone} />
        {preference.carrierBlocked && <p className="text-sm text-gray-600">Your carrier has stopped these texts. To resume, reply START to the CleanNami number and save your consent here.</p>}
        <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? "Saving..." : "Save SMS preference"}
        </button>
      </> : !error && <p className="text-sm text-gray-600">Loading SMS preference...</p>}
      <div aria-live="polite">
        {message && <p className="text-sm text-green-800">{message}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </section>
  );
}
