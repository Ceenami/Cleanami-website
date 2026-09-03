/**
 * Shapes and constants for the admin view of a cleaner's onboarding documents
 * (counterproposal item 17).
 *
 * They live here rather than beside the route because a Next.js App Router
 * route module may only export the HTTP handlers and a fixed set of config
 * keys — anything else fails the build with a type-constraint error that does
 * not name the offending export.
 */

export const ONBOARDING_DOCUMENTS_BUCKET = "onboarding-documents";

/**
 * The four documents onboarding asks a cleaner to complete, and the keys the
 * web wizard writes into `cleaners.legal_docs_signed`.
 */
export const DOCUMENT_SLOTS = [
  { key: "w9Url", label: "W-9", filePrefix: "w9" },
  { key: "liabilityWaiverUrl", label: "Liability waiver", filePrefix: "liability" },
  { key: "gpsConsentUrl", label: "GPS consent", filePrefix: "gps" },
  {
    key: "contractorAgreementUrl",
    label: "Contractor agreement",
    filePrefix: "contractor",
  },
] as const;

export type CleanerDocument = {
  /** Object name inside the bucket, e.g. `w9-1712345678.pdf`. */
  name: string;
  /** Derived from the name's prefix — there is no index table to ask. */
  label: string;
  sizeBytes: number | null;
  uploadedAt: string | null;
  /** Short-lived signed URL, or null if signing failed. */
  url: string | null;
};

export type CleanerDocumentsResponse = {
  documents: CleanerDocument[];
  /**
   * Slots the cleaner completed as an **acknowledgement** rather than a file.
   *
   * This is the finding item 17's premise gets wrong, and the reason an empty
   * `documents` list is usually not a bug: the **native app** uploads files
   * into this bucket, but the **website** onboarding wizard uploads nothing —
   * it writes the literal string `"acknowledged"` into `legal_docs_signed`
   * (`lib/queries/cleaner-onboarding.ts`). A cleaner who onboarded on the web
   * has an acknowledgement and no file, and there is nothing to download
   * because nothing was ever uploaded.
   */
  acknowledgedOnly: { key: string; label: string }[];
  /** Slots with neither a file nor an acknowledgement. */
  missing: { key: string; label: string }[];
};

/** Which document a stored object is, inferred from its name's prefix. */
export function labelForDocumentObject(name: string): string {
  return (
    DOCUMENT_SLOTS.find((slot) =>
      name.toLowerCase().startsWith(slot.filePrefix)
    )?.label ?? "Other document"
  );
}
