import "server-only";

import { db } from "@/db";
import { jobs } from "@/db/schemas";
import { eq } from "drizzle-orm";
import { PricingService } from "@/lib/services/pricing.service";
import { buildRecurringPricingInput } from "@/lib/pricing/recurring-pricing-input";
import { resolvePromoCodeForAmount } from "@/lib/services/promo-code.service";
import { isUniqueViolation } from "@/lib/db/errors";

const pricingService = new PricingService();

/**
 * A rejection whose `message` is written for the customer and is safe to send
 * back over the wire. Anything thrown that is NOT one of these is an internal
 * fault, and the route replaces it with a generic message rather than echoing
 * it — a raw driver error would otherwise leak SQL text and row ids.
 */
export class PromoActionError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PromoActionError";
    this.status = status;
  }
}

/** Guards a job whose promo code is still pending, one clean at a time. */
const PENDING_PROMO_INDEX = "jobs_promo_unauthorized_once_idx";

export type ApplyPromoCodeResult = {
  code: string;
  /**
   * Priced off today's property/pricing config — the real amount is only
   * fixed once the pre-authorize cron actually runs for this clean, up to
   * ~24h before check-in, so this is an estimate.
   */
  estimatedDiscountCents: number;
  estimatedFinalAmountCents: number;
  capped: boolean;
};

/**
 * Loads a job the customer owns and is still eligible for a promo-code change:
 * an upcoming, unassigned/assigned clean that hasn't been pre-authorized (or
 * failed pre-authorization — a `failed` job is never retried by the cron, so
 * it must not be treated as still open) yet. Shared by apply and remove so
 * both enforce exactly the same window.
 */
async function loadEligibleJob(jobId: string, customerId: string) {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    with: {
      property: { with: { customer: true } },
      subscription: true,
    },
  });

  if (!job) {
    throw new PromoActionError("Clean not found", 404);
  }
  if (!job.property) {
    throw new PromoActionError("Clean not found", 404);
  }
  if (!job.subscription) {
    throw new PromoActionError("Clean not found", 404);
  }
  if (job.property.customerId !== customerId) {
    throw new PromoActionError("Forbidden", 403);
  }
  if (!job.property.customer) {
    throw new PromoActionError("Clean not found", 404);
  }

  const eligible =
    job.checkInTime !== null &&
    new Date(job.checkInTime) > new Date() &&
    (job.status === "unassigned" || job.status === "assigned") &&
    job.paymentIntentId === null &&
    job.paymentStatus === null;

  if (!eligible) {
    throw new PromoActionError(
      "A promo code can only be applied to an upcoming clean that hasn't been charged yet."
    );
  }

  // Built as a fresh object literal (rather than returning `job` itself) so
  // the narrowed, non-null types of `property`/`subscription`/`customer`
  // established above are what callers actually see.
  return {
    jobId: job.id,
    promoCodeId: job.promoCodeId,
    property: job.property,
    subscriptionMonths: job.subscription.durationMonths,
    customerEmail: job.property.customer.email,
  };
}

export async function applyPromoCodeToJob(
  jobId: string,
  customerId: string,
  rawCode: string
): Promise<ApplyPromoCodeResult> {
  const job = await loadEligibleJob(jobId, customerId);

  if (job.promoCodeId) {
    throw new PromoActionError(
      "This clean already has a promo code applied. Remove it first."
    );
  }

  // Live preview off today's pricing config — same inputs the pre-authorize
  // cron will use when it actually charges this clean.
  const pricingInput = buildRecurringPricingInput(
    job.property,
    job.subscriptionMonths
  );
  const priceDetails = await pricingService.calculatePrice(
    pricingInput as any
  );
  const previewAmountCents = Math.round(priceDetails.totalPerClean * 100);

  const { evaluation, promoCodeId } = await resolvePromoCodeForAmount(
    rawCode,
    previewAmountCents,
    job.customerEmail
  );

  if (!evaluation.valid || !promoCodeId) {
    throw new PromoActionError(
      evaluation.valid ? "That promo code is not valid." : evaluation.message
    );
  }

  try {
    await db
      .update(jobs)
      .set({ promoCodeId, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
  } catch (error) {
    // The code is already pending (unauthorized) on a different upcoming job.
    // Matched on the specific index so an unrelated unique violation on `jobs`
    // is never mis-reported as this.
    if (isUniqueViolation(error, PENDING_PROMO_INDEX)) {
      throw new PromoActionError(
        "That code is already applied to another upcoming clean. Remove it from that one first."
      );
    }
    throw error;
  }

  return {
    code: evaluation.code,
    estimatedDiscountCents: evaluation.discountCents,
    estimatedFinalAmountCents: evaluation.finalAmountCents,
    capped: evaluation.capped,
  };
}

export async function removePromoCodeFromJob(
  jobId: string,
  customerId: string
): Promise<void> {
  const job = await loadEligibleJob(jobId, customerId);
  if (!job.promoCodeId) return;

  await db
    .update(jobs)
    .set({ promoCodeId: null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}
