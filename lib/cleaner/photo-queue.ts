/** Device-local, durable upload queue. Never replace the camera capture instant. */
export type PendingPhoto = {
  id: string;
  scope: string;
  jobId: string;
  roomKey: string;
  capturedAt: string;
  file: Blob;
  error?: string;
  reportRevision?: number;
  reportState?: "pending" | "failed" | "discarded";
  reportIssue?: "upload_failed" | "draft_save_failed" | null;
};
function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cleannami-evidence-v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("photos", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function queuePhoto(photo: PendingPhoto) {
  const db = await openQueue();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("photos", "readwrite");
      tx.objectStore("photos").put(photo);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function queuedPhotos(
  scope: string,
  jobId: string,
): Promise<PendingPhoto[]> {
  const db = await openQueue();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readonly"),
        request = tx.objectStore("photos").getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as PendingPhoto[]).filter(
            (row) => row.scope === scope && row.jobId === jobId,
          ),
        );
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function removeQueuedPhoto(id: string) {
  const db = await openQueue();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("photos", "readwrite");
      tx.objectStore("photos").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
