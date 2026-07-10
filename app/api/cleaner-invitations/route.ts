import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { db } from "@/db";
import { cleanerInvitations, users } from "@/db/schemas";
import {
  listCleanerInvitations,
  logCleanerAuditEvent,
} from "@/lib/queries/cleaner-invitations";
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

export async function GET() {
  const { isAdmin, error } = await getAdminAuth();
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const invitations = await listCleanerInvitations();
  const attempts = await db.query.cleanerSignupAttempts.findMany({
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    limit: 50,
  });

  return NextResponse.json({ invitations, signupAttempts: attempts });
}

export async function POST(request: NextRequest) {
  const { isAdmin, error } = await getAdminAuth();
  if (!isAdmin) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const userId = await getAdminActorUserId();

  const body = (await request.json()) as { email?: string; notes?: string };
  const email = body.email?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const [invitation] = await db
    .insert(cleanerInvitations)
    .values({
      email,
      notes: body.notes ?? null,
      invitedBy: userId,
    })
    .onConflictDoUpdate({
      target: cleanerInvitations.email,
      set: {
        status: "invited",
        disabledAt: null,
        notes: body.notes ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  await logCleanerAuditEvent({
    action: "invitation_created",
    invitationId: invitation.id,
    actorUserId: userId ?? undefined,
    metadata: { email },
  });

  return NextResponse.json({ invitation });
}
