// lib/queries/jobs.ts
import 'server-only';
import { db } from '@/db';
import { jobs, properties, subscriptions, jobsToCleaners, cleaners, evidencePackets, payouts, promoCodes } from '@/db/schemas';
import { eq, sql, and, gte, lte, asc, desc } from 'drizzle-orm';
import { EVIDENCE_BUCKET, createSignedUrls } from '@/lib/storage/signed-url';
import {
  buildEvidenceRoomGroups,
  getRoomPhotoRequirements,
  type ChecklistLogPayload,
  type EvidenceRoomGroup,
} from '@/lib/cleaner/evidence';
import {
  PaginationParams,
  SearchParams,
  buildPaginatedResponse,
  buildSearchCondition,
  getPaginationOffset,
  ordering,
  filters,
} from './utils/queryBuilder';

type JobStatus = 'unassigned' | 'assigned' | 'in-progress' | 'completed' | 'canceled';

interface GetJobsParams extends PaginationParams, SearchParams {
  status?: JobStatus | 'all';
  startDate?: Date;
  endDate?: Date;
  propertyId?: string;
  cleanerId?: string;
  customerId?: string;
  /** When set, orders by check-in time instead of created-at. */
  sortByCheckIn?: 'asc' | 'desc';
}

export async function getJobsWithDetails({
  page = 1,
  limit = 10,
  status = 'all',
  query = '',
  startDate,
  endDate,
  propertyId,
  cleanerId,
  customerId,
  sortByCheckIn,
}: GetJobsParams) {
  const offset = getPaginationOffset(page, limit);

  const whereConditions = [
    filters.byStatus(jobs.status, status),
    filters.byDateRange(jobs.checkInTime, startDate, endDate),
    propertyId ? eq(jobs.propertyId, propertyId) : undefined,
    customerId ? eq(properties.customerId, customerId) : undefined,
  ].filter(Boolean);

  const data = await db
    .select({
      id: jobs.id,
      subscriptionId: jobs.subscriptionId,
      propertyId: jobs.propertyId,
      status: jobs.status,
      checkInTime: jobs.checkInTime,
      checkOutTime: jobs.checkOutTime,
      // isUrgentBonus: jobsToCleaners.urgentBonus,
      calendarEventUid: jobs.calendarEventUid,
      // Needed so the customer portal knows whether this clean is still open
      // for a promo-code change (only before pre-authorize has run/failed).
      paymentIntentId: jobs.paymentIntentId,
      paymentStatus: jobs.paymentStatus,
      promoCodeId: jobs.promoCodeId,
      appliedPromoCode: promoCodes.code,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,

      property: {
        id: properties.id,
        address: properties.address,
        bedCount: properties.bedCount,
        bathCount: properties.bathCount,
        hasHotTub: properties.hasHotTub,
        laundryType: properties.laundryType,
      },

      subscription: {
        id: subscriptions.id,
        status: subscriptions.status,
        durationMonths: subscriptions.durationMonths,
      },

      assignedCleaners: sql<Array<{
        id: string;
        fullName: string;
        role: string;
      }>>`(
        SELECT COALESCE(json_agg(json_build_object(
          'id', ${cleaners.id},
          'fullName', ${cleaners.fullName},
          'role', ${jobsToCleaners.role}
        )), '[]'::json)
        FROM ${jobsToCleaners}
        INNER JOIN ${cleaners} ON ${jobsToCleaners.cleanerId} = ${cleaners.id}
        WHERE ${jobsToCleaners.jobId} = ${jobs.id}
      )`.as('assigned_cleaners'),

      evidencePacket: sql<{
        id: string;
        status: string;
        isChecklistComplete: boolean;
        photoCount: number;
      } | null>`(
        SELECT json_build_object(
          'id', ${evidencePackets.id},
          'status', ${evidencePackets.status},
          'isChecklistComplete', ${evidencePackets.isChecklistComplete},
          'photoCount', COALESCE(array_length(${evidencePackets.photoUrls}, 1), 0)
        )
        FROM ${evidencePackets}
        WHERE ${evidencePackets.jobId} = ${jobs.id}
      )`.as('evidence_packet'),

      totalPayout: sql<string>`(
        SELECT CAST(COALESCE(SUM(${payouts.amount}), 0) AS TEXT)
        FROM ${payouts}
        WHERE ${payouts.jobId} = ${jobs.id}
      )`.as('total_payout'),

      payoutStatus: sql<string | null>`(
        SELECT ${payouts.status}
        FROM ${payouts}
        WHERE ${payouts.jobId} = ${jobs.id}
        LIMIT 1
      )`.as('payout_status'),
    })
    .from(jobs)
    .leftJoin(properties, eq(jobs.propertyId, properties.id))
    .leftJoin(subscriptions, eq(jobs.subscriptionId, subscriptions.id))
    .leftJoin(promoCodes, eq(jobs.promoCodeId, promoCodes.id))
    .where(
      and(
        ...whereConditions,
        buildSearchCondition(query, [properties.address])
      )
    )
    .orderBy(
      sortByCheckIn === 'asc'
        ? asc(jobs.checkInTime)
        : sortByCheckIn === 'desc'
          ? desc(jobs.checkInTime)
          : ordering.createdAtDesc(jobs)
    )
    .limit(limit)
    .offset(offset);

  let filteredData = data;
  if (cleanerId) {
    filteredData = data.filter((job) =>
      job.assignedCleaners.some((c) => c.id === cleanerId)
    );
  }

  return buildPaginatedResponse(filteredData, page, limit);
}

