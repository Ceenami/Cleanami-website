import "server-only";
import { sendExecutionNotice } from "./execution-notices";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { db } from "@/db";
import {
  evidencePackets,
  evidenceUploadManifest,
  jobEvidenceDrafts,
  jobOperationAudit,
  jobs,
  jobsToCleaners,
  payouts,
  reserveTransactions,
} from "@/db/schemas";
import { and, desc, eq } from "drizzle-orm";
import { getExecutionContract } from "../job-execution-contract";
import { ExecutionError } from "../job-execution";
import { evaluateArrival } from "../gps/geofence";
import { computeCleanerPay } from "@/lib/pricing/cleaner-pay";
import { isSkippedPaymentIntent } from "@/lib/billing/customer-billing";
import { getStripe } from "@/lib/stripe/get-stripe";
import { computeReserveRate } from "./reserve";
import type { CaptureOutcome } from "./capture-and-payout.service";

/** Short durable claim, provider call outside locks, then one atomic ledger/payout commit. */
export async function settleExecutionJob(
  jobId: string,
): Promise<CaptureOutcome> {
  try {
    const contract = await getExecutionContract(jobId);
    if (!contract) throw new ExecutionError("Issued contract missing");
    const claim = randomUUID();
    const context = await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for("update");
      if (!job || job.status === "canceled" || job.paymentStatus === "refunded")
        throw new ExecutionError("Canceled/refunded job cannot settle");
      if (job.status === "completed" && job.paymentStatus === "captured")
        return null;
      const [packet] = await tx
        .select()
        .from(evidencePackets)
        .where(eq(evidencePackets.jobId, jobId));
      const [draft] = await tx
        .select()
        .from(jobEvidenceDrafts)
        .where(eq(jobEvidenceDrafts.jobId, jobId));
      if (
        job.status !== "awaiting_capture" ||
        !packet?.finalEvidenceSubmittedAt ||
        !packet.gpsCheckInTimestamp ||
        !packet.gpsCheckOutTimestamp ||
        packet.status !== "complete" ||
        !draft?.finalHash
      )
        throw new ExecutionError("Canonical final evidence is required");
      const uploads = await tx
        .select()
        .from(evidenceUploadManifest)
        .where(eq(evidenceUploadManifest.jobId, jobId));
      const verified = uploads
        .filter((u) => u.state === "verified")
        .sort((a, b) => a.uploadId.localeCompare(b.uploadId));
      const canonicalItems = contract.checklist.map((item) => ({
        ...item,
        completed: true,
      }));
      const hash = createHash("sha256")
        .update(
          JSON.stringify({
            items: canonicalItems,
            notes: draft.notes,
            uploads: verified.map((u) => [u.uploadId, u.sha256]),
          }),
        )
        .digest("hex");
      const roomPhotos: Record<string, string[]> = {};
      for (const upload of verified)
        (roomPhotos[upload.roomKey] ??= []).push(upload.path);
      const log = packet.checklistLog as {
        items?: { id: string; completed: boolean }[];
        roomPhotos?: Record<string, string[]>;
      } | null;
      if (
        hash !== draft.finalHash ||
        !packet.isChecklistComplete ||
        packet.cleanerNotes !== draft.notes ||
        uploads.some((u) => u.state === "reserved") ||
        contract.rooms.some(
          (room) => (roomPhotos[room.roomKey]?.length ?? 0) < room.minPhotos,
        ) ||
        JSON.stringify(packet.photoUrls) !==
          JSON.stringify(verified.map((u) => u.path)) ||
        draft.items.length !== canonicalItems.length ||
        canonicalItems.some(
          (item) =>
            !draft.items.some(
              (d) =>
                d.id === item.id &&
                d.completed === true &&
                d.task === item.task,
            ),
        ) ||
        log?.items?.length !== canonicalItems.length ||
        canonicalItems.some(
          (item) =>
            !log?.items?.some((i) => i.id === item.id && i.completed === true),
        ) ||
        Object.keys(log?.roomPhotos ?? {}).length !==
          Object.keys(roomPhotos).length ||
        Object.entries(roomPhotos).some(
          ([room, paths]) =>
            JSON.stringify(log?.roomPhotos?.[room]) !== JSON.stringify(paths),
        )
      )
        throw new ExecutionError(
          "Final evidence identity no longer matches the canonical manifest; review required",
        );
      const [last] = await tx
        .select()
        .from(jobOperationAudit)
        .where(
          and(
            eq(jobOperationAudit.jobId, jobId),
            eq(jobOperationAudit.operation, "settlement_claim"),
          ),
        )
        .orderBy(desc(jobOperationAudit.createdAt))
        .limit(1);
      if (last && Date.now() - +last.createdAt < 5 * 60000)
        throw new ExecutionError(
          "Settlement is running; retry after five minutes",
        );
      await tx.insert(jobOperationAudit).values({
        jobId,
        operation: "settlement_claim",
        identity: claim,
        actor: "server",
      });
      return { job, packet };
    });
    if (!context)
      return {
        ok: true,
        httpStatus: 200,
        body: { success: true, alreadySettled: true },
      };
    let total = 0;
    const intentId = context.job.paymentIntentId;
    if (intentId && !isSkippedPaymentIntent(intentId)) {
      const stripe = getStripe();
      if (!stripe)
        throw new ExecutionError("Payment provider unavailable", 503);
      let intent = await stripe.paymentIntents.retrieve(intentId);
      if (intent.status === "requires_capture")
        intent = await stripe.paymentIntents.capture(
          intentId,
          {},
          { idempotencyKey: `execution-v1-capture:${jobId}` },
        );
      if (intent.status !== "succeeded")
        throw new ExecutionError(
          "Payment is not settled; retry after checking provider status",
        );
      const charge =
        typeof intent.latest_charge === "string"
          ? await stripe.charges.retrieve(intent.latest_charge)
          : intent.latest_charge;
      if (!charge || charge.amount_refunded > 0)
        throw new ExecutionError(
          "Refunded or missing charge requires review before payout",
        );
      total = intent.amount_received;
    } else if (
      !isSkippedPaymentIntent(intentId) &&
      context.job.jobSource !== "manual"
    ) {
      // Never invent a new charge for an unlinked/prepaid job.
      throw new ExecutionError(
        "Missing payment identity requires administrator review",
      );
    }
    const reserve = total
      ? Math.round(total * (await computeReserveRate()))
      : 0;
    const outcome = await db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for("update");
      if (job.status === "completed" && job.paymentStatus === "captured")
        return { success: true, alreadySettled: true };
      if (
        job.status !== "awaiting_capture" ||
        job.paymentStatus === "refunded" ||
        job.paymentIntentId !== intentId
      )
        throw new ExecutionError(
          "Job changed during settlement; manual reconciliation required",
        );
      const [last] = await tx
        .select()
        .from(jobOperationAudit)
        .where(
          and(
            eq(jobOperationAudit.jobId, jobId),
            eq(jobOperationAudit.operation, "settlement_claim"),
          ),
        )
        .orderBy(desc(jobOperationAudit.createdAt))
        .limit(1);
      if (last?.identity !== claim)
        throw new ExecutionError("A newer settlement retry owns this job");
      const assignments = await tx.query.jobsToCleaners.findMany({
        where: eq(jobsToCleaners.jobId, jobId),
        with: { cleaner: true },
      });
      const paid = assignments.filter((a) =>
        ["primary", "laundry_lead"].includes(a.role),
      );
      if (!paid.length)
        throw new ExecutionError(
          "Working assignments are missing; review before settlement",
        );
      if (total && intentId)
        await tx
          .insert(reserveTransactions)
          .values({
            jobId,
            paymentIntentId: intentId,
            totalAmountCents: total,
            reserveAmountCents: reserve,
            netAmountCents: total - reserve,
          })
          .onConflictDoNothing({ target: reserveTransactions.jobId });
      const delay = evaluateArrival(
        new Date(contract.plannedStart),
        context.packet.gpsCheckInTimestamp!,
      )!.delayMinutes;
      for (const a of paid) {
        const pay = computeCleanerPay({
          expectedHours: Number(job.expectedHours),
          hourlyRateCents: a.cleaner.hourlyRateCents,
          role: a.role,
          laundryLoads: job.addonsSnapshot?.laundryLoads,
          urgentBonus: a.urgentBonus,
          arrivalDelayMinutes: delay,
        });
        await tx
          .insert(payouts)
          .values({
            jobId,
            cleanerId: a.cleanerId,
            amount: pay.total.toFixed(2),
            urgentBonusAmount: pay.urgentBonus
              ? pay.urgentBonus.toFixed(2)
              : null,
            laundryBonusAmount: pay.laundryBonus
              ? pay.laundryBonus.toFixed(2)
              : null,
            lateDeductionAmount: pay.lateDeduction
              ? pay.lateDeduction.toFixed(2)
              : null,
            status: "pending",
          })
          .onConflictDoNothing({ target: [payouts.jobId, payouts.cleanerId] });
      }
      await tx
        .update(jobs)
        .set({
          status: "completed",
          paymentStatus: "captured",
          paymentFailed: false,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));
      await tx
        .insert(jobOperationAudit)
        .values({
          jobId,
          operation: "settled",
          identity: "once",
          actor: "server",
        })
        .onConflictDoNothing();
      return { success: true, payoutsCreated: paid.length };
    });
    if (!("alreadySettled" in outcome))
      await sendExecutionNotice(jobId, "completed");
    return { ok: true, httpStatus: 200, body: outcome };
  } catch (error) {
    return {
      ok: false,
      httpStatus: error instanceof ExecutionError ? error.status : 502,
      body: {
        error:
          error instanceof ExecutionError
            ? error.message
            : "Settlement interrupted; retry safely after five minutes",
        retryable: true,
      },
    };
  }
}
