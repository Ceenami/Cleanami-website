import "server-only";

import { db } from "@/db";
import { evidencePackets, jobs, payouts, properties } from "@/db/schemas";
import { buildPayBreakdownFromPayout } from "@/lib/cleaner/pay-breakdown";
import { desc, eq } from "drizzle-orm";

export type CleanerPayoutRow = {
  id: string;
  jobId: string;
  jobDate: string | null;
  propertyAddress: string | null;
  amount: number;
  status: "pending" | "released" | "held";
  urgentBonusAmount: number;
  laundryBonusAmount: number;
  holdReason: string | null;
  payBreakdown: ReturnType<typeof buildPayBreakdownFromPayout>;
};

function getHoldReason(
  status: string | null,
  evidence: {
    isChecklistComplete: boolean | null;
    status: string | null;
    photoUrls: string[] | null;
  } | null
): string | null {
  if (status !== "held") return null;

  if (!evidence) return "Evidence packet not started";
  if (!evidence.isChecklistComplete) return "Evidence packet incomplete";
  if (!evidence.photoUrls?.length) return "Evidence photos missing";
  if (evidence.status === "incomplete") return "Evidence packet incomplete";

  return "Pending admin review";
}

export async function getCleanerPayouts(cleanerId: string): Promise<{
  payouts: CleanerPayoutRow[];
  totalEarnedThisMonth: number;
}> {
  const rows = await db
    .select({
      id: payouts.id,
      jobId: payouts.jobId,
      amount: payouts.amount,
      status: payouts.status,
      urgentBonusAmount: payouts.urgentBonusAmount,
      laundryBonusAmount: payouts.laundryBonusAmount,
      createdAt: payouts.createdAt,
      jobCheckInTime: jobs.checkInTime,
      propertyAddress: properties.address,
      evidenceChecklistComplete: evidencePackets.isChecklistComplete,
      evidenceStatus: evidencePackets.status,
      evidencePhotoUrls: evidencePackets.photoUrls,
    })
    .from(payouts)
    .innerJoin(jobs, eq(payouts.jobId, jobs.id))
    .leftJoin(properties, eq(jobs.propertyId, properties.id))
    .leftJoin(evidencePackets, eq(evidencePackets.jobId, jobs.id))
    .where(eq(payouts.cleanerId, cleanerId))
    .orderBy(desc(payouts.createdAt));

  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  firstOfMonth.setHours(0, 0, 0, 0);

  let totalEarnedThisMonth = 0;

  const payoutRows: CleanerPayoutRow[] = rows.map((row) => {
    const amount = parseFloat(row.amount);
    const urgentBonusAmount = parseFloat(row.urgentBonusAmount ?? "0");
    const laundryBonusAmount = parseFloat(row.laundryBonusAmount ?? "0");
    const status = (row.status ?? "pending") as CleanerPayoutRow["status"];

    if (status === "released" && row.createdAt >= firstOfMonth) {
      totalEarnedThisMonth += amount;
    }

    const evidence =
      row.evidenceChecklistComplete !== null ||
      row.evidenceStatus !== null ||
      row.evidencePhotoUrls !== null
        ? {
            isChecklistComplete: row.evidenceChecklistComplete,
            status: row.evidenceStatus,
            photoUrls: row.evidencePhotoUrls,
          }
        : null;

    const jobDate = row.jobCheckInTime
      ? row.jobCheckInTime.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: "America/New_York",
        })
      : null;

    return {
      id: row.id,
      jobId: row.jobId,
      jobDate,
      propertyAddress: row.propertyAddress,
      amount,
      status,
      urgentBonusAmount,
      laundryBonusAmount,
      holdReason: getHoldReason(status, evidence),
      payBreakdown: buildPayBreakdownFromPayout({
        amount,
        urgentBonusAmount,
        laundryBonusAmount,
      }),
    };
  });

  return {
    payouts: payoutRows,
    totalEarnedThisMonth: Math.round(totalEarnedThisMonth * 100) / 100,
  };
}
