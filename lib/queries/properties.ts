
import 'server-only';
import { db, sequentialQueries } from '@/db';
import { properties, customers, subscriptions, jobs, checklistFiles } from '@/db/schemas';
import { eq, sql, and } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { geocodeAddress } from '@/lib/services/google-maps/geocoding';
import {
  PaginationParams,
  SearchParams,
  buildPaginatedResponse,
  buildSearchCondition,
  getPaginationOffset,
  ordering,
} from './utils/queryBuilder';

interface GetPropertiesParams extends PaginationParams, SearchParams {
  customerId?: string;
}

export async function getPropertiesWithOwner({
  page = 1,
  limit = 10,
  query = '',
  customerId,
}: GetPropertiesParams) {
  const offset = getPaginationOffset(page, limit);

  const data = await db
    .select({
      id: properties.id,
      customerId: properties.customerId,
      address: properties.address,
      sqFt: properties.sqFt,
      bedCount: properties.bedCount,
      bathCount: properties.bathCount,
      hasHotTub: properties.hasHotTub,
      laundryType: properties.laundryType,
      laundryLoads: properties.laundryLoads,
      iCalUrl: properties.iCalUrl,
      createdAt: properties.createdAt,
      updatedAt: properties.updatedAt,

      customer: {
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
      },

      activeSubscription: sql<{
        id: string;
        status: string;
        durationMonths: number;
        startDate: string;
      } | null>`(
        SELECT json_build_object(
          'id', ${subscriptions.id},
          'status', ${subscriptions.status},
          'durationMonths', ${subscriptions.durationMonths},
          'startDate', ${subscriptions.startDate}
        )
        FROM ${subscriptions}
        WHERE ${subscriptions.propertyId} = ${properties.id}
        AND ${subscriptions.status} = 'active'
        ORDER BY ${subscriptions.createdAt} DESC
        LIMIT 1
      )`.as('active_subscription'),

      nextJob: sql<{
        id: string;
        checkInTime: string;
        status: string;
      } | null>`(
        SELECT json_build_object(
          'id', ${jobs.id},
          'checkInTime', ${jobs.checkInTime},
          'status', ${jobs.status}
        )
        FROM ${jobs}
        WHERE ${jobs.propertyId} = ${properties.id}
        AND ${jobs.status} NOT IN ('completed', 'canceled')
        AND ${jobs.checkInTime} > NOW()
        ORDER BY ${jobs.checkInTime} ASC
        LIMIT 1
      )`.as('next_job'),

      totalJobs: sql<number>`(
        SELECT CAST(COUNT(*) AS INTEGER)
        FROM ${jobs}
        WHERE ${jobs.propertyId} = ${properties.id}
      )`.as('total_jobs'),

      completedJobs: sql<number>`(
        SELECT CAST(COUNT(*) AS INTEGER)
        FROM ${jobs}
        WHERE ${jobs.propertyId} = ${properties.id}
        AND ${jobs.status} = 'completed'
      )`.as('completed_jobs'),
    })
    .from(properties)
    .leftJoin(customers, eq(properties.customerId, customers.id))
    .where(
      and(
        customerId ? eq(properties.customerId, customerId) : undefined,
        buildSearchCondition(query, [properties.address, customers.name, customers.email, customers.phone])
      )
    )
    .orderBy(ordering.createdAtDesc(properties))
    .limit(limit)
    .offset(offset);

  return buildPaginatedResponse(data, page, limit);
}

export type PropertiesWithOwner = Awaited<ReturnType<typeof getPropertiesWithOwner>>;

export async function getPropertyDetails(propertyId: string) {
  const property = await db.query.properties.findFirst({
    where: eq(properties.id, propertyId),
    with: {
      customer: true,

      subscriptions: {
        orderBy: (subscriptions, { desc }) => [desc(subscriptions.createdAt)],
        with: {
          jobs: {
            orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
            limit: 5,
            with: {
              cleaners: {
                with: {
                  cleaner: {
                    columns: {
                      fullName: true,
                    },
                  },
                },
              },
              evidencePacket: {
                columns: {
                  status: true,
                  isChecklistComplete: true,
                },
              },
            },
          },
        },
      },

      checklistFiles: {
        orderBy: (files, { desc }) => [desc(files.createdAt)],
      },
    },
  });

  if (!property) {
    notFound();
  }

  const activeSubscription = property.subscriptions.find((s) => s.status === 'active');

  const allJobs = property.subscriptions.flatMap((sub) => sub.jobs);

  const now = new Date();
  const upcomingJobs = allJobs
    .filter(
      (j) =>
        j.checkInTime &&
        new Date(j.checkInTime) > now &&
        j.status !== "completed" &&
        j.status !== "canceled"
    )
    .sort(
      (a, b) =>
        new Date(a.checkInTime!).getTime() - new Date(b.checkInTime!).getTime()
    );

  return {
    ...property,
    activeSubscription: activeSubscription || null,
    nextJob: upcomingJobs[0] || null,
    upcomingJobs: upcomingJobs.slice(0, 5),
    recentJobs: allJobs
      .filter((j) => j.status === 'completed')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10),
    totalJobs: allJobs.length,
    completedJobs: allJobs.filter((j) => j.status === 'completed').length,
  };
}

