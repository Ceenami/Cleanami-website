"use client";

import { useEffect } from "react";

export function StripeConnectReturnClient({
  stripeStatus,
}: {
  stripeStatus: "complete" | "refresh";
}) {
  useEffect(() => {
    const destination = `/cleaner/onboarding?stripe=${stripeStatus}`;

    if (window.top !== window.self) {
      window.top!.location.href = `${window.location.origin}${destination}`;
      return;
    }

    window.location.replace(destination);
  }, [stripeStatus]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <p className="text-sm text-gray-600">Returning to CleanNami…</p>
    </div>
  );
}
