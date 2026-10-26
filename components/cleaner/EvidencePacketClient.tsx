"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader,
  Upload,
  XCircle,
} from "lucide-react";
import {
  getRoomPhotoRequirements,
  type RoomPhotosMap,
} from "@/lib/cleaner/evidence";
import type { ChecklistItem } from "@/lib/constants/default-checklist";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { normalizePhoto, photoHash, photoJson, uploadLegacyPhoto } from "@/lib/cleaner/legacy-evidence-transfer";
import { deleteLegacyDraft, deleteLegacyPhoto, legacyDraft, legacyPhotos, saveLegacyDraft, saveLegacyPhoto, type LegacyPhoto, type LegacyDraft } from "@/lib/cleaner/legacy-evidence-queue";

type EvidenceFormData = {
  jobId: string;
  queueOwner: string;
  evidenceOpen: boolean;
  property: {
    bedCount: number;
    bathCount: string | number;
    hasHotTub: boolean;
    laundryType: string;
    useDefaultChecklist: boolean;
  };
  checklistFiles: { id: string; fileName: string; url: string }[];
  checklistItems: ChecklistItem[];
  // Object paths that get persisted on submit.
  roomPhotos: RoomPhotosMap;
  // Signed URLs, index-aligned with roomPhotos, for on-screen preview only.
  roomPhotoPreviews: RoomPhotosMap;
  cleanerNotes: string;
  isSubmitted: boolean;
};

