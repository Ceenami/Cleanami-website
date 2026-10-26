import { photoHash, normalizePhoto, transferPhoto, type UploadReservation } from "./execution-transfer";
import { saveLegacyPhoto, type LegacyPhoto } from "./legacy-evidence-queue";
export { photoHash, normalizePhoto };

export class PhotoRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function photoJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store", signal: options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch {
    throw new PhotoRequestError(`Photo service returned HTTP ${response.status}. Your saved photos are retained; retry shortly.`, response.status >= 400 ? response.status : 503);
  }
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `Photo request failed (HTTP ${response.status}). Retry shortly.`;
    const missing = Array.isArray(data?.missing) ? data.missing.filter((value: unknown) => typeof value === "string").join(", ") : "";
    throw new PhotoRequestError(missing ? `${message}: ${missing}` : message, response.status);
  }
  if (!data || typeof data !== "object") throw new PhotoRequestError("Invalid server response. Saved photos are retained; retry shortly.", 503);
  return data;
}
export async function uploadLegacyPhoto(photo: LegacyPhoto, signal: AbortSignal, progress: (value: string) => void) {
  const path = `/api/cleaner/jobs/${photo.jobId}/evidence/photos`;
  const post = async <T>(body: unknown): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await photoJson<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      } catch (error) {
        if (signal.aborted || attempt >= 1 || (error instanceof PhotoRequestError && error.status < 500 && error.status !== 429)) throw error;
      }
    }
  };
  type Saved = { path: string; url: string | null; roomKey: string };
  // A response lost after upload/acknowledgement is recovered before any bytes are resent.
  if (photo.receipt) {
    try { return await post<Saved>({ operation: "acknowledge", receipt: photo.receipt }); }
    catch (error) { if (!(error instanceof PhotoRequestError) || error.status !== 404) throw error; }
  }
  progress("Authorizing upload");
  const reservation = await post<UploadReservation & { receipt: string }>({
    operation: "reserve", uploadId: photo.uploadId, roomKey: photo.roomKey,
    byteSize: photo.blob.size, mime: photo.blob.type, sha256: photo.sha256, receipt: photo.receipt,
  });
  photo = { ...photo, receipt: reservation.receipt };
  // Retain only our job-bound receipt; signed Storage URL/token remain in memory.
  await saveLegacyPhoto(photo);
  try {
    return await post<Saved>({ operation: "acknowledge", receipt: photo.receipt });
  } catch (error) { if (!(error instanceof PhotoRequestError) || error.status !== 404) throw error; }
  try { await transferPhoto(photo.blob, reservation, value => progress(`${value}% uploaded`), signal); }
  catch { throw Error("Photo transfer interrupted. Your saved photo is retained; retry when connected."); }
  progress("Saving photo to job");
  return post<Saved>({ operation: "acknowledge", receipt: photo.receipt });
}
