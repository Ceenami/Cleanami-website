import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { eq } from "drizzle-orm";

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
            columns: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
              reliabilityScore: true,
              onCallStatus: true,
              profilePhotoUrl: true,
            },
          },
        },
      },
      evidencePacket: true,
      payouts: {
        with: {
          cleaner: {
            columns: {
              id: true,
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

  // Calculate totals
  const totalPayout = job.payouts.reduce((sum, p) => sum + parseFloat(p.amount), 0);
  const isPayoutComplete = job.payouts.length > 0 && job.payouts.every((p) => p.status === 'released');

  return {
    ...job,
    totalPayout: totalPayout.toFixed(2),
    hasEvidencePacket: !!job.evidencePacket,
    isPayoutComplete,
  };
}

export type JobDetails = Awaited<ReturnType<typeof getJobDetails>>;