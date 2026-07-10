import 'server-only';
import { db } from '@/db';
import { cleaners, jobs, jobsToCleaners, payouts } from '@/db/schemas';
import { eq, sql } from 'drizzle-orm';
import {
  PaginationParams,
  SearchParams,
  buildPaginatedResponse,
  buildSearchCondition,
  getPaginationOffset,
  ordering,
} from './utils/queryBuilder';

interface GetCleanersParams extends PaginationParams, SearchParams {}

/**
 * Fetches a paginated list of cleaners with enriched data:
 * - Total jobs completed
 * - Jobs this month
 * - Total earnings
 * - Average reliability score
 * - Current on-call status
 */
export async function getCleaners({ 
  page = 1, 
  limit = 15,
  query = '' 
}: GetCleanersParams) {
  const offset = getPaginationOffset(page, limit);
  
  const firstDayOfMonth = new Date();
  firstDayOfMonth.setDate(1);
  firstDayOfMonth.setHours(0, 0, 0, 0);

  const data = await db
    .select({
      id: cleaners.id,
      fullName: cleaners.fullName,
      email: cleaners.email,
      phone: cleaners.phone,
      profilePhotoUrl: cleaners.profilePhotoUrl,
      onCallStatus: cleaners.onCallStatus,
      reliabilityScore: cleaners.reliabilityScore,
      hasHotTubCert: cleaners.hasHotTubCert,
      accountStatus: cleaners.accountStatus,
      onboardingCompleted: cleaners.onboardingCompleted,
      onboardingStarted: cleaners.onboardingStarted,
      stripeOnboardingComplete: cleaners.stripeOnboardingComplete,
      stripeChargesEnabled: cleaners.stripeChargesEnabled,
      stripePayoutsEnabled: cleaners.stripePayoutsEnabled,
      stripeAccountId: cleaners.stripeAccountId,
      eligibleForAssignments: cleaners.eligibleForAssignments,
      activatedAt: cleaners.activatedAt,
      createdAt: cleaners.createdAt,
      
      totalJobs: sql<number>`(
        SELECT CAST(COUNT(*) AS INTEGER)
        FROM ${jobsToCleaners}
        INNER JOIN ${jobs} ON ${jobsToCleaners.jobId} = ${jobs.id}
        WHERE ${jobsToCleaners.cleanerId} = ${cleaners.id}
        AND ${jobs.status} = 'completed'
      )`.as('total_jobs'),
      
      jobsThisMonth: sql<number>`(
        SELECT CAST(COUNT(*) AS INTEGER)
        FROM ${jobsToCleaners}
        INNER JOIN ${jobs} ON ${jobsToCleaners.jobId} = ${jobs.id}
        WHERE ${jobsToCleaners.cleanerId} = ${cleaners.id}
        AND ${jobs.status} = 'completed'
        AND ${jobs.checkOutTime} >= ${firstDayOfMonth.toISOString()}
      )`.as('jobs_this_month'),
      
      totalEarnings: sql<string>`(
        SELECT CAST(COALESCE(SUM(${payouts.amount}), 0) AS TEXT)
        FROM ${payouts}
        WHERE ${payouts.cleanerId} = ${cleaners.id}
        AND ${payouts.status} = 'released'
      )`.as('total_earnings'),
      
      pendingPayouts: sql<string>`(
        SELECT CAST(COALESCE(SUM(${payouts.amount}), 0) AS TEXT)
        FROM ${payouts}
        WHERE ${payouts.cleanerId} = ${cleaners.id}
        AND ${payouts.status} = 'pending'
      )`.as('pending_payouts'),
    })
    .from(cleaners)
    .where(
      buildSearchCondition(query, [cleaners.fullName, cleaners.email, cleaners.phone])
    )
    .orderBy(ordering.createdAtDesc(cleaners))
    .limit(limit)
    .offset(offset);

  return buildPaginatedResponse(data, page, limit);
}

export type CleanersResponse = Awaited<ReturnType<typeof getCleaners>>;

/**
 * Get a single cleaner with full details including:
 * - Job history
 * - Payout history
 * - Availability records
 */
export async function getCleanerById(cleanerId: string) {
  const cleaner = await db.query.cleaners.findFirst({
    where: eq(cleaners.id, cleanerId),
    with: {
      jobs: {
        with: {
          job: {
            with: {
              property: {
                columns: {
                  address: true,
                },
              },
              subscription: {
                columns: {
                  id: true,
                  status: true,
                },
              },
              evidencePacket: true,
            },
          },
        },
        orderBy: (jobsToCleaners, { desc }) => [desc(jobsToCleaners.jobId)],
        limit: 50,
      },
      payouts: {
        with: {
          job: {
            columns: {
              id: true,
              status: true,
            },
          },
        },
        orderBy: (payouts, { desc }) => [desc(payouts.createdAt)],
        limit: 50,
      },
      availabilities: {
        orderBy: (availability, { desc }) => [desc(availability.date)],
        limit: 30,
      },
    },
  });

  if (!cleaner) {
    throw new Error('Cleaner not found');
  }

  return cleaner;
}

export type CleanerDetails = Awaited<ReturnType<typeof getCleanerById>>;