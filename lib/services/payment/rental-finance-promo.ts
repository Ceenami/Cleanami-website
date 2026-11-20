import "server-only";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { rows } from "./rental-credit";
import { recordPromoRedemption } from "@/lib/services/promo-code.service";
import type { RentalCharge } from "@/lib/pricing/rental-charge";
/** Preserve the existing redemption engine. A credit-funded clean has a
 * durable business reference rather than a fabricated Stripe PaymentIntent. */
export async function recordFinancialPromo(jobId: string) {
  try {
  const [f] = rows<{ customer_id: string; subscription_id: string; quote: RentalCharge; email: string }>(await db.execute(sql`select f.customer_id,f.subscription_id,f.quote,c.email from rental_job_finances f join customers c on c.id=f.customer_id where f.job_id=${jobId}::uuid`));
  if (!f?.quote.promo) return;
  await recordPromoRedemption({ ...f.quote.promo, customerId: f.customer_id, subscriptionId: f.subscription_id,
    customerEmail: f.email, jobId, paymentIntentId: `rental-job-promo:${jobId}`,
    originalAmountCents: f.quote.amountCents, finalAmountCents: f.quote.chargeAmountCents });
  } catch { console.warn("[rental-finance] Promo bookkeeping needs review", { jobId }); }
}
