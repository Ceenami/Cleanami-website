"use client";
import { useEffect, useRef, useState } from "react";
export function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (file: File, capturedAt: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [capturing, setCapturing] = useState(false);
  useEffect(() => {
    let active = true,
      stream: MediaStream | undefined;
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1600 } },
        audio: false,
      })
      .then(async (value) => {
        stream = value;
        if (!active) {
          value.getTracks().forEach((t) => t.stop());
          return;
        }
        if (video.current) {
          video.current.srcObject = value;
          await video.current.play();
          setReady(true);
        }
      })
      .catch(() =>
        setError(
          "Camera access is required. Allow camera access in your browser settings.",
        ),
      );
    if (!navigator.mediaDevices)
      setError("Camera requires a secure browser connection.");
    return () => {
      active = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  async function capture() {
    if (!video.current || !ready || capturing) return;
    setCapturing(true);
    try {
      const capturedAt = new Date().toISOString(),
        canvas = document.createElement("canvas"),
        scale = Math.min(
          1,
          1600 / Math.max(video.current.videoWidth, video.current.videoHeight),
        );
      canvas.width = Math.round(video.current.videoWidth * scale);
      canvas.height = Math.round(video.current.videoHeight * scale);
      canvas
        .getContext("2d")!
        .drawImage(video.current, 0, 0, canvas.width, canvas.height);
      let blob: Blob | null = null;
      for (const quality of [0.8, 0.65, 0.5, 0.35]) {
        blob = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (blob && blob.size <= 2 * 1024 * 1024) break;
      }
      if (!blob || blob.size > 2 * 1024 * 1024)
        throw new Error("Photo is too large. Try another capture.");
      onCapture(
        new File([blob], "camera.jpg", { type: "image/jpeg" }),
        capturedAt,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setCapturing(false);
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Capture evidence photo"
    >
      <div className="bg-white rounded-lg p-4 max-w-xl w-full space-y-3">
        <video
          ref={video}
          playsInline
          muted
          className="w-full max-h-[60vh] bg-black"
        />
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <button
          className="bg-teal-700 text-white rounded px-4 py-2 mr-3"
          disabled={!ready || capturing}
          onClick={capture}
        >
          Capture photo
        </button>
        <button onClick={onClose}>Close camera</button>
      </div>
    </div>
  );
}
