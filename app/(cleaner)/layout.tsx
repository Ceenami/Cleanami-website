import { redirect } from "next/navigation";
import { db } from "@/db";
import { cleaners } from "@/db/schemas";
import { eq } from "drizzle-orm";
import {
  getCleanerOnboardingBannerMessage,
  isCleanerPortalUnlocked,
} from "@/lib/cleaner/eligibility";
import { CleanerLayoutShell } from "@/components/cleaner/CleanerLayoutShell";
import { CleanerRouteGuard } from "@/components/cleaner/CleanerRouteGuard";
import { getCleanerAuth } from "@/lib/cleaner-auth";
import { getSessionRole } from "@/lib/auth/server-roles";

export default async function CleanerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Authoritative role from the DB (`users.role`), not `user_metadata`.
  const userRole = await getSessionRole();
  if (userRole !== "cleaner") {
    redirect("/sign-in");
  }

  const { cleanerId } = await getCleanerAuth();
  const cleaner = cleanerId
    ? await db.query.cleaners.findFirst({
        where: eq(cleaners.id, cleanerId),
      })
    : null;

  const portalUnlocked = isCleanerPortalUnlocked(cleaner ?? null);
  const bannerMessage = getCleanerOnboardingBannerMessage(cleaner ?? null);

  return (
    <CleanerRouteGuard
      portalUnlocked={portalUnlocked}
      stripePayoutsEnabled={cleaner?.stripePayoutsEnabled ?? false}
    >
      <CleanerLayoutShell
        portalUnlocked={portalUnlocked}
        bannerMessage={bannerMessage}
      >
        {children}
      </CleanerLayoutShell>
    </CleanerRouteGuard>
  );
}