export function EvidencePacketClient({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [formData, setFormData] = useState<EvidenceFormData | null>(null);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [roomPhotos, setRoomPhotos] = useState<RoomPhotosMap>({});
  const [roomPhotoPreviews, setRoomPhotoPreviews] = useState<RoomPhotosMap>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingRoom, setUploadingRoom] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 });
  const uploadInProgress = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const identityVersion = useRef(0);
  const savedPaths = useRef(new Set<string>());
  const [pendingPhotos, setPendingPhotos] = useState<LegacyPhoto[]>([]);
  const [photoStatus, setPhotoStatus] = useState<Record<string, string>>({});
  const [storageWarning, setStorageWarning] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const version = identityVersion.current;
    async function load() {
      try {
        const data = await photoJson<EvidenceFormData>(`/api/cleaner/jobs/${jobId}/evidence`);
        let draft: LegacyDraft | undefined;
        let photos: LegacyPhoto[] = [];
        try {
          draft = data.evidenceOpen ? await legacyDraft(data.queueOwner, jobId) : undefined;
          photos = await legacyPhotos(data.queueOwner, jobId);
        } catch { setStorageWarning("Device storage is unavailable. Keep this page open; photos cannot be retained here until storage is available."); }
        if (cancelled || version !== identityVersion.current) return;
        savedPaths.current = new Set(Object.values(data.roomPhotos).flat());
        setFormData(data);
        setChecklistItems(data.checklistItems.map(item => ({ ...item,
          completed: draft?.items.find(saved => saved.id === item.id)?.completed ?? item.completed,
        })));
        setRoomPhotos(data.roomPhotos);
        setRoomPhotoPreviews(data.roomPhotoPreviews ?? {});
        setNotes(draft?.notes ?? data.cleanerNotes);
        setPendingPhotos(photos);
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Could not load evidence form.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; controller.current?.abort(); };
  }, [jobId]);

  useEffect(() => {
    if (loading || !formData?.evidenceOpen) return;
    void saveLegacyDraft({ owner: formData.queueOwner, jobId, items: checklistItems, notes })
      .catch(() => setStorageWarning("Checklist changes could not be saved on this device. Keep this page open and retry."));
  }, [checklistItems, notes, loading, formData, jobId]);

  useEffect(() => {
    let account: string | null = null;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if (event === "SIGNED_OUT" || (account && account !== next)) {
        identityVersion.current++;
        controller.current?.abort();
        setFormData(null); setPendingPhotos([]); setRoomPhotos({}); setRoomPhotoPreviews({}); setChecklistItems([]); setNotes("");
        setError("Account changed. Sign back in to view this job. Saved photos remain with the original account.");
      }
      account = next;
    });
    return () => subscription.unsubscribe();
  }, []);

  const roomRequirements = useMemo(() => {
    if (!formData) return [];
    return getRoomPhotoRequirements(formData.property);
  }, [formData]);

  const allChecklistChecked = checklistItems.every((item) => item.completed);

  const checklistSections = useMemo(() => {
    const grouped = new Map<string, ChecklistItem[]>();
    for (const item of checklistItems) {
      const section = item.section ?? "Property checklist";
      grouped.set(section, [...(grouped.get(section) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [checklistItems]);

  const allPhotoMinimumsMet = roomRequirements.every(
    (req) => (roomPhotos[req.roomKey]?.length ?? 0) >= req.minPhotos
  );

  const canSubmit = formData?.evidenceOpen && allChecklistChecked && allPhotoMinimumsMet && !submitting && !uploadingRoom && pendingPhotos.length === 0;

  const toggleChecklistItem = (id: string) => {
    setChecklistItems((items) =>
      items.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    );
  };

  async function uploadPhotos(roomKey?: string, files: File[] = []) {
      if (uploadInProgress.current || !formData?.evidenceOpen) return;
      uploadInProgress.current = true;
      setUploadingRoom(roomKey ?? "retry");
      setUploadProgress({ completed: 0, total: files.length });
      setError(null);
      const failures: string[] = [];
      controller.current = new AbortController();
      const signal = controller.current.signal;
      try {
        // Persist compressed bytes before networking so a failed request/reload does not lose a selection.
        for (const file of files) {
          if (signal.aborted) throw Error("Upload paused. Saved photos are retained.");
          try {
            const blob = await normalizePhoto(file);
            await saveLegacyPhoto({ uploadId: crypto.randomUUID(), owner: formData.queueOwner, jobId,
              roomKey: roomKey!, fileName: file.name, blob, sha256: await photoHash(blob) });
          } catch (err) { failures.push(`${file.name}: ${err instanceof Error ? err.message : "Could not save photo on this device"}`); }
        }
        if (signal.aborted) throw Error("Upload paused. Saved photos are retained.");
        const queued = await legacyPhotos(formData.queueOwner, jobId);
        setPendingPhotos(queued);
        setUploadProgress({ completed: 0, total: queued.length });
        const current = await photoJson<EvidenceFormData>(`/api/cleaner/jobs/${jobId}/evidence`, { signal });
        if (current.queueOwner !== formData.queueOwner) throw Error("Account changed. Sign back in to upload these photos.");
        if (!current.evidenceOpen) throw Error("Evidence is not open for changes. Saved photos are retained.");
        for (const [index, photo] of queued.entries()) {
          if (signal.aborted) break;
          try {
            const data = await uploadLegacyPhoto(photo, signal, value => setPhotoStatus(prev => ({ ...prev, [photo.uploadId]: value })));
            if (signal.aborted) break;
            if (!savedPaths.current.has(data.path)) {
            savedPaths.current.add(data.path);
            setRoomPhotos((prev) => ({
              ...prev,
              [photo.roomKey]: [...new Set([...(prev[photo.roomKey] ?? []), data.path])],
            }));
            setRoomPhotoPreviews((prev) => ({
              ...prev,
              [photo.roomKey]: [...(prev[photo.roomKey] ?? []), data.url ?? ""],
            }));
            }
            await deleteLegacyPhoto(photo.uploadId);
            setPendingPhotos(await legacyPhotos(formData.queueOwner, jobId));
          } catch (err) {
            const message = err instanceof Error ? err.message : "Upload failed; retry";
            setPhotoStatus(prev => ({ ...prev, [photo.uploadId]: message }));
            failures.push(`${photo.fileName}: ${message}`);
          }
          setUploadProgress({ completed: index + 1, total: queued.length });
        }
      } catch (err) {
        failures.push(err instanceof Error ? err.message : "Upload paused; saved photos are retained.");
      } finally {
        uploadInProgress.current = false;
        setUploadingRoom(null);
      }
      if (failures.length > 0) {
        setError(`Some photos could not be uploaded. Saved photos are retained for retry. ${failures.join("; ")}`);
      }
  }

  const removePhoto = async (roomKey: string, index: number) => {
    if (!formData?.evidenceOpen || uploadInProgress.current) return;
    uploadInProgress.current = true; setUploadingRoom("remove"); setError(null);
    try {
    await photoJson(`/api/cleaner/jobs/${jobId}/evidence/photos`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "remove", path: roomPhotos[roomKey][index] }) });
    savedPaths.current.delete(roomPhotos[roomKey][index]);
    setRoomPhotos((prev) => ({
      ...prev,
      [roomKey]: (prev[roomKey] ?? []).filter((_, i) => i !== index),
    }));
    setRoomPhotoPreviews((prev) => ({
      ...prev,
      [roomKey]: (prev[roomKey] ?? []).filter((_, i) => i !== index),
    }));
    } catch (error) { setError(error instanceof Error ? error.message : "Photo could not be removed; retry."); }
    finally { uploadInProgress.current = false; setUploadingRoom(null); }
  };

  async function removePendingPhoto(photo: LegacyPhoto) {
    if (uploadInProgress.current || submitting) return;
    uploadInProgress.current = true; setUploadingRoom("remove-local");
    try {
      await deleteLegacyPhoto(photo.uploadId);
      setPendingPhotos(await legacyPhotos(photo.owner, jobId));
      setError(null);
    } catch { setError("Could not remove the saved photo; retry."); }
    finally { uploadInProgress.current = false; setUploadingRoom(null); }
  }

  async function handleSubmit() {
    if (!canSubmit || uploadInProgress.current) return;
    setSubmitting(true);
    setError(null);

    try {
      await photoJson(`/api/cleaner/jobs/${jobId}/evidence`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checklistLog: {
            items: checklistItems,
            roomPhotos,
          },
          cleanerNotes: notes || undefined,
        }),
      });

      await deleteLegacyDraft(formData!.queueOwner, jobId).catch(() => {});
      router.push(`/cleaner/jobs/${jobId}?evidenceSubmitted=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (error && !formData) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/cleaner/jobs/${jobId}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-brand"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to job
      </Link>

      <div>
        <h1 className="text-xl font-bold text-gray-900">Evidence packet</h1>
        <p className="text-sm text-gray-500">
          Complete the checklist and upload photos before checking out.
        </p>
      </div>

      {/* Checklist */}
      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Checklist</h2>
        {formData?.checklistFiles.length ? (
          <p className="mb-3 text-xs text-gray-500">
            Property guide:{" "}
            {formData.checklistFiles.map((f, i) => (
              <a
                key={f.id}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                {f.fileName}
                {i < formData.checklistFiles.length - 1 ? ", " : ""}
              </a>
            ))}
          </p>
        ) : null}

        {!allChecklistChecked && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            All items must be checked before submitting.
          </p>
        )}

        <div className="space-y-5">
          {checklistSections.map(([section, items]) => (
            <fieldset key={section}>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{section}</legend>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 px-3">
                {items.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-start gap-3 py-3">
                      <input type="checkbox" checked={item.completed} onChange={() => toggleChecklistItem(item.id)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand" />
                      <span className={cn("text-sm", item.completed ? "text-gray-500 line-through" : "text-gray-800")}>{item.task}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
        </div>
      </section>

      {/* Photos */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Photos by room</h2>
        {storageWarning && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{storageWarning}</p>}
        {!formData?.evidenceOpen && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Evidence is closed for changes. Photos saved on this device are retained.</p>}
        {pendingPhotos.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p>{pendingPhotos.length} photo{pendingPhotos.length === 1 ? "" : "s"} saved on this device, waiting to upload.</p>
            <button type="button" disabled={uploadingRoom !== null || submitting || !formData?.evidenceOpen}
              onClick={() => void uploadPhotos()} className="mt-2 font-semibold text-brand disabled:opacity-40">Retry saved photos</button>
          </div>
        )}
        {roomRequirements.map((req) => {
          const photos = roomPhotos[req.roomKey] ?? [];
          const previews = roomPhotoPreviews[req.roomKey] ?? [];
          // `minPhotos: 0` marks a room that is offered but never required.
          // It trivially satisfies `photos.length >= req.minPhotos`, so without
          // this it would render green and ticked while empty — reading as
          // "done" for something never asked for.
          const isOptional = req.minPhotos === 0;
          const met = photos.length >= req.minPhotos;
          const isUploading = uploadingRoom === req.roomKey;

          return (
            <div
              key={req.roomKey}
              className={cn(
                "rounded-xl border p-4",
                isOptional
                  ? "border-gray-200 bg-white"
                  : met
                  ? "border-green-200 bg-green-50/50"
                  : "border-gray-200 bg-white"
              )}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {req.label}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {isOptional
                      ? photos.length > 0
                        ? `${photos.length} photo${
                            photos.length === 1 ? "" : "s"
                          } — optional`
                        : "Optional"
                      : `${photos.length}/${req.minPhotos} photos minimum`}
                  </p>
                </div>
                {isOptional ? null : met ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
              </div>

              {photos.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {photos.map((path, index) => (
                    <div key={path} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {previews[index] ? <img
                        src={previews[index] ?? ""}
                        alt={`${req.label} ${index + 1}`}
                        className="h-16 w-16 rounded-lg object-cover"
                      /> : <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-gray-100 p-1 text-center text-xs">Photo saved</span>}
                      <button
                        type="button"
                        onClick={() => void removePhoto(req.roomKey, index)}
                        disabled={uploadingRoom !== null || submitting || !formData?.evidenceOpen}
                        className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white"
                        aria-label="Remove photo"
                      >
                        <Circle className="h-3 w-3 fill-current" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {pendingPhotos.filter(photo => photo.roomKey === req.roomKey).map(photo => (
                <div key={photo.uploadId} className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                  <p className="break-all">{photo.fileName}: {photoStatus[photo.uploadId] ?? "Saved on this device; waiting to upload"}</p>
                  <button type="button" disabled={uploadingRoom !== null || submitting}
                    onClick={() => void removePendingPhoto(photo)} className="mt-1 underline">Remove saved photo</button>
                </div>
              ))}

              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-3 text-sm font-medium text-gray-600 hover:border-brand hover:text-brand">
                <Upload className="h-4 w-4" />
                {isUploading
                  ? `Uploading ${uploadProgress.completed}/${uploadProgress.total} photos…`
                  : "Add photos"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  aria-label={`Add photos for ${req.label}`}
                  className="sr-only"
                  disabled={uploadingRoom !== null || submitting || !formData?.evidenceOpen}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length) void uploadPhotos(req.roomKey, files);
                  }}
                />
              </label>
            </div>
          );
        })}
      </section>

      {/* Notes */}
      <section className="rounded-xl border bg-white p-4">
        <label htmlFor="cleaner-notes" className="mb-2 block text-sm font-semibold text-gray-900">
          Notes (optional)
        </label>
        <textarea
          id="cleaner-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Damages, hazards, or other issues…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full rounded-lg bg-brand py-3 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Submitting…" : "Submit evidence packet"}
      </button>
    </div>
  );
}
