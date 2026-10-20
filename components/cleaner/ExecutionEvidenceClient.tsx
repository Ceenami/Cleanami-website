"use client";
/* eslint-disable @next/next/no-img-element -- Private signed evidence previews must bypass shared image optimization caches. */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  executionJson,
  normalizePhoto,
  photoHash,
  transferPhoto,
  type UploadReservation,
} from "@/lib/cleaner/execution-transfer";
import {
  deleteLocalPhoto,
  localPhotos,
  putLocalPhoto,
  type LocalEvidencePhoto,
} from "@/lib/cleaner/execution-queue";

export type ExecutionForm = {
  protocol: string;
  queueOwner: string;
  jobId: string;
  revision: number;
  arrivalRecorded: boolean;
  departureRecorded: boolean;
  isSubmitted: boolean;
  finalEvidenceSubmittedAt: string | null;
  roomRequirements: { roomKey: string; label: string; minPhotos: number }[];
  checklistItems: { id: string; task: string; completed: boolean }[];
  checklistFiles: { id: string; fileName: string; url: string }[];
  cleanerNotes: string;
  photos: {
    uploadId: string;
    roomKey: string;
    path: string;
    state: string;
    url: string | null;
    mine: boolean;
  }[];
};
export function ExecutionEvidenceClient({ jobId }: { jobId: string }) {
  const path = `/api/cleaner/jobs/${jobId}/execution`;
  const [form, setForm] = useState<ExecutionForm | null>(null);
  const [photos, setPhotos] = useState<LocalEvidencePhoto[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [room, setRoom] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const controller = useRef<AbortController | null>(null);
  const closeCamera = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setRoom(null);
  };
  async function load() {
    const data = await executionJson<ExecutionForm>(path);
    if (data.protocol !== "pre2c-hotfix-v1")
      throw Error("This job uses the existing evidence form");
    setForm(data);
    setPhotos(await localPhotos(data.queueOwner, jobId));
    return data;
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    void navigator.storage?.persist?.().then((granted) => {
      if (!granted)
        setMessage(
          "Browser storage may be cleared by your device. Upload your photos while connected.",
        );
    });
    return () => {
      controller.current?.abort();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let account: string | null = null;
    const {
      data: { subscription },
    } = createClient().auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if (event === "SIGNED_OUT" || (account && next !== account))
        controller.current?.abort();
      account = next;
    });
    return () => subscription.unsubscribe();
  }, []);
  async function run(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Please retry; saved photos are retained.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function openCamera(roomKey: string) {
    await run(async () => {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      stream.current = next;
      setRoom(roomKey);
      // Rendering creates the video element; bind it on the next paint.
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = next;
          void video.current
            .play()
            .catch(() => setError("Tap the camera preview to start it"));
        }
      });
    });
  }
  async function capture() {
    await run(async () => {
      if (!form || !video.current || !room || !video.current.videoWidth)
        throw Error("Wait for the camera preview");
      const capturedAt = new Date().toISOString();
      const canvas = document.createElement("canvas");
      canvas.width = video.current.videoWidth;
      canvas.height = video.current.videoHeight;
      canvas.getContext("2d")!.drawImage(video.current, 0, 0);
      const source = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(Error("Could not capture photo"))),
          "image/jpeg",
          0.95,
        ),
      );
      const blob = await normalizePhoto(source);
      const item = {
        uploadId: crypto.randomUUID(),
        owner: form.queueOwner,
        jobId,
        roomKey: room,
        capturedAt,
        blob,
        sha256: await photoHash(blob),
      };
      // If storage/quota fails, leave the camera open and explain; never claim a durable save.
      await putLocalPhoto(item);
      setPhotos(await localPhotos(form.queueOwner, jobId));
      closeCamera();
      setMessage("Photo saved on this device. Upload to save it to the job.");
    });
  }
  async function upload() {
    if (!form) return;
    const identity = await executionJson<ExecutionForm>(path);
    if (identity.queueOwner !== form.queueOwner)
      throw Error("Account changed. Sign back in to upload these photos.");
    controller.current = new AbortController();
    for (const photo of await localPhotos(form.queueOwner, jobId)) {
      try {
        setProgress((p) => ({ ...p, [photo.uploadId]: "Authorizing" }));
        const reservation = await executionJson<UploadReservation>(path, {
          operation: "reserve",
          uploadId: photo.uploadId,
          roomKey: photo.roomKey,
          capturedAt: photo.capturedAt,
          byteSize: photo.blob.size,
          mime: photo.blob.type,
          sha256: photo.sha256,
        });
        // A lost response after transfer is recovered by checking storage before resending bytes.
        if (!reservation.verified) {
          try {
            await executionJson(path, {
              operation: "acknowledge",
              uploadId: photo.uploadId,
            });
          } catch {
            await transferPhoto(
              photo.blob,
              reservation,
              (n) => setProgress((p) => ({ ...p, [photo.uploadId]: `${n}%` })),
              controller.current.signal,
            );
          }
        }
        await executionJson(path, {
          operation: "acknowledge",
          uploadId: photo.uploadId,
        });
        await deleteLocalPhoto(photo.uploadId);
        setProgress((p) => ({ ...p, [photo.uploadId]: "Saved to job" }));
      } catch (e) {
        setProgress((p) => ({
          ...p,
          [photo.uploadId]:
            e instanceof Error ? e.message : "Upload failed; retry",
        }));
      }
    }
    // Preserve unsaved checklist edits while refreshing server photo membership.
    const data = await executionJson<ExecutionForm>(path);
    setForm((current) =>
      current ? { ...current, photos: data.photos } : data,
    );
    setPhotos(await localPhotos(form.queueOwner, jobId));
  }
  if (!form) return <p role="status">{error || "Loading saved evidence…"}</p>;
  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4">
      <Link href={`/cleaner/jobs/${jobId}`}>Back to job</Link>
      <h1 className="text-2xl font-semibold">Job evidence</h1>
      <p>
        {form.isSubmitted
          ? "Final evidence submitted. Payment processing is pending."
          : form.departureRecorded
            ? "Departure recorded. Upload photos captured during your visit, then submit final evidence."
            : "Save progress as you work. Record departure when you leave, then submit final evidence."}
      </p>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 p-3 text-red-700"
        >
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!form.isSubmitted && (
        <>
          {room && (
            <div className="space-y-2">
              <video
                ref={video}
                autoPlay
                playsInline
                muted
                onClick={() => void video.current?.play()}
                className="w-full rounded"
              />
              <button disabled={busy} onClick={() => void capture()}>
                Capture photo
              </button>{" "}
              <button onClick={closeCamera}>Close camera</button>
            </div>
          )}
          {form.roomRequirements.map((r) => (
            <section key={r.roomKey} className="space-y-2 rounded border p-3">
              <h2 className="font-semibold">
                {r.label} (
                {
                  form.photos.filter(
                    (p) => p.roomKey === r.roomKey && p.state === "verified",
                  ).length
                }
                /{r.minPhotos} required)
              </h2>
              {!form.departureRecorded && form.arrivalRecorded && (
                <button
                  disabled={busy || !!room}
                  onClick={() => void openCamera(r.roomKey)}
                >
                  Take photo
                </button>
              )}
              <div className="flex flex-wrap gap-2">
                {form.photos
                  .filter((p) => p.roomKey === r.roomKey)
                  .map((p) => (
                    <div key={p.uploadId}>
                      {p.url ? (
                        <img
                          src={p.url}
                          alt={r.label}
                          width={120}
                          height={120}
                        />
                      ) : (
                        <span>
                          {p.state === "verified"
                            ? "Saved photo — reload preview"
                            : "Upload pending"}
                        </span>
                      )}
                      {p.mine && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await executionJson(path, {
                                operation: "remove",
                                uploadId: p.uploadId,
                              });
                              await deleteLocalPhoto(p.uploadId);
                              await load();
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
              </div>
              {photos
                .filter((p) => p.roomKey === r.roomKey)
                .map((p) => (
                  <p key={p.uploadId}>
                    On this device:{" "}
                    {progress[p.uploadId] || "waiting to upload"}{" "}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          if (
                            form.photos.some((s) => s.uploadId === p.uploadId)
                          )
                            await executionJson(path, {
                              operation: "remove",
                              uploadId: p.uploadId,
                            });
                          await deleteLocalPhoto(p.uploadId);
                          setPhotos(await localPhotos(form.queueOwner, jobId));
                        })
                      }
                    >
                      Discard
                    </button>
                  </p>
                ))}
            </section>
          ))}
          <button
            disabled={busy || !photos.length}
            onClick={() => void run(upload)}
          >
            Upload device photos
          </button>
          {form.checklistFiles.map((file) => (
            <p key={file.id}>
              <a href={file.url} target="_blank" rel="noreferrer">
                {file.fileName}
              </a>
            </p>
          ))}
          {form.checklistItems.map((item, index) => (
            <label key={item.id} className="flex gap-2">
              <input
                type="checkbox"
                disabled={busy}
                checked={item.completed}
                onChange={(e) =>
                  setForm({
                    ...form,
                    checklistItems: form.checklistItems.map((v, i) =>
                      i === index ? { ...v, completed: e.target.checked } : v,
                    ),
                  })
                }
              />
              {item.task}
            </label>
          ))}
          <label className="block">
            Notes
            <textarea
              className="block w-full rounded border p-2"
              disabled={busy}
              value={form.cleanerNotes}
              onChange={(e) =>
                setForm({ ...form, cleanerNotes: e.target.value })
              }
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const saved = await executionJson<{ revision: number }>(
                    path,
                    {
                      operation: "draft",
                      revision: form.revision,
                      items: form.checklistItems,
                      notes: form.cleanerNotes,
                    },
                  );
                  setForm({ ...form, revision: saved.revision });
                  setMessage(
                    "Checklist and notes saved to job. Device photos need upload separately.",
                  );
                })
              }
            >
              Save checklist and notes
            </button>
            {!form.departureRecorded && form.arrivalRecorded && (
              <button
                disabled={busy || !!room}
                onClick={() =>
                  void run(async () => {
                    await executionJson(
                      `/api/cleaner/jobs/${jobId}/check-out`,
                      {},
                    );
                    setForm({ ...form, departureRecorded: true });
                    setMessage(
                      "Departure recorded. Finish uploads and submit final evidence when ready.",
                    );
                  })
                }
              >
                Record departure
              </button>
            )}
            {form.departureRecorded && (
              <button
                disabled={busy || photos.length > 0 || !!room}
                onClick={() =>
                  void run(async () => {
                    await executionJson(path, {
                      operation: "finalize",
                      revision: form.revision,
                      items: form.checklistItems,
                      notes: form.cleanerNotes,
                    });
                    await load();
                  })
                }
              >
                Submit final evidence
              </button>
            )}
          </div>
        </>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await load();
          })
        }
      >
        Reload saved progress / previews
      </button>
    </div>
  );
}
