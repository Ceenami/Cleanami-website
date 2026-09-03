'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import type { CleanerDocumentsResponse } from '@/lib/cleaner/onboarding-documents';

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * the admin-side view of a cleaner's onboarding
 * documents.
 *
 * The load-bearing part of this panel is not the download links: it is the
 * **"acknowledged, no file uploaded"** state. The native app uploads files into
 * the `onboarding-documents` bucket; the website's onboarding wizard uploads
 * nothing and writes the literal string `"acknowledged"` instead. So a cleaner
 * who onboarded on the web genuinely has no files, and an empty list without an
 * explanation reads as "this feature is broken" when the truth is "there is
 * nothing there, and here is why". That is the thing the client does not
 * currently know, and item 17 asks first for the answer, not the link.
 */
export function CleanerDocumentsModal({
  cleanerId,
  cleanerName,
  onClose,
}: {
  cleanerId: string;
  cleanerName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<CleanerDocumentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cleaners/${cleanerId}/documents`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Could not load documents');
        return body as CleanerDocumentsResponse;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [cleanerId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Onboarding documents
            </h3>
            <p className="text-sm text-gray-500">{cleanerName}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4">
          {error && (
            <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
          )}

          {!data && !error && (
            <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading documents…
            </div>
          )}

          {data && data.documents.length > 0 && (
            <ul className="space-y-2">
              {data.documents.map((doc) => (
                <li
                  key={doc.name}
                  className="flex items-center justify-between gap-3 rounded border border-gray-200 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {doc.label}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {doc.name}
                        {doc.sizeBytes !== null && ` · ${formatBytes(doc.sizeBytes)}`}
                      </p>
                    </div>
                  </div>
                  {doc.url ? (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-sm font-medium text-teal-600 hover:text-teal-800"
                    >
                      Download
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-gray-400">
                      Link unavailable
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {data && data.acknowledgedOnly.length > 0 && (
            <div className="rounded bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-900">
                Acknowledged on the web — no file uploaded
              </p>
              <p className="mt-1 text-xs text-amber-800">
                These were completed through the website onboarding wizard, which
                records an acknowledgement rather than collecting a document.
                There is no file to download. Cleaners who onboard through the
                native app upload real files, which appear above.
              </p>
              <ul className="mt-2 list-inside list-disc text-xs text-amber-900">
                {data.acknowledgedOnly.map((slot) => (
                  <li key={slot.key}>{slot.label}</li>
                ))}
              </ul>
            </div>
          )}

          {data && data.missing.length > 0 && (
            <div className="rounded bg-gray-50 p-3">
              <p className="text-sm font-medium text-gray-700">
                Not completed
              </p>
              <ul className="mt-1 list-inside list-disc text-xs text-gray-600">
                {data.missing.map((slot) => (
                  <li key={slot.key}>{slot.label}</li>
                ))}
              </ul>
            </div>
          )}

          {data &&
            data.documents.length === 0 &&
            data.acknowledgedOnly.length === 0 &&
            data.missing.length === 0 && (
              <p className="py-6 text-center text-sm text-gray-500">
                Nothing recorded for this cleaner yet.
              </p>
            )}
        </div>
      </div>
    </div>
  );
}
