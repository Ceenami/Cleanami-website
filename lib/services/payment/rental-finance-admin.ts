import "server-only";
import { RentalFinanceError } from "./rental-finance-error";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { sql, eq } from "drizzle-orm";
import { jobs } from "@/db/schemas";
import { getStripe } from "@/lib/stripe/get-stripe";
import { rows, json, entitlement, financeContract, verifyCreditSource, financeNotice, type FinanceWriter } from "./rental-credit";
import { jobFinance, cancelFinancialJob, prepareRentalCompletion } from "./rental-finance.service";
import { operation, prepareOperation, runOperation, type FinanceOperation } from "./rental-finance-operations";
import { rentalFinanceReady } from "./rental-finance-settings";
import { captureAndCreatePayouts } from "./capture-and-payout.service";

export async function auditFinance(writer: FinanceWriter, identity: string, actor: string, action: string, reason: string,
  jobId: string | null, entitlementId: string | null, details: unknown) {
  await writer.execute(sql`insert into rental_finance_audit(identity,actor,action,reason,job_id,entitlement_id,details)
    values(${identity},${actor},${action},${reason},${jobId}::uuid,${entitlementId}::uuid,${json(details)}) on conflict do nothing`);
}
export async function propertyPrepayment(propertyId: string, customerId?: string) {
  // Scope current ownership before financial history. A property transfer never
  // transfers its former customer's credit automatically.
  const [property] = rows<{ customer_id: string }>(await db.execute(sql`select customer_id from properties where id=${propertyId}::uuid ${customerId ? sql`and customer_id=${customerId}::uuid` : sql``}`));
  if (!property) throw new RentalFinanceError("Property not found");
  if (!rentalFinanceReady()) return [];
  const ids = rows<{ id: string }>(await db.execute(sql`select id from prepaid_entitlements where property_id=${propertyId}::uuid ${customerId ? sql`and customer_id=${property.customer_id}::uuid` : sql``} order by created_at`));
  const result = [];
  for (const { id } of ids) {
    const e = (await entitlement(id))!;
    result.push({ id: e.id, fundedCents: e.funded_cents, availableCents: e.state === "active" ? e.balance - e.reserved : 0,
      balanceCents: e.balance, reservedCents: e.reserved, appliedCents: e.applied,
      status: e.state === "held" ? "Review required" : e.balance === 0 && e.applied === 0 ? "Refunded" : e.applied === 0 ? "Unused" : e.balance > 0 ? "Partially applied" : "Applied",
      held: e.state === "held", ...(customerId ? {} : { customerId: e.customer_id, sourcePaymentId: e.source_payment_id, holdReason: e.hold_reason }) });
  }
  return result;
}
export async function loadJobFinance(jobId: string, customerId?: string) {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId), with: { property: true } });
  if (!job?.property || (customerId && job.property.customerId !== customerId)) throw new RentalFinanceError("Job not found");
  const contract = await financeContract(job.subscriptionId); if (!contract) return null;
  if (customerId && contract.customer_id !== job.property.customerId) throw new RentalFinanceError("Credit ownership requires review");
  const f = await jobFinance(jobId);
  const e = (await entitlement(contract.entitlement_id))!;
  const operations = rows<FinanceOperation>(await db.execute(sql`select * from rental_financial_operations where job_id=${jobId}::uuid order by created_at`));
  const [reservation] = rows<{ cents: number; state: string }>(await db.execute(sql`select cents,state from prepaid_reservations where job_id=${jobId}::uuid`));
  const payouts = rows<{ status: string; cents: number }>(await db.execute(sql`select status::text,round(amount*100)::int cents from payouts where job_id=${jobId}::uuid order by created_at`));
  return { jobId, propertyId: job.property.id, cancellation: f?.cancellation ?? null,
    statusLabel: f?.cancellation === "late_customer" ? "Late Canceled" : job.status?.replaceAll("_", " "),
    totalCents: f?.completion_cents ?? null, scheduledCents: f?.quote.chargeAmountCents ?? null,
    creditCents: reservation?.cents ?? 0, creditState: reservation?.state ?? null,
    supplementalCents: f?.completion_cents != null ? f.completion_cents - (reservation?.cents ?? 0) : null,
    prepayment: (await propertyPrepayment(job.property.id, customerId)).find(p => p.id === e.id) ?? null,
    operations: operations.map(o => ({ id: o.id, identity: o.identity, kind: o.kind, cents: o.cents, state: o.state,
      ...(customerId ? {} : { providerId: o.provider_id, lastError: o.last_error }) })), payouts,
    ...(customerId ? {} : { audit: rows(await db.execute(sql`select identity,actor,action,reason,details,created_at from rental_finance_audit where job_id=${jobId}::uuid order by created_at`)) }) };
}
export async function customerFinanceAction(jobId: string, customerId: string, action: "accept_topup" | "pay_fee" | "reconcile", expectedCents?: number) {
  const current = await loadJobFinance(jobId, customerId); if (!current) throw new RentalFinanceError("This job does not use the prepaid credit policy");
  if (action === "accept_topup") {
    if (!Number.isSafeInteger(expectedCents)) throw new RentalFinanceError("Review the exact supplemental amount before accepting");
    await prepareRentalCompletion(jobId, { actor: customerId, expectedCents: expectedCents! });
  } else if (action === "pay_fee") {
    if (current.cancellation !== "late_customer" || !current.scheduledCents || current.scheduledCents !== expectedCents) throw new RentalFinanceError("Late-fee amount changed; reload before paying");
    const identity = `late:${jobId}`;
    let op = await operation(identity);
    if (!op) {
      const [owner] = rows<{ stripe_customer_id: string }>(await db.execute(sql`select stripe_customer_id from customers where id=${customerId}::uuid`));
      if (!owner?.stripe_customer_id) throw new RentalFinanceError("Payment customer requires review");
      op = await prepareOperation(db, { identity, jobId, kind: "late_fee", cents: current.scheduledCents,
        params: { amount: current.scheduledCents, currency: "usd", customer: owner.stripe_customer_id, automatic_payment_methods: { enabled: true, allow_redirects: "never" } },
        actor: customerId, reason: "Customer settling a separate late-cancellation fee" });
    }
    await runOperation(identity);
  } else {
    for (const op of current.operations) if (!["waived", "refunded", "review"].includes(op.state)) await runOperation(op.identity);
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId), columns: { status: true } });
    if (job?.status === "awaiting_capture") {
      // Uses the canonical evidence checks and existing fencing; no synthetic
      // completion or bypass of the settlement claim.
      const outcome = await captureAndCreatePayouts(jobId);
      if (!outcome.ok) throw new RentalFinanceError(String(outcome.body.error ?? "Settlement requires review"));
    }
  }
  const refreshed = (await loadJobFinance(jobId, customerId))!;
  const payable = refreshed.operations.find(o => ["requires_action", "failed"].includes(o.state) && ["clean_payment", "late_fee"].includes(o.kind));
  const op = payable ? await operation(payable.identity) : null;
  let clientSecret: string | null = null;
  if (op?.provider_id) {
    const stripe = getStripe(); if (!stripe) throw new RentalFinanceError("Payment provider unavailable");
    const pi = await stripe.paymentIntents.retrieve(op.provider_id);
    if (pi.metadata?.rental_financial_operation_id !== op.id) throw new RentalFinanceError("Payment identity requires review");
    clientSecret = pi.client_secret;
  }
  return { finance: refreshed, clientSecret };
}
export async function refundCredit(entitlementId: string, actor: string, reason: string, requestId: string, cents: number) {
  if (!rentalFinanceReady()) throw new RentalFinanceError("Credit schema not ready");
  const identity = `credit-refund:${requestId}`;
  let op = await operation(identity);
  if (!op) {
    const e = await entitlement(entitlementId); if (!e) throw new RentalFinanceError("Prepayment not found");
    const stripe = getStripe(); if (!stripe) throw new RentalFinanceError("Payment provider unavailable");
    await verifyCreditSource(stripe, e);
    op = await db.transaction(async tx => {
      const locked = (await entitlement(entitlementId, tx, true))!;
      if (locked.state !== "active" || locked.reserved || cents > locked.balance || !Number.isSafeInteger(cents) || cents < 1) throw new RentalFinanceError("Only verified unreserved credit can be refunded");
      const prepared = await prepareOperation(tx, { identity, entitlementId, kind: "credit_refund", cents,
        params: { payment_intent: locked.source_payment_id, amount: cents }, actor, reason });
      await tx.execute(sql`update prepaid_entitlements set state='held',hold_reason=${identity} where id=${entitlementId}::uuid`);
      await auditFinance(tx, identity, actor, "refund_credit", reason, null, entitlementId, { cents });
      return prepared;
    });
  }
  if (op.entitlement_id !== entitlementId || op.cents !== cents || op.kind !== "credit_refund") throw new RentalFinanceError("Refund identity changed");
  op = await runOperation(identity);
  if (op.state === "paid") await db.transaction(async tx => {
    const e = (await entitlement(entitlementId, tx, true))!;
    if (!rows(await tx.execute(sql`select id from prepaid_entries where identity=${identity}`)).length)
      await tx.execute(sql`insert into prepaid_entries(entitlement_id,kind,cents,identity,actor,reason) values(${entitlementId}::uuid,'refund',${-cents},${identity},${op!.actor},${op!.reason})`);
    await tx.execute(sql`update rental_financial_operations set state='refunded' where identity=${identity} and state='paid'`);
    if (e.hold_reason === identity) await tx.execute(sql`update prepaid_entitlements set state='active',hold_reason=null where id=${entitlementId}::uuid`);
    await financeNotice(tx, `${identity}:succeeded`, e.customer_id, null, "Approved prepayment refund", [`Approved refund: $${(cents / 100).toFixed(2)}.`, "The provider reports the refund succeeded. Bank posting time may vary."]);
  });
  return operation(identity);
}
/** An expired unknown request is never replayed with a fresh key. An admin may
 * bind a provider object only after its current amount/customer/operation
 * metadata match the original immutable request. This path performs no create. */
