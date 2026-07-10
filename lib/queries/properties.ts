
import 'server-only';
import { db } from '@/db';
import { properties, customers, subscriptions, jobs, checklistFiles } from '@/db/schemas';
import { eq, sql, and } from 'drizzle-orm';
import { notFound } from 'next/navigation';
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

  const [source, target] = await Promise.all([
    db.query.properties.findFirst({ where: eq(properties.id, sourcePropertyId) }),
    db.query.properties.findFirst({ where: eq(properties.id, targetPropertyId) }),
  ]);

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
