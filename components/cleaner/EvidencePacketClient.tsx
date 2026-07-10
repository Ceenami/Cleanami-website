"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type EvidenceFormData = {
  jobId: string;
  property: {
    bedCount: number;
    bathCount: string | number;
    hasHotTub: boolean;
    useDefaultChecklist: boolean;
  };
  checklistFiles: { id: string; fileName: string; url: string }[];
  checklistItems: ChecklistItem[];
  roomPhotos: RoomPhotosMap;
  cleanerNotes: string;
  isSubmitted: boolean;
};

export function EvidencePacketClient({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [formData, setFormData] = useState<EvidenceFormData | null>(null);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [roomPhotos, setRoomPhotos] = useState<RoomPhotosMap>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingRoom, setUploadingRoom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/cleaner/jobs/${jobId}/evidence`);
        if (!response.ok) throw new Error("Failed to load");
        const data = (await response.json()) as EvidenceFormData;
        setFormData(data);
        setChecklistItems(data.checklistItems);
        setRoomPhotos(data.roomPhotos);
        setNotes(data.cleanerNotes);
      } catch {
        setError("Could not load evidence form.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [jobId]);

  const roomRequirements = useMemo(() => {
    if (!formData) return [];
    return getRoomPhotoRequirements(formData.property);
  }, [formData]);

  const allChecklistChecked = checklistItems.every((item) => item.completed);

  const allPhotoMinimumsMet = roomRequirements.every(
    (req) => (roomPhotos[req.roomKey]?.length ?? 0) >= req.minPhotos
  );

  const canSubmit = allChecklistChecked && allPhotoMinimumsMet && !submitting;

  const toggleChecklistItem = (id: string) => {
    setChecklistItems((items) =>
      items.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    );
  };

  const uploadPhoto = useCallback(
    async (roomKey: string, file: File) => {
      setUploadingRoom(roomKey);
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("roomKey", roomKey);

        const response = await fetch(
          `/api/cleaner/jobs/${jobId}/evidence/upload`,
          { method: "POST", body }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Upload failed");

        setRoomPhotos((prev) => ({
          ...prev,
          [roomKey]: [...(prev[roomKey] ?? []), data.url as string],
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploadingRoom(null);
      }
    },
    [jobId]
  );

  const removePhoto = (roomKey: string, index: number) => {
    setRoomPhotos((prev) => ({
      ...prev,
      [roomKey]: (prev[roomKey] ?? []).filter((_, i) => i !== index),
    }));
  };

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/cleaner/jobs/${jobId}/evidence`, {
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

      const data = await response.json();
      if (!response.ok) {
        const missing = data.missing?.join(", ");
        throw new Error(
          missing ? `${data.error}: ${missing}` : (data.error ?? "Submit failed")
        );
      }

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

        <ul className="divide-y divide-gray-100">
          {checklistItems.map((item) => (
            <li key={item.id}>
              <label className="flex cursor-pointer items-start gap-3 py-3">
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={() => toggleChecklistItem(item.id)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
                />
                <span
                  className={cn(
                    "text-sm",
                    item.completed
                      ? "text-gray-500 line-through"
                      : "text-gray-800"
                  )}
                >
                  {item.task}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {/* Photos */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Photos by room</h2>
        {roomRequirements.map((req) => {
          const photos = roomPhotos[req.roomKey] ?? [];
          const met = photos.length >= req.minPhotos;
          const isUploading = uploadingRoom === req.roomKey;

          return (
            <div
              key={req.roomKey}
              className={cn(
                "rounded-xl border p-4",
                met ? "border-green-200 bg-green-50/50" : "border-gray-200 bg-white"
              )}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {req.label}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {photos.length}/{req.minPhotos} photos minimum
                  </p>
                </div>
                {met ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
              </div>

              {photos.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {photos.map((url, index) => (
                    <div key={url} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`${req.label} ${index + 1}`}
                        className="h-16 w-16 rounded-lg object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(req.roomKey, index)}
                        className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white"
                        aria-label="Remove photo"
                      >
                        <Circle className="h-3 w-3 fill-current" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 py-3 text-sm font-medium text-gray-600 hover:border-brand hover:text-brand">
                <Upload className="h-4 w-4" />
                {isUploading ? "Uploading…" : "Add photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={isUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadPhoto(req.roomKey, file);
                    e.target.value = "";
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
