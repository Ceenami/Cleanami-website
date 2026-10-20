import { Upload } from "tus-js-client";
import { createClient } from "@/lib/supabase/client";

export async function executionJson<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000),
    cache: "no-store",
  });
  const raw = await response.text();
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Error(
      `Server returned ${response.status}. Your local photos are retained; retry when connected.`,
    );
  }
  if (!response.ok)
    throw Error(value.error || `Request failed (${response.status})`);
  return value;
}
export async function photoHash(blob: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export type UploadReservation = {
  uploadId: string;
  path: string;
  verified: boolean;
  endpoint?: string;
  token?: string;
  bucket?: string;
};
export async function transferPhoto(
  blob: Blob,
  reservation: UploadReservation,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
) {
  if (reservation.verified) return;
  if (!reservation.endpoint || !reservation.token || !reservation.bucket)
    throw Error("Upload authorization missing");
  const {
    data: { session },
  } = await createClient().auth.getSession();
  if (!session?.access_token || signal.aborted)
    throw Error("Sign in again to resume this photo");
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(blob, {
      endpoint: reservation.endpoint,
      headers: {
        "x-signature": reservation.token!,
        authorization: `Bearer ${session.access_token}`,
      },
      metadata: {
        bucketName: reservation.bucket!,
        objectName: reservation.path,
        contentType: blob.type,
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      // Stable per-user/job/upload identity. Never persist signed credentials in the local queue.
      fingerprint: async () => `execution:${reservation.path}`,
      onProgress: (bytes, total) =>
        onProgress(Math.round((100 * bytes) / total)),
      onBeforeRequest: (request) => {
        if (signal.aborted) throw Error("Transfer paused");
        const underlying = request.getUnderlyingObject();
        if (underlying && "timeout" in underlying) underlying.timeout = 45000;
      },
      onError: (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
      onSuccess: () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
    });
    const abort = () => {
      signal.removeEventListener("abort", abort);
      void upload.abort();
      reject(Error("Transfer paused. Your photo is retained."));
    };
    signal.addEventListener("abort", abort, { once: true });
    void upload
      .findPreviousUploads()
      .then((previous) => {
        if (signal.aborted) return abort();
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch((error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      });
  });
}

export async function normalizePhoto(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source, {
    imageOrientation: "from-image",
  }).catch(() => {
    throw Error("This image cannot be decoded. Capture a new JPEG photo.");
  });
  try {
    const ratio = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.82, 0.74]) {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(Error("Image conversion failed"))),
          "image/jpeg",
          quality,
        ),
      );
      if (blob.size <= 3 * 1024 * 1024) return blob;
    }
    throw Error(
      "Photo remains too large after conversion. Retake with less detail or contact support.",
    );
  } finally {
    bitmap.close();
  }
}
