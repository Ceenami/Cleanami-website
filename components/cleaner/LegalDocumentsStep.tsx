"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileText, Loader } from "lucide-react";

type DocType =
  | "contractor_agreement"
  | "liability_waiver"
  | "privacy_consent"
  | "w9";

const SIGN_DOCS: { type: DocType; title: string; blurb: string }[] = [
  {
    type: "contractor_agreement",
    title: "Independent Contractor Agreement",
    blurb: "Confirms you work as an independent contractor for CleanNami.",
  },
  {
    type: "liability_waiver",
    title: "Liability Waiver",
    blurb: "Acknowledges the liability terms for on-site cleaning work.",
  },
  {
    type: "privacy_consent",
    title: "GPS Tracking Consent",
    blurb: "Consents to GPS location capture at check-in/out during active jobs.",
  },
];

export function LegalDocumentsStep({
  onComplete,
  onBack,
  completing,
}: {
  onComplete: () => void;
  onBack: () => void;
  completing: boolean;
}) {
  const [signed, setSigned] = useState<Set<DocType>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<DocType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [w9File, setW9File] = useState<File | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/cleaner/onboarding/legal-documents");
        if (res.ok) {
          const body = await res.json();
          setSigned(new Set((body.signed ?? []) as DocType[]));
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const post = async (form: FormData, type: DocType) => {
    setBusy(type);
    setError(null);
    try {
      const res = await fetch("/api/cleaner/onboarding/legal-documents", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Failed to save document");
      }
      setSigned((prev) => new Set(prev).add(type));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save document");
    } finally {
      setBusy(null);
    }
  };

  const sign = (type: DocType) => {
    const form = new FormData();
    form.set("documentType", type);
    form.set("signedName", names[type] ?? "");
    return post(form, type);
  };

  const uploadW9 = () => {
    if (!w9File) return;
    const form = new FormData();
    form.set("documentType", "w9");
    form.set("file", w9File);
    return post(form, "w9");
  };

  const allDone =
    SIGN_DOCS.every((d) => signed.has(d.type)) && signed.has("w9");

  return (
    <div className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-600">
        Please review and sign each document. Your typed name, the date, and your
        IP address are recorded as your electronic signature.
      </p>

      {SIGN_DOCS.map((doc) => {
        const isSigned = signed.has(doc.type);
        return (
          <div key={doc.type} className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-800">
                  {doc.title}
                </span>
              </div>
              {isSigned && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle2 className="h-4 w-4" /> Signed
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">{doc.blurb}</p>
            {!isSigned && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  placeholder="Type your full name to sign"
                  value={names[doc.type] ?? ""}
                  onChange={(e) =>
                    setNames({ ...names, [doc.type]: e.target.value })
                  }
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => sign(doc.type)}
                  disabled={busy === doc.type || !(names[doc.type]?.trim())}
                  className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy === doc.type ? "Signing…" : "Sign"}
                </button>
              </div>
            )}
          </div>
        );
      })}

      <div className="rounded-lg border border-gray-200 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-800">
              W-9 Tax Form
            </span>
          </div>
          {signed.has("w9") && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-4 w-4" /> Uploaded
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Upload your completed W-9 (PDF, JPG, or PNG).
        </p>
        {!signed.has("w9") && (
          <div className="mt-2 flex gap-2">
            <input
              type="file"
              accept=".pdf,image/jpeg,image/png"
              onChange={(e) => setW9File(e.target.files?.[0] ?? null)}
              className="flex-1 text-sm"
            />
            <button
              type="button"
              onClick={uploadW9}
              disabled={busy === "w9" || !w9File}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === "w9" ? "Uploading…" : "Upload"}
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-lg border py-3 text-sm font-medium"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!allDone || completing}
          onClick={onComplete}
          className="flex-1 rounded-lg bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {completing ? (
            <Loader className="mx-auto h-4 w-4 animate-spin" />
          ) : (
            "Continue to Stripe"
          )}
        </button>
      </div>
    </div>
  );
}
