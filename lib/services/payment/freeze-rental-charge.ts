import "server-only";
import type { db as database } from "@/db";
import { jobs } from "@/db/schemas";
import { eq, sql } from "drizzle-orm";
import { readRentalCharge, RentalPricingError, type RentalCharge } from "@/lib/pricing/rental-charge";

/** Persist before the provider call. Competing workers reuse the winning quote,
 * including its promo; retries retain identical idempotency-key parameters. */
export async function freezeRentalCharge(
  db: Pick<typeof database, "transaction">,
  jobId: string,
  candidate: RentalCharge,
  expectedPromoCodeId: string | null = candidate.promo?.promoCodeId ?? null,
): Promise<RentalCharge | null> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select({
      rentalCharge: jobs.rentalCharge,
      paymentIntentId: jobs.paymentIntentId,
      paymentStatus: jobs.paymentStatus,
      status: jobs.status,
      promoCodeId: jobs.promoCodeId,
    }).from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!job || job.status === "canceled" || job.paymentIntentId || job.paymentStatus)
      return null;
    const existing = readRentalCharge(job.rentalCharge);
    if (existing) return existing;
    if (!candidate.skippedPayment && job.promoCodeId !== expectedPromoCodeId)
      throw new RentalPricingError("The promo code changed while preparing this charge. Office review is required before billing.");
    const quote = readRentalCharge(candidate)!;
    // SQL0052/0053 freezes addons_snapshot. This is a billing result from those
    // issued inputs, so store it separately without changing staffing/history.
    await tx.execute(sql`select set_config('cleannami.rental_charge_freeze', 'v1', true)`);
    await tx.update(jobs).set({
      rentalCharge: quote,
    }).where(eq(jobs.id, jobId));
    return quote;
  }).catch((error) => {
    if (error instanceof RentalPricingError) throw error;
    throw new RentalPricingError("Unable to record the rental charge. Office review is required before billing.", { cause: error });
  });
}
