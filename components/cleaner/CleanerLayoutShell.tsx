"use client";

import { usePathname } from "next/navigation";
import { CleanerBottomNav } from "@/components/cleaner/CleanerBottomNav";
import { CleanerHeader } from "@/components/cleaner/CleanerHeader";

export function CleanerLayoutShell({
  children,
  bannerMessage,
  portalUnlocked,
}: {
  children: React.ReactNode;
  bannerMessage: string | null;
  portalUnlocked: boolean;
}) {
  const pathname = usePathname();
  const onOnboardingRoute = pathname.startsWith("/cleaner/onboarding");

  return (
    <div className="min-h-screen bg-gray-50">
      <CleanerHeader />
      {bannerMessage && !onOnboardingRoute && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900">
          {bannerMessage}
        </div>
      )}
      <main className="mx-auto max-w-lg px-4 py-6 pb-24">{children}</main>
      {portalUnlocked && !onOnboardingRoute && <CleanerBottomNav />}
    </div>
  );
}
