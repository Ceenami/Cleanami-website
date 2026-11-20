export type EvidencePhase = "before" | "after";
/** A server-generated namespace also preserves the exclusion during flag rollback. */
export function isBeforeUpload(upload: { path: string }, phase?: string) {
  return phase === "before" || upload.path.includes("/issued-before/");
}