export type PropertyDetails = Awaited<ReturnType<typeof getPropertyDetails>>;

export type MergePropertiesResult = {
  sourcePropertyId: string;
  targetPropertyId: string;
  jobsMoved: number;
  subscriptionsMoved: number;
  checklistFilesMoved: number;
};

export async function mergeProperties(
  sourcePropertyId: string,
  targetPropertyId: string
): Promise<MergePropertiesResult> {
  if (sourcePropertyId === targetPropertyId) {
    throw new Error("Source and target property must be different");
  }

  // Sequential, not `Promise.all` — see `sequentialQueries` in db/index.ts.
  const [source, target] = await sequentialQueries(
    () => db.query.properties.findFirst({ where: eq(properties.id, sourcePropertyId) }),
    () => db.query.properties.findFirst({ where: eq(properties.id, targetPropertyId) })
  );

  if (!source || !target) {
    throw new Error("Property not found");
  }

  if (source.customerId !== target.customerId) {
    throw new Error("Properties must belong to the same customer to merge");
  }

  return db.transaction(async (tx) => {
    const movedJobs = await tx
      .update(jobs)
      .set({ propertyId: targetPropertyId, updatedAt: new Date() })
      .where(eq(jobs.propertyId, sourcePropertyId))
      .returning({ id: jobs.id });

    const movedSubscriptions = await tx
      .update(subscriptions)
      .set({ propertyId: targetPropertyId, updatedAt: new Date() })
      .where(eq(subscriptions.propertyId, sourcePropertyId))
      .returning({ id: subscriptions.id });

    const movedChecklists = await tx
      .update(checklistFiles)
      .set({ propertyId: targetPropertyId })
      .where(eq(checklistFiles.propertyId, sourcePropertyId))
      .returning({ id: checklistFiles.id });

    await tx
      .delete(properties)
      .where(
        and(
          eq(properties.id, sourcePropertyId),
          eq(properties.customerId, source.customerId)
        )
      );

    return {
      sourcePropertyId,
      targetPropertyId,
      jobsMoved: movedJobs.length,
      subscriptionsMoved: movedSubscriptions.length,
      checklistFilesMoved: movedChecklists.length,
    };
  });
}

/** Allowlist of property fields an admin may edit. Anything not here is ignored. */
export type UpdatePropertyInput = {
  address?: string;
  sqFt?: number | null;
  bedCount?: number;
  bathCount?: string; // numeric column -> string in Drizzle
  hasHotTub?: boolean;
  laundryType?: "in_unit" | "off_site" | "none";
  laundryLoads?: number | null;
  hotTubServiceLevel?: boolean;
  hotTubDrain?: boolean;
  hotTubDrainCadence?:
    | "4_weeks"
    | "6_weeks"
    | "2_months"
    | "3_months"
    | "4_months"
    | null;
  iCalUrl?: string | null;
  defaultCheckInTime?: string;
  defaultCheckOutTime?: string;
  priceOverrideCents?: number | null;
  /** Check-in fence in metres (50-1000); null restores the system default. */
  geofenceRadiusMeters?: number | null;
};

