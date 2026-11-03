import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { properties } from "@/db/schemas";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAdminAuth } from "@/lib/admin-auth";
import { getCustomerAuth } from "@/lib/customer-auth";
import { getSessionIdentity } from "@/lib/auth/server-roles";
import {
  getPropertyChecklist,
  savePropertyChecklist,
} from "@/lib/services/property-checklists";
import { checklistDraftSchema } from "@/lib/checklists/rental-library";

async function access(request: NextRequest, id: string) {
  const admin = await getAdminAuth(request);
  if (admin.isAdmin && request.nextUrl.searchParams.get("ownerScope") !== "1")
    return { actorId: admin.actorId!, admin: true };
  const { customerId } = await getCustomerAuth();
  if (!customerId) return null;
  const property = await db.query.properties.findFirst({
    where: and(eq(properties.id, id), eq(properties.customerId, customerId)),
    columns: { id: true },
  });
  if (!property) return null;
  return {
    actorId: (await getSessionIdentity()).supabaseUserId!,
    admin: false,
  };
}
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: "Invalid property" }, { status: 400 });
  if (!(await access(request, id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await getPropertyChecklist(id));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unable to load" },
      { status: 400 },
    );
  }
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: "Invalid property" }, { status: 400 });
  const auth = await access(request, id);
  if (!auth) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = z
      .object({
        draft: checklistDraftSchema,
        expectedRevision: z.number().int().min(0),
        review: z
          .object({
            action: z.enum(["approve", "reject"]),
            reason: z.string().trim().min(3).max(500),
          })
          .optional(),
      })
      .strict()
      .parse(await request.json());
    if (body.review && !auth.admin)
      return NextResponse.json(
        { error: "Admin review required" },
        { status: 403 },
      );
    return NextResponse.json(
      await savePropertyChecklist(
        id,
        body.draft,
        body.expectedRevision,
        auth.actorId,
        body.review,
      ),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unable to save";
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("Version conflict") ? 409 : 400 },
    );
  }
}