export type JobsWithDetails = Awaited<ReturnType<typeof getJobsWithDetails>>;

type EvidencePacketRow = {
  photoUrls: string[] | null;
  checklistLog: unknown;
};

/**
 * Swap every stored object path on an evidence packet for a signed URL, and
 * attach the room-grouped view the photo gallery renders from.
 *
 * The raw `roomPhotos` paths are stripped from the returned `checklistLog`.
 * They are useless to a browser (the bucket is private) and they carry the
 * cleaner's id in the path, so there is nothing to gain by shipping them.
 */
async function signEvidencePacket<T extends EvidencePacketRow>(
  packet: T | null,
  property: {
    bedCount: number;
    bathCount: string | number;
    hasHotTub: boolean;
    laundryType?: string | null;
  } | null
): Promise<
  | (Omit<T, 'checklistLog'> & {
      checklistLog: unknown;
      roomGroups: EvidenceRoomGroup[];
    })
  | null
> {
  if (!packet) return null;

  const log = (packet.checklistLog ?? null) as ChecklistLogPayload | null;
  const roomPhotos = log?.roomPhotos ?? {};
  const requirements = property ? getRoomPhotoRequirements(property) : [];
  const groups = buildEvidenceRoomGroups(requirements, roomPhotos);

  // One batch for the flat list plus every room, so a 12-photo packet costs a
  // single round trip instead of one per room.
  const flat = packet.photoUrls ?? [];
  const groupPaths = groups.flatMap((group) => group.photos);
  const signed = await createSignedUrls(EVIDENCE_BUCKET, [
    ...flat,
    ...groupPaths,
  ]);

  const signedFlat = signed.slice(0, flat.length).map((url) => url ?? '');
  let cursor = flat.length;
  const roomGroups: EvidenceRoomGroup[] = groups.map((group) => {
    const photos = signed
      .slice(cursor, cursor + group.photos.length)
      .map((url) => url ?? '');
    cursor += group.photos.length;
    // Drop anything that failed to sign — a broken <img> is worse than an
    // honest "no photo" for that room.
    return { ...group, photos: photos.filter(Boolean) };
  });

  // Fallback for a packet that has photos but no room map — anything written
  // before evidence became room-keyed. Without this the gallery would render
  // nothing at all for those rows, which is the exact failure being fixed.
  if (roomGroups.every((g) => g.photos.length === 0) && flat.length > 0) {
    roomGroups.push({
      roomKey: '__ungrouped',
      label: 'Photos',
      photos: signedFlat.filter(Boolean),
      minPhotos: 0,
    });
  }

  return {
    ...packet,
    photoUrls: signedFlat,
    checklistLog: log ? { ...log, roomPhotos: undefined } : log,
    roomGroups,
  };
}

export async function getJobDetails(jobId: string) {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: {
      property: {
        with: {
          customer: {
            columns: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          checklistFiles: {
            orderBy: (files, { desc }) => [desc(files.createdAt)],
            limit: 1,
          },
        },
      },
      subscription: true,
      cleaners: {
        with: {
          cleaner: {
            with: {
              payouts: {
                where: eq(payouts.jobId, jobId),
              },
            },
          },
        },
      },
      evidencePacket: true,
      payouts: {
        with: {
          cleaner: {
            columns: {
              fullName: true,
            },
          },
        },
      },
    },
  });

  if (!job) {
    throw new Error('Job not found');
  }

  const totalPayout = job.payouts.reduce((sum, p) => sum + parseFloat(p.amount), 0);

  // Evidence photos live in a private bucket; the stored values are object
  // paths (older rows hold legacy public URLs). Swap them for short-lived
  // signed URLs so the viewer can render them.
  //
  // `photoUrls` is the flat list the packet keeps for validation. The viewer
  // needs them grouped by room, which only `checklistLog.roomPhotos` knows —
  // so both are signed, and both are signed in ONE round trip rather than one
  // per room.
  const evidencePacket = await signEvidencePacket(
    job.evidencePacket,
    job.property
  );

  return {
    ...job,
    evidencePacket,
    totalPayout: totalPayout.toFixed(2),
    hasEvidencePacket: !!job.evidencePacket,
    isPayoutComplete: job.payouts.every((p) => p.status === 'released'),
  };
}

export type JobDetails = Awaited<ReturnType<typeof getJobDetails>>;

export async function getJobsForCalendar({
  startDate,
  endDate,
}: {
  startDate: Date;
  endDate: Date;
}) {
  const jobData = await db.query.jobs.findMany({
    where: and(
      gte(jobs.checkInTime, startDate),
      lte(jobs.checkInTime, endDate)
    ),
    orderBy: (jobs, { asc }) => [asc(jobs.checkInTime)],
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
    },
  });

  const jobsByDate: Record<string, typeof jobData> = {};
  
  jobData.forEach((job) => {
    if (job.checkInTime) {
      const dateKey = new Date(job.checkInTime).toISOString().split('T')[0];
      if (!jobsByDate[dateKey]) {
        jobsByDate[dateKey] = [];
      }
      jobsByDate[dateKey].push(job);
    }
  });

  return jobsByDate;
}

export type JobsForCalendar = Awaited<ReturnType<typeof getJobsForCalendar>>;