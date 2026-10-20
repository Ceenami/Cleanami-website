export type LocalEvidencePhoto = {
  uploadId: string;
  owner: string;
  jobId: string;
  roomKey: string;
  capturedAt: string;
  blob: Blob;
  sha256: string;
};
const STORE = "photos";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cleannami-execution-v1", 2);
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : request.result.createObjectStore(STORE, { keyPath: "uploadId" });
      if (!store.indexNames.contains("owner_job"))
        store.createIndex("owner_job", ["owner", "jobId"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function action<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () =>
        reject(tx.error || Error("Local save failed; keep this screen open"));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const putLocalPhoto = (photo: LocalEvidencePhoto) =>
  action("readwrite", (store) => store.put(photo));
export async function localPhotos(owner: string, jobId: string) {
  return (await action("readonly", (s) =>
    s.index("owner_job").getAll(IDBKeyRange.only([owner, jobId])),
  )) as LocalEvidencePhoto[];
}
export const deleteLocalPhoto = (id: string) =>
  action("readwrite", (s) => s.delete(id));
