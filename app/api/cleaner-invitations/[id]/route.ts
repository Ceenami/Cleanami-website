import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { db } from "@/db";
import { cleanerInvitations, users } from "@/db/schemas";
import { logCleanerAuditEvent } from "@/lib/queries/cleaner-invitations";
import { createClient } from "@/lib/supabase/server";
import { eq } from "drizzle-orm";

async function getAdminActorUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (typeof sub !== "string") return null;

  const dbUser = await db.query.users.findFirst({
    where: eq(users.supabaseUserId, sub),
    columns: { id: true },
  });
  return dbUser?.id ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin, error } = await getAdminAuth();
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const userId = await getAdminActorUserId();

  const { id } = await params;
  const body = (await request.json()) as { action?: "disable" | "enable" | "remove" };

  if (body.action === "remove") {
    const invitation = await db.query.cleanerInvitations.findFirst({
      where: eq(cleanerInvitations.id, id),
      columns: { id: true, email: true },
    });

    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }

    await logCleanerAuditEvent({
      action: "invitation_removed",
      invitationId: id,
      actorUserId: userId ?? undefined,
      metadata: { email: invitation.email },
    });

    await db.delete(cleanerInvitations).where(eq(cleanerInvitations.id, id));
    return NextResponse.json({ success: true });
  }

  if (body.action === "disable") {
    const now = new Date();
    await db
      .update(cleanerInvitations)
      .set({ status: "disabled", disabledAt: now, updatedAt: now })
      .where(eq(cleanerInvitations.id, id));
    await logCleanerAuditEvent({
      action: "invitation_disabled",
      invitationId: id,
      actorUserId: userId ?? undefined,
    });
    return NextResponse.json({ success: true });
  }

  if (body.action === "enable") {
    const now = new Date();
    await db
      .update(cleanerInvitations)
      .set({ status: "invited", disabledAt: null, updatedAt: now })
      .where(eq(cleanerInvitations.id, id));
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
