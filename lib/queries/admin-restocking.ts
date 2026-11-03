import "server-only";
import { db } from "@/db";
import {
  cleaners,
  jobs,
  properties,
  restockRequests as requests,
} from "@/db/schemas";
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { getAdminAuth } from "@/lib/admin-auth";
import {
  OPEN_RESTOCK_STATUSES,
  type RestockDetails,
  type RestockItem,
  type RestockSummary,
} from "@/lib/restocking/types";
import { z } from "zod";

export class RestockReadError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function requireAdmin(request?: Request) {
  if (!(await getAdminAuth(request)).isAdmin)
    throw new RestockReadError("Unauthorized", 401);
}
const open = inArray(requests.status, OPEN_RESTOCK_STATUSES);
const openCount = sql<number>`count(*) filter (where ${open})::int`;
const urgentCount = sql<number>`count(*) filter (where ${open} and ${requests.urgency} = 'urgent')::int`;

/** Aggregates only: individual request data is fetched when a property is opened. */
export async function getAdminRestockSummary(
  input: { query?: string; page?: number; includeResolved?: boolean } = {},
  request?: Request,
): Promise<RestockSummary> {
  await requireAdmin(request);
  const page = Math.min(500, Math.max(1, input.page ?? 1));
  const search = input.query
    ?.trim()
    .slice(0, 120)
    .replace(/[\\%_]/g, "\\$&");
  const grouped = db
    .select({
      propertyId: requests.propertyId,
      address: properties.address,
      openCount: openCount.as("open_count"),
      urgentCount: urgentCount.as("urgent_count"),
      totalCount: sql<number>`count(*)::int`.as("total_count"),
      latestRequestAt: sql<string>`max(${requests.createdAt})`.as(
        "latest_request_at",
      ),
    })
    .from(requests)
    .innerJoin(properties, eq(requests.propertyId, properties.id))
    .where(search ? ilike(properties.address, `%${search}%`) : undefined)
    .groupBy(requests.propertyId, properties.address)
    .having(input.includeResolved ? undefined : sql`${openCount} > 0`)
    .as("restock_properties");
  // Sequential: production transaction pooler cannot pipeline DB queries.
  const [totals] = await db
    .select({
      openCount: sql<number>`coalesce(sum(${grouped.openCount}), 0)::int`,
      propertyCount: sql<number>`count(*)::int`,
      urgentCount: sql<number>`coalesce(sum(${grouped.urgentCount}), 0)::int`,
      totalCount: sql<number>`coalesce(sum(${grouped.totalCount}), 0)::int`,
    })
    .from(grouped);
  const rows = await db
    .select()
    .from(grouped)
    .orderBy(
      desc(grouped.urgentCount),
      desc(grouped.latestRequestAt),
      asc(grouped.propertyId),
    )
    .limit(21)
    .offset((page - 1) * 20);
  return {
    properties: rows
      .slice(0, 20)
      .map((r) => ({
        ...r,
        latestRequestAt: new Date(r.latestRequestAt).toISOString(),
      })),
    totals,
    page,
    hasMore: rows.length > 20,
  };
}

const cursorSchema = z.object({ id: z.uuid(), at: z.iso.datetime() });
export function decodeRestockCursor(value?: string) {
  if (!value) return null;
  try {
    if (value.length > 256) throw Error();
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new RestockReadError("Invalid request cursor.", 400);
  }
}
export async function getAdminRestockProperty(
  propertyId: string,
  request?: Request,
) {
  await requireAdmin(request);
  const property = await db.query.properties.findFirst({
    where: eq(properties.id, propertyId),
    columns: { id: true, address: true },
  });
  if (!property) throw new RestockReadError("Property not found.", 404);
  return property;
}

export async function getAdminRestockCounts(
  input: { propertyId?: string; jobId?: string },
  request?: Request,
) {
  await requireAdmin(request);
  if (!!input.propertyId === !!input.jobId)
    throw new RestockReadError("Choose one property or job.", 400);
  const [counts] = await db
    .select({ openCount, totalCount: sql<number>`count(*)::int` })
    .from(requests)
    .where(
      input.propertyId
        ? eq(requests.propertyId, input.propertyId)
        : eq(requests.jobId, input.jobId!),
    );
  return counts;
}

export async function getAdminRestockDetails(
  input: {
    propertyId?: string;
    jobId?: string;
    includeResolved?: boolean;
    cursor?: string;
    requestId?: string;
  },
  request?: Request,
): Promise<RestockDetails> {
  await requireAdmin(request);
  if (!!input.propertyId === !!input.jobId)
    throw new RestockReadError("Choose one property or job.", 400);
  const scope = input.propertyId
    ? eq(requests.propertyId, input.propertyId)
    : eq(requests.jobId, input.jobId!);
  const cursor = decodeRestockCursor(input.cursor);
  const [counts] = await db
    .select({ openCount, totalCount: sql<number>`count(*)::int` })
    .from(requests)
    .where(scope);
  const selection = {
    id: requests.id,
    propertyId: requests.propertyId,
    jobId: requests.jobId,
    jobDate: jobs.checkInTime,
    cleanerName: cleaners.fullName,
    item: requests.item,
    quantity: requests.quantity,
    urgency: requests.urgency,
    notes: requests.notes,
    status: requests.status,
    adminNotes: requests.adminNotes,
    createdAt: requests.createdAt,
    resolvedAt: requests.resolvedAt,
    // Preserve PostgreSQL microseconds: a JS Date cursor would truncate them.
    cursorAt: sql<string>`to_char(${requests.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  };
  const rows = await db
    .select(selection)
    .from(requests)
    .leftJoin(jobs, eq(requests.jobId, jobs.id))
    .leftJoin(cleaners, eq(requests.cleanerId, cleaners.id))
    .where(
      and(
        scope,
        input.includeResolved ? undefined : open,
        cursor
          ? sql`(${requests.createdAt}, ${requests.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(requests.createdAt), desc(requests.id))
    .limit(21);
  const toItem = (r: (typeof rows)[number]): RestockItem => ({
    id: r.id,
    propertyId: r.propertyId,
    jobId: r.jobId,
    jobDate: r.jobDate?.toISOString() ?? null,
    cleanerName: r.cleanerName,
    item: r.item,
    quantity: r.quantity,
    urgency: r.urgency,
    notes: r.notes,
    status: r.status,
    adminNotes: r.adminNotes,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  });
  let focusedRequest: RestockItem | null = null;
  if (input.requestId) {
    const [focused] = await db
      .select(selection)
      .from(requests)
      .leftJoin(jobs, eq(requests.jobId, jobs.id))
      .leftJoin(cleaners, eq(requests.cleanerId, cleaners.id))
      .where(and(scope, eq(requests.id, input.requestId)))
      .limit(1);
    if (focused) focusedRequest = toItem(focused);
  }
  const page = rows.slice(0, 20),
    last = page.at(-1);
  return {
    ...counts,
    requests: page.map(toItem),
    focusedRequest,
    nextCursor:
      rows.length > 20 && last
        ? Buffer.from(
            JSON.stringify({ id: last.id, at: last.cursorAt }),
          ).toString("base64url")
        : null,
  };
}

/** Internal batch reader. Call only after the caller has authorized an admin view. */
export async function loadJobRestockCounts(jobIds: string[]) {
  if (!jobIds.length) return new Map<string, number>();
  const rows = await db
    .select({ jobId: requests.jobId, count: sql<number>`count(*)::int` })
    .from(requests)
    .where(and(inArray(requests.jobId, jobIds), open))
    .groupBy(requests.jobId);
  return new Map(rows.map((r) => [r.jobId!, r.count]));
}
