"use client";
/* eslint-disable @next/next/no-img-element -- Private signed evidence previews must bypass shared image optimization caches. */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  ImagePlus,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  checklistItems: {
    id: string;
    task: string;
    completed: boolean;
    section?: string;
  }[];
  checklistFiles: { id: string; fileName: string; url: string }[];
  cleanerNotes: string;
  photos: {
    uploadId: string;
    roomKey: string;
    path: string;
    state: string;
    source?: "camera" | "gallery";
    url: string | null;
    mine: boolean;
  }[];
};

const actionClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass = `${actionClass} bg-brand text-white hover:bg-brand/90`;
const secondaryClass = `${actionClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

function DevicePreview({
  photo,
  label,
}: {
  photo: LocalEvidencePhoto;
  label: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const preview = URL.createObjectURL(photo.blob);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [photo.blob]);
  return url ? (
    <img
      src={url}
      alt={`${label}, waiting to upload`}
      className="aspect-square w-full rounded-lg object-cover"
    />
  ) : null;
}

export function ExecutionEvidenceClient({ jobId }: { jobId: string }) {
  const path = `/api/cleaner/jobs/${jobId}/execution`;
  const [form, setForm] = useState<ExecutionForm | null>(null);
  const [photos, setPhotos] = useState<LocalEvidencePhoto[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"photos" | "checklist" | "finish">("photos");
  const [savedDraft, setSavedDraft] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [confirmDeparture, setConfirmDeparture] = useState(false);
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
  async function load(preserveEdits = false) {
    const data = await executionJson<ExecutionForm>(path);
    if (data.protocol !== "pre2c-hotfix-v1")
      throw Error("This job uses the existing evidence form");
    const keepEdits =
      preserveEdits &&
      form &&
      !data.isSubmitted &&
      savedDraft !== JSON.stringify([form.checklistItems, form.cleanerNotes]);
    setForm((current) =>
      keepEdits && current
        ? {
            ...data,
            checklistItems: current.checklistItems,
            cleanerNotes: current.cleanerNotes,
            revision: current.revision,
          }
        : data,
    );
    if (!keepEdits)
      setSavedDraft(JSON.stringify([data.checklistItems, data.cleanerNotes]));
    if (keepEdits && data.revision !== form.revision)
      setError(
        "Saved evidence changed in another session. Your edits are retained here. Reload the page to review the saved version before saving again.",
      );
    setPhotos(await localPhotos(data.queueOwner, jobId));
    return data;
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    void navigator.storage
      ?.persist?.()
      .then((granted) => {
        if (!granted) setStorageWarning(true);
      })
      .catch(() => setStorageWarning(true));
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
      const item: LocalEvidencePhoto = {
        uploadId: crypto.randomUUID(),
        owner: form.queueOwner,
        jobId,
        roomKey: room,
        source: "camera",
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
  async function choosePhotos(roomKey: string, files: File[]) {
    if (!form) return;
    const failures: string[] = [];
    for (const file of files) {
      try {
        const blob = await normalizePhoto(file);
        await putLocalPhoto({
          uploadId: crypto.randomUUID(),
          owner: form.queueOwner,
          jobId,
          roomKey,
          source: "gallery",
          capturedAt: null,
          blob,
          sha256: await photoHash(blob),
        });
      } catch (error) {
        failures.push(
          `${file.name}: ${error instanceof Error ? error.message : "Could not save photo"}`,
        );
      }
    }
    setPhotos(await localPhotos(form.queueOwner, jobId));
    if (failures.length)
      throw Error(
        `Some photos could not be saved. Other saved photos are retained. ${failures.join("; ")}`,
      );
    setMessage(
      "Selected photos saved on this device. Upload to save them to the job.",
    );
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
          source: photo.source ?? "camera",
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
  async function saveDraft() {
    if (!form) return;
    const saved = await executionJson<{ revision: number }>(path, {
      operation: "draft",
      revision: form.revision,
      items: form.checklistItems,
      notes: form.cleanerNotes,
    });
    setForm({ ...form, revision: saved.revision });
    setSavedDraft(JSON.stringify([form.checklistItems, form.cleanerNotes]));
    setMessage(
      "Checklist and notes saved to job. Device photos need upload separately.",
    );
  }

  if (!form)
    return (
      <div
        className="py-12 text-center text-sm text-slate-600"
        role={error ? "alert" : "status"}
      >
        {!error && (
          <Loader2
            className="mx-auto mb-3 size-6 animate-spin text-brand"
            aria-hidden="true"
          />
        )}
        {error || "Loading saved evidence..."}
      </div>
    );
  const verified = form.photos.filter((p) => p.state === "verified");
  const required = form.roomRequirements.reduce(
    (sum, r) => sum + r.minPhotos,
    0,
  );
  const requiredSaved = form.roomRequirements.reduce(
    (sum, r) =>
      sum +
      Math.min(
        r.minPhotos,
        verified.filter((p) => p.roomKey === r.roomKey).length,
      ),
    0,
  );
  const completed = form.checklistItems.filter((i) => i.completed).length;
  const dirty =
    savedDraft !== JSON.stringify([form.checklistItems, form.cleanerNotes]);
  const groups = [
    ...new Set(form.checklistItems.map((i) => i.section || "Cleaning tasks")),
  ];
  const pendingServer = form.photos.filter(
    (p) => p.state !== "verified",
  ).length;
  const ready =
    form.arrivalRecorded &&
    form.departureRecorded &&
    requiredSaved === required &&
    completed === form.checklistItems.length &&
    !photos.length &&
    !pendingServer;
  const steps = [
    {
      id: "photos",
      label: "Photos",
      detail: `${requiredSaved}/${required} required saved`,
      icon: Camera,
    },
    {
      id: "checklist",
      label: "Checklist",
      detail: `${completed}/${form.checklistItems.length} tasks checked`,
      icon: ClipboardCheck,
    },
    {
      id: "finish",
      label: "Finish",
      detail: form.departureRecorded
        ? "Departure recorded"
        : "Record departure & submit",
      icon: CheckCircle2,
    },
  ] as const;

  return (
    <div className="space-y-5 text-slate-900 sm:space-y-6">
      <Link
        href={`/cleaner/jobs/${jobId}`}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-slate-600 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to job
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Job evidence
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-5 text-slate-600 sm:leading-6">
            {form.isSubmitted
              ? "Final evidence submitted. Payment processing is pending."
              : "Add room photos, complete your checklist, then review and submit."}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-brand/5 px-3 py-2 text-xs font-semibold text-brand">
          {form.isSubmitted ? (
            <CheckCircle2 className="size-4" aria-hidden="true" />
          ) : (
            <Clock3 className="size-4" aria-hidden="true" />
          )}
          {form.isSubmitted
            ? "Submitted"
            : form.departureRecorded
              ? "Departure recorded"
              : form.arrivalRecorded
                ? "Visit in progress"
                : "Check-in needed"}
        </span>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
        >
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          className="flex gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-slate-700"
        >
          <Info
            className="mt-1 size-4 shrink-0 text-brand"
            aria-hidden="true"
          />
          {message}
        </div>
      )}
      {form.isSubmitted ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
          <CheckCircle2
            className="mb-4 size-10 text-brand"
            aria-hidden="true"
          />
          <h2 className="text-xl font-semibold">Evidence submitted</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Your final checklist, notes, and {verified.length} photos are saved.
            This submission is locked.
          </p>
          <Link
            href={`/cleaner/jobs/${jobId}`}
            className={cn(primaryClass, "mt-6")}
          >
            View job <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>
      ) : (
        <>
          <nav
            aria-label="Evidence sections"
            className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-white p-1.5"
          >
            {steps.map(({ id, label, detail, icon: Icon }, index) => (
              <button
                key={id}
                type="button"
                aria-pressed={step === id}
                disabled={!!room || busy}
                onClick={() => setStep(id)}
                className={cn(
                  "flex min-h-14 items-center justify-center gap-2 rounded-xl px-2 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 sm:min-h-16 sm:justify-start sm:px-4",
                  step === id
                    ? "bg-brand text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <Icon
                  className="hidden size-5 shrink-0 sm:block"
                  aria-hidden="true"
                />
                <span className="text-left">
                  <span className="block">
                    {index + 1}. {label}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 hidden text-xs font-normal sm:block",
                      step === id ? "text-white/85" : "text-slate-500",
                    )}
                  >
                    {detail}
                  </span>
                </span>
              </button>
            ))}
          </nav>
          {!form.arrivalRecorded && (
            <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              Check in at the property before adding photos.{" "}
              <Link
                className="font-semibold underline"
                href={`/cleaner/jobs/${jobId}`}
              >
                Go to check-in
              </Link>
            </p>
          )}
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0">
              {step === "photos" && (
                <section
                  id="evidence-photos"
                  aria-labelledby="photos-heading"
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  <div className="border-b border-slate-100 p-5 sm:p-6">
                    <h2 id="photos-heading" className="text-lg font-semibold">
                      Room photos
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {form.departureRecorded
                        ? "Choose existing photos or upload the photos saved on this device."
                        : "Take a photo or choose existing photos for each room."}
                    </p>
                    <p className="mt-3 text-sm font-medium text-brand">
                      {requiredSaved} of {required} required photos saved to job
                    </p>
                  </div>
                  {room && (
                    <div
                      className="border-b border-slate-100 bg-slate-50 p-5"
                      aria-label="Camera capture"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="font-semibold">
                          {
                            form.roomRequirements.find(
                              (r) => r.roomKey === room,
                            )?.label
                          }{" "}
                          camera
                        </h3>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={closeCamera}
                          aria-label="Close camera"
                          className={secondaryClass}
                        >
                          <X className="size-4" aria-hidden="true" />
                          Close
                        </button>
                      </div>
                      <video
                        ref={video}
                        autoPlay
                        playsInline
                        muted
                        onClick={() => void video.current?.play()}
                        className="max-h-96 w-full rounded-xl bg-slate-900 object-contain"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void capture()}
                        className={cn(primaryClass, "mt-3 w-full")}
                      >
                        <Camera className="size-4" aria-hidden="true" /> Capture
                        photo
                      </button>
                    </div>
                  )}
                  <div className="divide-y divide-slate-100">
                    {form.roomRequirements.map((r) => {
                      const saved = verified.filter(
                        (p) => p.roomKey === r.roomKey,
                      ).length;
                      const queued = photos.filter(
                        (p) => p.roomKey === r.roomKey,
                      );
                      const serverPhotos = form.photos.filter(
                        (p) =>
                          p.roomKey === r.roomKey &&
                          !queued.some((q) => q.uploadId === p.uploadId),
                      );
                      const met = saved >= r.minPhotos;
                      return (
                        <section
                          key={r.roomKey}
                          aria-label={r.label}
                          className="p-5 sm:p-6"
                        >
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                              <h3 className="font-semibold">{r.label}</h3>
                              <p className="mt-1 text-xs text-slate-500">
                                {r.minPhotos
                                  ? `${r.minPhotos} photo${r.minPhotos === 1 ? "" : "s"} required`
                                  : "Optional photos"}
                                {queued.length
                                  ? ` | ${queued.length} on this device`
                                  : ""}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                                r.minPhotos && met
                                  ? "bg-brand/5 text-brand"
                                  : "bg-slate-100 text-slate-600",
                              )}
                            >
                              {r.minPhotos && met ? (
                                <Check
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                              ) : null}
                              {saved} saved
                              {r.minPhotos ? ` / ${r.minPhotos}` : ""}
                            </span>
                          </div>
                          {form.arrivalRecorded && (
                            <div
                              className={cn(
                                "grid gap-2 sm:flex sm:flex-wrap",
                                !form.departureRecorded && "grid-cols-2",
                              )}
                            >
                              {!form.departureRecorded && (
                                <button
                                  type="button"
                                  disabled={busy || !!room}
                                  onClick={() => void openCamera(r.roomKey)}
                                  className={cn(
                                    primaryClass,
                                    "px-3 text-[13px] leading-5 sm:text-sm",
                                  )}
                                >
                                  <Camera
                                    className="size-4"
                                    aria-hidden="true"
                                  />
                                  Take photo
                                </button>
                              )}
                              <label
                                className={cn(
                                  secondaryClass,
                                  "relative cursor-pointer px-3 text-center text-[13px] leading-5 focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 sm:text-sm",
                                  (busy || !!room) &&
                                    "cursor-not-allowed opacity-50",
                                )}
                              >
                                <ImagePlus
                                  className="size-4"
                                  aria-hidden="true"
                                />{" "}
                                Choose existing photos
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  multiple
                                  aria-label={`Choose existing photos for ${r.label}`}
                                  className="sr-only"
                                  disabled={busy || !!room}
                                  onChange={(event) => {
                                    const files = Array.from(
                                      event.currentTarget.files ?? [],
                                    );
                                    event.currentTarget.value = "";
                                    if (files.length)
                                      void run(() =>
                                        choosePhotos(r.roomKey, files),
                                      );
                                  }}
                                />
                              </label>
                            </div>
                          )}
                          {(serverPhotos.length > 0 || queued.length > 0) && (
                            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                              {serverPhotos.map((p, index) => (
                                <div
                                  key={p.uploadId}
                                  className="min-w-0 rounded-xl bg-slate-50 p-2"
                                >
                                  {p.url ? (
                                    <a
                                      href={p.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                    >
                                      <img
                                        src={p.url}
                                        alt={`${r.label}, saved photo ${index + 1}`}
                                        className="aspect-square w-full rounded-lg object-cover"
                                      />
                                    </a>
                                  ) : (
                                    <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 p-2 text-center text-xs text-slate-500">
                                      {p.state === "verified"
                                        ? "Preview expired. Refresh to view."
                                        : "Upload pending"}
                                    </div>
                                  )}
                                  <p className="mt-2 text-xs font-medium text-slate-700">
                                    {p.state === "verified"
                                      ? "Saved to job"
                                      : "Upload pending"}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {p.source === "gallery"
                                      ? "Selected photo"
                                      : "Camera photo"}
                                  </p>
                                  {p.mine && (
                                    <button
                                      type="button"
                                      disabled={busy || !!room}
                                      onClick={() =>
                                        void run(async () => {
                                          await executionJson(path, {
                                            operation: "remove",
                                            uploadId: p.uploadId,
                                          });
                                          await deleteLocalPhoto(p.uploadId);
                                          await load(true);
                                        })
                                      }
                                      className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                                    >
                                      <Trash2
                                        className="size-3.5"
                                        aria-hidden="true"
                                      />
                                      Remove
                                      <span className="sr-only">
                                        {" "}
                                        {r.label} photo {index + 1}
                                      </span>
                                    </button>
                                  )}
                                </div>
                              ))}
                              {queued.map((p, index) => (
                                <div
                                  key={p.uploadId}
                                  className="min-w-0 rounded-xl border border-dashed border-slate-300 p-2"
                                >
                                  <DevicePreview
                                    photo={p}
                                    label={`${r.label} photo ${index + 1}`}
                                  />
                                  <p className="mt-2 text-xs font-medium text-slate-700">
                                    On this device
                                  </p>
                                  <p
                                    className="mt-1 break-words text-xs text-slate-500"
                                    role="status"
                                  >
                                    {progress[p.uploadId] ||
                                      "Waiting to upload"}
                                  </p>
                                  <button
                                    type="button"
                                    disabled={busy || !!room}
                                    onClick={() =>
                                      void run(async () => {
                                        if (
                                          form.photos.some(
                                            (s) => s.uploadId === p.uploadId,
                                          )
                                        ) {
                                          await executionJson(path, {
                                            operation: "remove",
                                            uploadId: p.uploadId,
                                          });
                                          setForm((current) =>
                                            current
                                              ? {
                                                  ...current,
                                                  photos: current.photos.filter(
                                                    (s) =>
                                                      s.uploadId !== p.uploadId,
                                                  ),
                                                }
                                              : current,
                                          );
                                        }
                                        await deleteLocalPhoto(p.uploadId);
                                        setPhotos(
                                          await localPhotos(
                                            form.queueOwner,
                                            jobId,
                                          ),
                                        );
                                      })
                                    }
                                    className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                                  >
                                    <Trash2
                                      className="size-3.5"
                                      aria-hidden="true"
                                    />
                                    Discard
                                    <span className="sr-only">
                                      {" "}
                                      {r.label} device photo {index + 1}
                                    </span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-5 sm:p-6">
                    <button
                      type="button"
                      disabled={busy || !!room || !photos.length}
                      onClick={() => void run(upload)}
                      className={primaryClass}
                    >
                      {busy ? (
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Upload className="size-4" aria-hidden="true" />
                      )}
                      Upload device photos
                      {photos.length ? ` (${photos.length})` : ""}
                    </button>
                    <button
                      type="button"
                      disabled={busy || !!room}
                      onClick={() => setStep("checklist")}
                      className={secondaryClass}
                    >
                      Continue to checklist{" "}
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </section>
              )}
              {step === "checklist" && (
                <section
                  id="evidence-checklist"
                  aria-labelledby="checklist-heading"
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  <div className="border-b border-slate-100 p-5 sm:p-6">
                    <h2
                      id="checklist-heading"
                      className="text-lg font-semibold"
                    >
                      Cleaning checklist
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      Check each task as you complete it. Save your checklist
                      and notes before leaving this page.
                    </p>
                    <p className="mt-3 text-sm font-medium text-brand">
                      {completed} of {form.checklistItems.length} tasks checked
                    </p>
                  </div>
                  {form.checklistFiles.length > 0 && (
                    <div className="space-y-2 border-b border-slate-100 p-5">
                      <h3 className="text-sm font-semibold">
                        Property instructions
                      </h3>
                      {form.checklistFiles.map((file) => (
                        <a
                          key={file.id}
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-brand underline underline-offset-4"
                        >
                          <ClipboardCheck
                            className="size-4 shrink-0"
                            aria-hidden="true"
                          />
                          {file.fileName}
                          <span className="sr-only"> (opens in new tab)</span>
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="divide-y divide-slate-100">
                    {groups.map((group, groupIndex) => {
                      const items = form.checklistItems.filter(
                        (i) => (i.section || "Cleaning tasks") === group,
                      );
                      return (
                        <details
                          key={group}
                          open={groupIndex === 0}
                          className="group"
                        >
                          <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:px-6 [&::-webkit-details-marker]:hidden">
                            <span className="flex-1 text-sm font-semibold">
                              {group.replace(/^Section \d+\s*-\s*/, "")}
                            </span>
                            <span className="text-xs tabular-nums text-slate-500">
                              {items.filter((i) => i.completed).length}/
                              {items.length}
                            </span>
                            <ChevronDown
                              className="size-4 text-slate-400 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                              aria-hidden="true"
                            />
                          </summary>
                          <fieldset className="space-y-1 px-3 pb-4 sm:px-4">
                            <legend className="sr-only">{group}</legend>
                            {items.map((item) => (
                              <label
                                key={item.id}
                                className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg px-2 py-3 text-sm leading-6 transition-colors hover:bg-slate-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand"
                              >
                                <input
                                  type="checkbox"
                                  disabled={busy}
                                  checked={item.completed}
                                  onChange={(e) =>
                                    setForm({
                                      ...form,
                                      checklistItems: form.checklistItems.map(
                                        (v) =>
                                          v.id === item.id
                                            ? {
                                                ...v,
                                                completed: e.target.checked,
                                              }
                                            : v,
                                      ),
                                    })
                                  }
                                  className="mt-0.5 size-5 shrink-0 cursor-pointer rounded border-slate-300 accent-brand"
                                />
                                <span
                                  className={
                                    item.completed
                                      ? "text-slate-500"
                                      : "text-slate-700"
                                  }
                                >
                                  {item.task}
                                </span>
                              </label>
                            ))}
                          </fieldset>
                        </details>
                      );
                    })}
                  </div>
                  <div className="border-t border-slate-100 p-5 sm:p-6">
                    <label
                      htmlFor="evidence-notes"
                      className="block text-sm font-semibold"
                    >
                      Notes and issues{" "}
                      <span className="font-normal text-slate-500">
                        (optional)
                      </span>
                    </label>
                    <p
                      id="notes-help"
                      className="mt-1 text-xs leading-5 text-slate-500"
                    >
                      Add anything the team should know about this clean.
                    </p>
                    <textarea
                      id="evidence-notes"
                      aria-describedby="notes-help"
                      rows={4}
                      maxLength={10000}
                      disabled={busy}
                      value={form.cleanerNotes}
                      onChange={(e) =>
                        setForm({ ...form, cleanerNotes: e.target.value })
                      }
                      className="mt-3 block w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-base leading-6 outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-5 sm:p-6">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(saveDraft)}
                      className={primaryClass}
                    >
                      <Save className="size-4" aria-hidden="true" />
                      Save checklist and notes
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setStep("finish")}
                      className={secondaryClass}
                    >
                      Review and finish
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </section>
              )}
              {step === "finish" && (
                <section
                  id="evidence-finish"
                  aria-labelledby="finish-heading"
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  <div className="border-b border-slate-100 p-5 sm:p-6">
                    <h2 id="finish-heading" className="text-lg font-semibold">
                      Review and finish
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      Record departure when you leave. Submit once your photos
                      and checklist are ready.
                    </p>
                  </div>
                  <div className="space-y-6 p-5 sm:p-6">
                    <div className="divide-y divide-slate-100">
                      <div className="flex items-center justify-between gap-4 py-4">
                        <div>
                          <p className="text-sm font-semibold">
                            Required room photos
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {requiredSaved}/{required} saved to job
                            {photos.length
                              ? ` | ${photos.length} waiting to upload`
                              : ""}
                            {pendingServer
                              ? ` | ${pendingServer} pending verification`
                              : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setStep("photos")}
                          className={secondaryClass}
                        >
                          View photos
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-4">
                        <div>
                          <p className="text-sm font-semibold">
                            Cleaning checklist
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {completed}/{form.checklistItems.length} tasks
                            checked
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setStep("checklist")}
                          className={secondaryClass}
                        >
                          View checklist
                        </button>
                      </div>
                      <div className="py-4">
                        <p className="text-sm font-semibold">
                          Notes and issues
                        </p>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-500">
                          {form.cleanerNotes || "No notes added."}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-4">
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        {form.departureRecorded ? (
                          <CheckCircle2
                            className="size-4 text-brand"
                            aria-hidden="true"
                          />
                        ) : (
                          <Clock3
                            className="size-4 text-slate-500"
                            aria-hidden="true"
                          />
                        )}
                        {form.departureRecorded
                          ? "Departure recorded"
                          : "Ready to leave the property?"}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {form.departureRecorded
                          ? "You can still choose existing photos and finish uploads before submitting."
                          : "Record your departure at the time you leave. New camera photos are unavailable after departure."}
                      </p>
                      {!form.departureRecorded &&
                        form.arrivalRecorded &&
                        (confirmDeparture ? (
                          <div className="mt-4 space-y-3">
                            <p className="text-sm font-medium">
                              Record your departure time now?
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    await executionJson(
                                      `/api/cleaner/jobs/${jobId}/check-out`,
                                      {},
                                    );
                                    setForm({
                                      ...form,
                                      departureRecorded: true,
                                    });
                                    setConfirmDeparture(false);
                                    setMessage(
                                      "Departure recorded. Finish uploads and submit final evidence when ready.",
                                    );
                                  })
                                }
                                className={primaryClass}
                              >
                                Confirm departure
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmDeparture(false)}
                                className={secondaryClass}
                              >
                                Keep working
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busy || !!room}
                            onClick={() => setConfirmDeparture(true)}
                            className={cn(secondaryClass, "mt-4")}
                          >
                            Record departure
                            <ArrowRight className="size-4" aria-hidden="true" />
                          </button>
                        ))}
                    </div>
                    <div>
                      <p className="mb-4 text-sm leading-6 text-slate-600">
                        Final submission locks this evidence. Your current
                        checklist and notes will be saved with it.
                      </p>
                      <button
                        type="button"
                        disabled={busy || !ready || !!room}
                        aria-describedby="submission-help"
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
                        className={cn(primaryClass, "w-full")}
                      >
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        Submit final evidence
                      </button>
                      <p
                        id="submission-help"
                        className="mt-3 text-xs leading-5 text-slate-500"
                      >
                        {ready
                          ? "Everything is ready for final submission."
                          : "Before submitting: record departure, check every task, and upload or remove all pending photos. Meet each room photo minimum."}
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </div>
            <aside
              aria-label="Evidence progress"
              className="space-y-5 lg:sticky lg:top-28"
            >
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold">Your progress</h2>
                <dl className="mt-4 space-y-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Required photos saved</dt>
                    <dd className="font-semibold tabular-nums">
                      {requiredSaved}/{required}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Checklist checked</dt>
                    <dd className="font-semibold tabular-nums">
                      {completed}/{form.checklistItems.length}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">On this device</dt>
                    <dd className="font-semibold tabular-nums">
                      {photos.length}
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="flex items-center gap-2 text-xs font-medium text-slate-600">
                    {busy ? (
                      <Loader2
                        className="size-4 animate-spin text-brand"
                        aria-hidden="true"
                      />
                    ) : (
                      <Save
                        className="size-4 text-slate-400"
                        aria-hidden="true"
                      />
                    )}
                    {busy
                      ? "Working... Keep this page open."
                      : dirty
                        ? "Checklist or notes have unsaved changes"
                        : "Checklist and notes match saved progress"}
                  </p>
                  <button
                    type="button"
                    disabled={busy || !!room}
                    onClick={() => void run(saveDraft)}
                    className={cn(secondaryClass, "mt-3 w-full")}
                  >
                    <Save className="size-4" aria-hidden="true" />
                    Save progress
                  </button>
                  {photos.length > 0 && (
                    <button
                      type="button"
                      disabled={busy || !!room}
                      onClick={() => void run(upload)}
                      className={cn(primaryClass, "mt-2 w-full")}
                    >
                      <Upload className="size-4" aria-hidden="true" />
                      Upload {photos.length} device photo
                      {photos.length === 1 ? "" : "s"}
                    </button>
                  )}
                </div>
              </div>
              <p className="flex gap-2 px-1 text-xs leading-5 text-slate-500">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {storageWarning
                  ? "Browser storage may be cleared by your device. Upload your photos while connected."
                  : "Photos on this device are waiting to upload. Only photos saved to the job count toward the requirements."}
              </p>
            </aside>
          </div>
        </>
      )}
      <button
        type="button"
        disabled={busy || !!room}
        onClick={() =>
          void run(async () => {
            await load(true);
            setMessage(
              "Saved progress and previews refreshed. Your checklist and notes edits are retained.",
            );
          })
        }
        className={cn(actionClass, "px-2 text-slate-500 hover:bg-slate-100")}
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Refresh saved progress
      </button>
    </div>
  );
}
