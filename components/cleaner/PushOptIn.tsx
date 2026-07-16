"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function PushOptIn() {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<"idle" | "enabling" | "enabled" | "error">(
    "idle"
  );
  const [message, setMessage] = useState<string | null>(null);

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        !!vapidKey
    );
  }, [vapidKey]);

  if (!supported) return null;

  const enable = async () => {
    setStatus("enabling");
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("idle");
        setMessage("Notifications permission was not granted.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey!),
      });
      const res = await fetch("/api/cleaner/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });
      if (!res.ok) throw new Error("Failed to register for notifications");
      setStatus("enabled");
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Could not enable notifications"
      );
    }
  };

  if (status === "enabled") {
    return (
      <p className="flex items-center gap-2 text-sm text-green-600">
        <Bell className="h-4 w-4" /> Push notifications enabled
      </p>
    );
  }

  return (
    <div>
      <button
        onClick={enable}
        disabled={status === "enabling"}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
      >
        <BellOff className="h-4 w-4" />
        {status === "enabling" ? "Enabling…" : "Enable push notifications"}
      </button>
      {message && <p className="mt-2 text-xs text-red-600">{message}</p>}
    </div>
  );
}
