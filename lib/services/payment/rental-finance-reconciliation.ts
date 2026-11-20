import "server-only";
import { RentalFinanceError } from "./rental-finance-error";
import type Stripe from "stripe";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { rows, entitlement, verifyCreditSource } from "./rental-credit";
import { rentalFinanceReady } from "./rental-finance-settings";
import { runOperation, type FinanceOperation } from "./rental-finance-operations";
import { refundCredit, auditFinance } from "./rental-finance-admin";

/** A signed event is a signal. Retrieve current provider truth and preserve
 * terminal waiver/refund decisions; never apply an event's stale snapshot. */
export async function reconcileRentalFinancialPayment(stripe: Stripe, paymentId: string, eventId: string, disputed = false) {
  if (!rentalFinanceReady()) return false;
  const pi = await stripe.paymentIntents.retrieve(paymentId, { expand: ["latest_charge"] });
  const opId = pi.metadata?.rental_financial_operation_id;
  if (opId) {
    const [op] = rows<FinanceOperation>(await db.execute(sql`select * from rental_financial_operations where id=${opId}::uuid`));
    if (!op || op.params.amount !== pi.amount || op.params.customer !== (typeof pi.customer === "string" ? pi.customer : pi.customer?.id) || pi.currency !== "usd")
      throw new RentalFinanceError("Financial webhook payment does not match its immutable operation");
    if (disputed) {
      await db.transaction(async tx => {
        await tx.execute(sql`update rental_financial_operations set state='review',last_error='Payment dispute requires review' where id=${op.id}::uuid and state not in('waived','refunded')`);
        if (op.job_id) await tx.execute(sql`update payouts set status='held',updated_at=clock_timestamp() where job_id=${op.job_id}::uuid and status::text='pending'`);
        await auditFinance(tx, `webhook:${eventId}`, "stripe-webhook", "dispute_review", "Signed provider dispute signal", op.job_id, op.entitlement_id, { paymentId });
      });
    } else if (!["waived", "refunded", "review"].includes(op.state)) {
      await db.transaction(async tx => {
        const [current] = rows<FinanceOperation>(await tx.execute(sql`select * from rental_financial_operations where id=${op.id}::uuid for update`));
        if (current.state === "submitting" && current.claimed_at && Date.now() - +new Date(current.claimed_at) < 60_000) throw new RentalFinanceError("Financial provider request is still running; retry webhook");
        if (current.provider_id && current.provider_id !== paymentId) throw new RentalFinanceError("Financial payment binding changed");
        if (!current.provider_id) await tx.execute(sql`update rental_financial_operations set provider_id=${paymentId} where id=${op.id}::uuid`);
      });
      const charge = typeof pi.latest_charge === "string" ? await stripe.charges.retrieve(pi.latest_charge) : pi.latest_charge;
      if (charge?.amount_refunded) {
        const fully = charge.amount_refunded === pi.amount_received;
        await db.execute(sql`update rental_financial_operations set state=${fully ? "refunded" : "review"},last_error='Refund observed; reconcile against approved refund history' where id=${op.id}::uuid and state not in('waived','refunded')`);
      } else await runOperation(op.identity, stripe);
    }
    return true;
  }
  const [source] = rows<{ id: string }>(await db.execute(sql`select id from prepaid_entitlements where source_payment_id=${paymentId}`));
  if (!source) return false;
  const refunds = rows<FinanceOperation>(await db.execute(sql`select * from rental_financial_operations where entitlement_id=${source.id}::uuid and kind='credit_refund' and state not in('refunded','waived','failed','review') order by created_at`));
  for (const refund of refunds) await refundCredit(source.id, refund.actor, refund.reason, refund.identity.slice("credit-refund:".length), refund.cents);
  const e = (await entitlement(source.id))!;
  try {
    if (disputed) throw new RentalFinanceError("Prepayment dispute needs review");
    await verifyCreditSource(stripe, e);
  } catch {
    await db.transaction(async tx => {
      await entitlement(e.id, tx, true);
      await tx.execute(sql`update prepaid_entitlements set state='held',hold_reason='Source payment refund/dispute requires reconciliation' where id=${e.id}::uuid`);
      await tx.execute(sql`update payouts set status='held',updated_at=clock_timestamp() where status::text='pending' and job_id in(select job_id from prepaid_entries where entitlement_id=${e.id}::uuid and kind='application')`);
      await auditFinance(tx, `webhook:${eventId}`, "stripe-webhook", "credit_hold", "Source payment needs reconciliation", null, e.id, { paymentId });
    });
  }
  return true;
}
