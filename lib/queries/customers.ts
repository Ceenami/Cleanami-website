import 'server-only';
import { db } from '@/db';
import { customers, properties, jobs } from '@/db/schemas';
import { eq, sql, inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import {
  PaginationParams,
  SearchParams,
  buildPaginatedResponse,
  buildSearchCondition,
  getPaginationOffset,
  ordering,
} from './utils/queryBuilder';

interface GetCustomersParams extends PaginationParams, SearchParams {}

export async function getCustomersWithPropertyCount({
  page = 1,
  limit = 10,
  query = '',
}: GetCustomersParams) {
  const offset = getPaginationOffset(page, limit);

  const data = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      stripeCustomerId: customers.stripeCustomerId,
      createdAt: customers.createdAt,
      updatedAt: customers.updatedAt,

      // Fully qualify columns — Drizzle strips outer-table qualifiers in SELECT
      // subqueries (e.g. `${customers.id}` → `"id"`), which breaks correlation.
      propertyCount: sql<number>`(
        SELECT CAST(COUNT(*) AS INTEGER)
        FROM "properties"
        WHERE "properties"."customer_id" = "customers"."id"
      )`.as('property_count'),

      activeSubscriptionCount: sql<number>`(
        SELECT CAST(COUNT(*) AS INTEGER)
        FROM "subscriptions"
        WHERE "subscriptions"."customer_id" = "customers"."id"
        AND "subscriptions"."status" = 'active'
      )`.as('active_subscription_count'),

      totalSubscriptions: sql<number>`(
        SELECT CAST(COUNT(*) AS INTEGER)
        FROM "subscriptions"
        WHERE "subscriptions"."customer_id" = "customers"."id"
      )`.as('total_subscriptions'),

      completedJobs: sql<number>`(
        SELECT CAST(COUNT(DISTINCT "jobs"."id") AS INTEGER)
        FROM "jobs"
        INNER JOIN "properties" ON "jobs"."property_id" = "properties"."id"
        WHERE "properties"."customer_id" = "customers"."id"
        AND "jobs"."status" = 'completed'
      )`.as('completed_jobs'),
    })
    .from(customers)
    .where(buildSearchCondition(query, [customers.name, customers.email, customers.phone]))
    .orderBy(ordering.createdAtDesc(customers))
    .limit(limit)
    .offset(offset);

  return buildPaginatedResponse(data, page, limit);
}




export type CustomersResponse = Awaited<ReturnType<typeof getCustomersWithPropertyCount>>;

export async function getCustomerDetails(customerId: string) {
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    with: {
      properties: {
        with: {
          subscriptions: {
            orderBy: (subscriptions, { desc }) => [desc(subscriptions.createdAt)],
          },
          checklistFiles: true,
        },
      },
      subscriptions: {
        with: {
          property: {
            columns: {
              address: true,
              bedCount: true,
              bathCount: true,
              hasHotTub: true,
            },
          },
          jobs: {
            orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
            limit: 10,
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
                },
              },
            },
          },
        },
        orderBy: (subscriptions, { desc }) => [desc(subscriptions.createdAt)],
      },
    },
  });

  if (!customer) {
    notFound();
  }

  const allJobs = customer.subscriptions.flatMap((sub) => sub.jobs);

  return {
    ...customer,
    totalProperties: customer.properties.length,
    activeSubscriptions: customer.subscriptions.filter((s) => s.status === 'active').length,
    totalJobs: allJobs.length,
    completedJobs: allJobs.filter((j) => j.status === 'completed').length,
  
    recentJobs: allJobs
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20),
  };
}

export type CustomerDetails = Awaited<ReturnType<typeof getCustomerDetails>>;

export async function getCustomerJobHistory({
  customerId,
  page = 1,
  limit = 20,
}: { customerId: string } & PaginationParams) {
  const offset = getPaginationOffset(page, limit);

  const customerProperties = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.customerId, customerId));

  if (customerProperties.length === 0) {
    return buildPaginatedResponse([], page, limit);
  }

  const propertyIds = customerProperties.map((p) => p.id);

  const jobData = await db.query.jobs.findMany({
    where: inArray(jobs.propertyId, propertyIds),
    orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
    limit,
    offset,
    with: {
      property: {
        columns: {
          address: true,
        },
      },
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
  });

  return buildPaginatedResponse(jobData, page, limit);
}

export type CustomerJobHistoryResponse = Awaited<ReturnType<typeof getCustomerJobHistory>>;