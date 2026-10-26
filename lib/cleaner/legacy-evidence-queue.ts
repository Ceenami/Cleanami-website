export type LegacyPhoto = {
  uploadId: string; owner: string; jobId: string; roomKey: string;
  fileName: string; blob: Blob; sha256: string; receipt?: string;
};
export type LegacyDraft = {
  owner: string; jobId: string; items: { id: string; completed: boolean }[]; notes: string;
};
async function action<T>(store: "photos" | "drafts", mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("cleannami-legacy-evidence-v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("photos", { keyPath: "uploadId" }).createIndex("owner_job", ["owner", "jobId"]);
      request.result.createObjectStore("drafts", { keyPath: ["owner", "jobId"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("Close other evidence tabs and retry saving photos on this device."));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), request = run(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? Error("Could not save on this device. Keep this page open and retry."));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const saveLegacyPhoto = (photo: LegacyPhoto) => action("photos", "readwrite", s => s.put(photo));
export const deleteLegacyPhoto = (id: string) => action("photos", "readwrite", s => s.delete(id));
export const legacyPhotos = async (owner: string, jobId: string) =>
  await action("photos", "readonly", s => s.index("owner_job").getAll(IDBKeyRange.only([owner, jobId]))) as LegacyPhoto[];
export const saveLegacyDraft = (draft: LegacyDraft) => action("drafts", "readwrite", s => s.put(draft));
export const legacyDraft = async (owner: string, jobId: string) =>
  await action("drafts", "readonly", s => s.get([owner, jobId])) as LegacyDraft | undefined;
export const deleteLegacyDraft = (owner: string, jobId: string) => action("drafts", "readwrite", s => s.delete([owner, jobId]));
