import "server-only";

import { db } from "@/db";
import {
  cleanerAuditLogs,
  cleanerInvitations,
  cleanerSignupAttempts,
  cleaners,
} from "@/db/schemas";
import { eq, or, sql } from "drizzle-orm";

export const CLEANER_SIGNUP_REJECTED_MESSAGE =
  "Your email has not been approved for cleaner onboarding. Please contact CleanNami.";

export async function logCleanerSignupAttempt(
  email: string,
  success: boolean,
  rejectionReason?: string
) {
  await db.insert(cleanerSignupAttempts).values({
    email: email.toLowerCase(),
    success,
    rejectionReason: rejectionReason ?? null,
  });
}

export async function logCleanerAuditEvent(input: {
  action: (typeof cleanerAuditLogs.$inferInsert)["action"];
  cleanerId?: string;
  invitationId?: string;
  actorUserId?: string;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(cleanerAuditLogs).values({
    action: input.action,
    cleanerId: input.cleanerId ?? null,
    invitationId: input.invitationId ?? null,
    actorUserId: input.actorUserId ?? null,
    metadata: input.metadata ?? {},
  });
}

export async function findApprovedCleanerInvitation(email: string) {
  return db.query.cleanerInvitations.findFirst({
    where: eq(cleanerInvitations.email, email.toLowerCase()),
  });
}

export async function assertCleanerEmailApproved(email: string): Promise<{
  approved: boolean;
  invitation: Awaited<ReturnType<typeof findApprovedCleanerInvitation>>;
}> {
  const invitation = await findApprovedCleanerInvitation(email);

  if (!invitation || invitation.status === "disabled") {
    await logCleanerSignupAttempt(
      email,
      false,
      invitation?.status === "disabled"
        ? "invitation_disabled"
        : "email_not_on_allowlist"
    );
    await logCleanerAuditEvent({
      action: "signup_rejected",
      invitationId: invitation?.id,
      metadata: { email: email.toLowerCase() },
    });
    return { approved: false, invitation };
  }

  return { approved: true, invitation };
}

export async function markInvitationSignedUp(
  invitationId: string,
  cleanerId: string
) {
  const now = new Date();
  await db
    .update(cleanerInvitations)
    .set({
      status: "signed_up",
      signedUpAt: now,
      updatedAt: now,
    })
    .where(eq(cleanerInvitations.id, invitationId));

  await logCleanerAuditEvent({
    action: "signup_succeeded",
    invitationId,
    cleanerId,
    metadata: {},
  });
}

export type InvitationDisplayStatus =
  | "Invited"
  | "Signed Up"
  | "Onboarding In Progress"
  | "Stripe Pending"
  | "Active"
  | "Suspended"
  | "Disabled";

export function deriveInvitationDisplayStatus(input: {
  invitationStatus: "invited" | "signed_up" | "disabled";
  cleaner?: {
    onboardingStarted: boolean;
    onboardingCompleted: boolean | null;
    accountStatus: "onboarding_in_progress" | "stripe_pending" | "active" | "suspended";
    stripePayoutsEnabled: boolean;
  } | null;
}): InvitationDisplayStatus {
  if (input.invitationStatus === "disabled") return "Disabled";
  if (!input.cleaner) return input.invitationStatus === "signed_up" ? "Signed Up" : "Invited";

  if (input.cleaner.accountStatus === "suspended") return "Suspended";
  if (
    input.cleaner.accountStatus === "active" &&
    input.cleaner.stripePayoutsEnabled
  ) {
    return "Active";
  }
  if (input.cleaner.accountStatus === "stripe_pending") return "Stripe Pending";
  if (input.cleaner.onboardingStarted && !input.cleaner.onboardingCompleted) {
    return "Onboarding In Progress";
  }
  if (input.invitationStatus === "signed_up") return "Signed Up";
  return "Invited";
}

export async function listCleanerInvitations() {
  const rows = await db
    .select({
      invitation: cleanerInvitations,
      cleaner: cleaners,
    })
    .from(cleanerInvitations)
    .leftJoin(
      cleaners,
      or(
        eq(cleaners.invitationId, cleanerInvitations.id),
        eq(cleaners.email, cleanerInvitations.email)
      )
    )
    .orderBy(sql`${cleanerInvitations.invitedAt} desc`);

  return rows.map(({ invitation, cleaner }) => ({
    ...invitation,
    cleanerId: cleaner?.id ?? null,
    displayStatus: deriveInvitationDisplayStatus({
      invitationStatus: invitation.status,
      cleaner: cleaner
        ? {
            onboardingStarted: cleaner.onboardingStarted,
            onboardingCompleted: cleaner.onboardingCompleted,
            accountStatus: cleaner.accountStatus,
            stripePayoutsEnabled: cleaner.stripePayoutsEnabled,
          }
        : null,
    }),
  }));
}