export async function reconcileRecordedOperation(id: string, providerId: string, actor: string, reason: string, requestId: string) {
  const stripe = getStripe(); if (!stripe) throw new RentalFinanceError("Payment provider unavailable");
  const [op] = rows<FinanceOperation>(await db.execute(sql`select * from rental_financial_operations where id=${id}::uuid`));
  if (!op) throw new RentalFinanceError("Financial operation not found");
  if (op.kind.endsWith("refund")) {
    const refund = await stripe.refunds.retrieve(providerId);
    if (refund.id !== providerId || refund.metadata?.rental_financial_operation_id !== id || refund.amount !== op.cents || refund.currency !== "usd" ||
        (typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id) !== op.params.payment_intent)
      throw new RentalFinanceError("Provider refund does not match the recorded operation");
  } else {
    const pi = await stripe.paymentIntents.retrieve(providerId);
    if (pi.id !== providerId || pi.metadata?.rental_financial_operation_id !== id || pi.amount !== op.cents || pi.currency !== "usd" ||
        (typeof pi.customer === "string" ? pi.customer : pi.customer?.id) !== op.params.customer)
      throw new RentalFinanceError("Provider payment does not match the recorded operation");
  }
  await db.transaction(async tx => {
    const [current] = rows<FinanceOperation>(await tx.execute(sql`select * from rental_financial_operations where id=${id}::uuid for update`));
    if (["waived", "refunded"].includes(current.state) || (current.provider_id && current.provider_id !== providerId)) throw new RentalFinanceError("Terminal outcome or existing provider binding cannot be overwritten");
    if (current.state === "submitting" && current.claimed_at && Date.now() - +new Date(current.claimed_at) < 60_000) throw new RentalFinanceError("Provider request is still running; reconcile after its lease expires");
    await tx.execute(sql`update rental_financial_operations set provider_id=${providerId},state='processing',token=null,claimed_at=null where id=${id}::uuid`);
    await auditFinance(tx, `provider-bind:${requestId}`, actor, "bind_verified_provider_outcome", reason, op.job_id, op.entitlement_id, { operationId: id, providerId });
  });
  const saved = await runOperation(op.identity, stripe);
  if (op.kind === "credit_refund" && saved.state === "paid") return refundCredit(op.entitlement_id!, op.actor, op.reason, op.identity.slice("credit-refund:".length), op.cents);
  if (op.kind === "fee_refund" && saved.state === "paid" && op.job_id) await db.execute(sql`update rental_financial_operations set state='refunded' where identity=${`late:${op.job_id}`} and state='paid'`);
  return saved;
}
export async function adminFinanceAction(jobId: string, actor: string, input: { action: "retry_fee" | "reconcile" | "waive_fee" | "waive_clean_balance" | "refund_fee" | "release_credit_hold"; reason: string; requestId: string }) {
  const current = await loadJobFinance(jobId); if (!current) throw new RentalFinanceError("Financial job not found");
  const reason = input.reason.trim(); if (reason.length < 10 || reason.length > 1000) throw new RentalFinanceError("Provide a reason between 10 and 1000 characters");
  await auditFinance(db, `action:${input.requestId}`, actor, input.action, reason, jobId, current.prepayment?.id ?? null, {});
  if (input.action === "retry_fee") return cancelFinancialJob(jobId, "customer", actor);
  if (input.action === "release_credit_hold") {
    if (!current.prepayment) throw new RentalFinanceError("Prepayment not found");
    const e = (await entitlement(current.prepayment.id))!;
    const stripe = getStripe(); if (!stripe) throw new RentalFinanceError("Payment provider unavailable");
    await verifyCreditSource(stripe, e);
    await db.transaction(async tx => {
      await entitlement(e.id, tx, true);
      const pending = rows(await tx.execute(sql`select id from rental_financial_operations where entitlement_id=${e.id}::uuid and kind='credit_refund' and state not in('failed','refunded','waived')`));
      if (pending.length) throw new RentalFinanceError("Resolve the outstanding refund before releasing credit");
      await tx.execute(sql`update prepaid_entitlements set state='active',hold_reason=null where id=${e.id}::uuid`);
    });
  } else if (input.action === "waive_fee" || input.action === "waive_clean_balance") {
    const cleanBalance = input.action === "waive_clean_balance";
    let op = await operation(`${cleanBalance ? "clean" : "late"}:${jobId}`);
    if (!op && cleanBalance && current.supplementalCents && !current.cancellation) {
      const f = (await jobFinance(jobId))!;
      const [owner] = rows<{ stripe_customer_id: string }>(await db.execute(sql`select stripe_customer_id from customers where id=${f.customer_id}::uuid`));
      op = await prepareOperation(db, { identity: `clean:${jobId}`, jobId, kind: "clean_payment", cents: current.supplementalCents,
        params: { amount: current.supplementalCents, currency: "usd", customer: owner.stripe_customer_id }, actor, reason });
    }
    if (!op) throw new RentalFinanceError("Prepare/reconcile the fee before waiver");
    const stripe = getStripe(); if (op.provider_id && !stripe) throw new RentalFinanceError("Payment provider unavailable");
    // Serialize with dispatch using the same lease; never waive an unknown send.
    const token = randomUUID();
    const claimed = await db.transaction(async tx => {
      const [locked] = rows<FinanceOperation>(await tx.execute(sql`select * from rental_financial_operations where id=${op.id}::uuid for update`));
      if (locked.state === "waived") return false;
      const minimumReview = locked.state === "review" && locked.cents < 50 && !locked.provider_id && !locked.token;
      if (!minimumReview && ["submitting", "unknown", "processing", "paid", "refunded", "review"].includes(locked.state)) throw new RentalFinanceError("Payment needs reconciliation or refund before it can be waived");
      await tx.execute(sql`update rental_financial_operations set state='submitting',token=${token}::uuid,claimed_at=clock_timestamp() where id=${op.id}::uuid`);
      return true;
    });
    if (claimed) {
      if (op.provider_id) {
        const pi = await stripe!.paymentIntents.retrieve(op.provider_id);
        if (!["requires_payment_method", "requires_action", "requires_confirmation", "canceled"].includes(pi.status)) throw new RentalFinanceError("Payment is already underway; reconcile before waiver");
        if (pi.status !== "canceled") {
          const canceled = await stripe!.paymentIntents.cancel(pi.id, {}, { timeout: 10_000, maxNetworkRetries: 0 });
          if (canceled.status !== "canceled") throw new RentalFinanceError("Provider cancellation not confirmed");
        }
      }
      await db.execute(sql`update rental_financial_operations set state='waived',last_error=null where id=${op.id}::uuid and token=${token}::uuid`);
      const f = (await jobFinance(jobId))!;
      await financeNotice(db, `waived:${op.id}`, f.customer_id, jobId, cleanBalance ? "Additional clean balance waived" : "Late-cancellation fee waived", [`Your $${(op.cents / 100).toFixed(2)} ${cleanBalance ? "additional clean balance" : "separate late-cancellation fee"} has been waived.`, "The recorded prepayment remains separate from this adjustment."]);
    }
  } else if (input.action === "refund_fee") {
    const fee = await operation(`late:${jobId}`);
    if (!fee?.provider_id || !["paid", "refunded"].includes(fee.state)) throw new RentalFinanceError("Only a confirmed collected fee can be refunded");
    const identity = `fee-refund:${jobId}`;
    await prepareOperation(db, { identity, jobId, kind: "fee_refund", cents: fee.cents,
      params: { payment_intent: fee.provider_id, amount: fee.cents }, actor, reason });
    const refund = await runOperation(identity);
    if (refund.state === "paid") await db.execute(sql`update rental_financial_operations set state='refunded' where identity=${fee.identity} and state='paid'`);
    // A customer fee refund does not silently claw back the worker's agreed pay.
  } else {
    for (const op of current.operations) if (!["review", "waived", "refunded"].includes(op.state)) await runOperation(op.identity);
  }
  return loadJobFinance(jobId);
}