export async function updateProperty(
  propertyId: string,
  input: UpdatePropertyInput
): Promise<{ propertyId: string }> {
  const existing = await db.query.properties.findFirst({
    where: eq(properties.id, propertyId),
    columns: { id: true, address: true },
  });
  if (!existing) {
    throw new Error("Property not found");
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const editableKeys: (keyof UpdatePropertyInput)[] = [
    "address",
    "sqFt",
    "bedCount",
    "bathCount",
    "hasHotTub",
    "laundryType",
    "laundryLoads",
    "hotTubServiceLevel",
    "hotTubDrain",
    "hotTubDrainCadence",
    "iCalUrl",
    "defaultCheckInTime",
    "defaultCheckOutTime",
    "priceOverrideCents",
    "geofenceRadiusMeters",
  ];
  for (const key of editableKeys) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  // If the address changed, clear the stale geocode so it re-geocodes on next use.
  if (
    typeof input.address === "string" &&
    input.address.trim() !== existing.address
  ) {
    patch.latitude = null;
    patch.longitude = null;
    patch.geocodedAt = null;
  }

  await db.update(properties).set(patch).where(eq(properties.id, propertyId));
  return { propertyId };
}

export type DeletePropertyResult = {
  propertyId: string;
  address: string;
};

export async function deleteProperty(
  propertyId: string
): Promise<DeletePropertyResult> {
  const property = await db.query.properties.findFirst({
    where: eq(properties.id, propertyId),
    columns: { id: true, address: true, customerId: true },
  });

  if (!property) {
    throw new Error("Property not found");
  }

  const linkedJobs = await db.query.jobs.findFirst({
    where: eq(jobs.propertyId, propertyId),
    columns: { id: true },
  });

  if (linkedJobs) {
    throw new Error(
      "This property has cleaning history and cannot be deleted. Merge it into the correct address instead."
    );
  }

  const activeSubscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.propertyId, propertyId),
      eq(subscriptions.status, "active")
    ),
    columns: { id: true },
  });

  if (activeSubscription) {
    throw new Error(
      "This property has an active subscription. Cancel the subscription first, or merge this property into the correct one."
    );
  }

  await db.delete(properties).where(eq(properties.id, propertyId));

  return {
    propertyId,
    address: property.address,
  };
}

/** Fields accepted when creating a property. `customerId` is set by the caller
 * from the authenticated session, never from the request body. */
export type CreatePropertyInput = {
  customerId: string;
  address: string;
  bedCount: number;
  bathCount: string; // numeric column -> string in Drizzle
  sqFt?: number | null;
  hasHotTub?: boolean;
  laundryType: "in_unit" | "off_site" | "none";
  laundryLoads?: number | null;
  hotTubServiceLevel?: boolean;
  hotTubDrain?: boolean;
  hotTubDrainCadence?:
    | "4_weeks"
    | "6_weeks"
    | "2_months"
    | "3_months"
    | "4_months"
    | null;
  iCalUrl?: string | null;
  defaultCheckInTime?: string;
  defaultCheckOutTime?: string;
};

/**
 * Creates a property under an existing customer.
 *
 * Until this existed, a property could only be born inside
 * `completeOnboarding()` — which creates customer + property + subscription +
 * first payment as one transaction. So an existing customer could never gain a
 * second property and staff could not add one at all.
 *
 * The address is geocoded here rather than lazily, because the coordinates are
 * what the check-in geofence decides against: a property with no coordinates
 * makes every check-in "unknown", which is allowed-and-flagged rather than
 * enforced. A geocode failure is NOT fatal — a property the customer can see
 * and correct beats a refused form — but it is reported so the caller can say
 * so.
 */
export async function createProperty(
  input: CreatePropertyInput
): Promise<{ propertyId: string; geocoded: boolean }> {
  const owner = await db.query.customers.findFirst({
    where: eq(customers.id, input.customerId),
    columns: { id: true },
  });
  if (!owner) {
    throw new Error("Customer not found");
  }

  const coordinates = await geocodeAddress(input.address);

  const [created] = await db
    .insert(properties)
    .values({
      customerId: input.customerId,
      address: input.address.trim(),
      bedCount: input.bedCount,
      bathCount: input.bathCount,
      sqFt: input.sqFt ?? null,
      hasHotTub: input.hasHotTub ?? false,
      laundryType: input.laundryType,
      laundryLoads: input.laundryLoads ?? null,
      // Hot-tub servicing on a property with no hot tub is not a meaningful
      // state, and it is what made the pricing engine add hot-tub hours to
      // properties that have none (migration 0032).
      hotTubServiceLevel: input.hasHotTub
        ? input.hotTubServiceLevel ?? false
        : false,
      hotTubDrain: input.hasHotTub ? input.hotTubDrain ?? false : false,
      hotTubDrainCadence: input.hasHotTub
        ? input.hotTubDrainCadence ?? null
        : null,
      // No checklist upload on this form, so fall back to the system default
      // rather than leaving the property with no checklist at all.
      useDefaultChecklist: true,
      iCalUrl: input.iCalUrl ?? null,
      ...(input.defaultCheckInTime
        ? { defaultCheckInTime: input.defaultCheckInTime }
        : {}),
      ...(input.defaultCheckOutTime
        ? { defaultCheckOutTime: input.defaultCheckOutTime }
        : {}),
      ...(coordinates
        ? {
            latitude: coordinates.latitude.toString(),
            longitude: coordinates.longitude.toString(),
            geocodedAt: new Date(),
          }
        : {}),
    })
    .returning({ id: properties.id });

  return { propertyId: created.id, geocoded: coordinates !== null };
}
