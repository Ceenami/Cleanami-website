import "server-only";
import { RentalFinanceError } from "./rental-finance-error";
import { db } from "@/db";
import { jobs, payouts, jobsToCleaners } from "@/db/schemas";
import { eq, sql } from "drizzle-orm";
import { PricingService } from "@/lib/services/pricing.service";
import { buildRentalCharge, rentalJobPricingInput, readRentalCharge, type RentalCharge } from "@/lib/pricing/rental-charge";
import { rentalQuoteRefusal } from "@/lib/pricing/rental-quote-refusal";
import { resolvePromoCodeById } from "@/lib/services/promo-code.service";
import { computeCleanerPay } from "@/lib/pricing/cleaner-pay";
import { getStripe } from "@/lib/stripe/get-stripe";
import { financeContract, entitlement, rows, json, rentalScope, verifyCreditSource, reserveCredit, applyCredit, financeNotice, assertFinanceCompatibility, type FinanceTx, type FinanceWriter } from "./rental-credit";
import { operation, prepareOperation, runOperation } from "./rental-finance-operations";
import { rentalFinanceReady } from "./rental-finance-settings";
import type { CancelJobResult } from "../customer-cancellation.service";
import { isLateFinancialCancellation } from "@/lib/subscriptions/rental-finance-policy";

export type JobFinance = { job_id: string; subscription_id: string; customer_id: string; property_id: string;
  quote: RentalCharge; scope: string; completion_cents: number | null; topup_consent_cents: number | null;
  cancellation: "late_customer" | "timely_customer" | "business" | null; canceled_at: string | null };
export async function jobFinance(jobId: string, writer: FinanceWriter = db) {
  if (!rentalFinanceReady()) return null;
  return rows<JobFinance>(await writer.execute(sql`select * from rental_job_finances where job_id=${jobId}::uuid`))[0] ?? null;
}
export async function isFinancialJob(jobId: string) {
  await assertFinanceCompatibility(jobId);
  if (!rentalFinanceReady()) return false;
  return rows(await db.execute(sql`select c.subscription_id from jobs j join rental_finance_contracts c on c.subscription_id=j.subscription_id where j.id=${jobId}::uuid`)).length > 0;
}

/** Freeze the scheduled obligation using the existing engine. Credit never
 * discounts the late fee, and first-clean promotional terms stay separate. */
export async function ensureJobFinance(jobId: string) {
  await assertFinanceCompatibility(jobId);
  if (!rentalFinanceReady()) return null;
  const existing = await jobFinance(jobId);
  if (existing) {
    const [owner] = rows<{ customer_id: string; subscription_id: string; property_id: string }>(await db.execute(sql`select p.customer_id,j.subscription_id,j.property_id from jobs j join properties p on p.id=j.property_id where j.id=${jobId}::uuid`));
    if (!owner || owner.customer_id !== existing.customer_id || owner.property_id !== existing.property_id || owner.subscription_id !== existing.subscription_id)
      throw new RentalFinanceError("Financial job ownership changed; management must reconcile the original contract");
    return existing;
  }
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId), with: { property: { with: { customer: true } }, subscription: true } });
  const contract = await financeContract(job?.subscriptionId);
  if (!contract) return null;
  if (!job?.property?.customer || !job.subscription || job.propertyId !== contract.property_id || job.property.customerId !== contract.customer_id ||
      job.serviceType !== "vacation_rental_subscription" || job.jobSource === "manual" || job.property.customer.skipPayment)
    throw new RentalFinanceError("Financial job scope or billing exception requires management review");
  if (job.paymentIntentId || job.paymentStatus) throw new RentalFinanceError("Enrolled job has an incompatible historical payment; reconcile before billing");
  const input = rentalJobPricingInput(job.property, job.subscription.durationMonths, job.addonsSnapshot);
  // Issued add-ons, not today's edited laundry/pet settings.
  input.laundryService = job.addonsSnapshot?.laundryType as typeof input.laundryService ?? input.laundryService;
  input.laundryLoads = job.addonsSnapshot?.laundryLoads ?? input.laundryLoads;
  input.petsAllowed = job.addonsSnapshot?.petsAllowed ?? input.petsAllowed;
  const price = await new PricingService().calculatePrice(input);
  const refusal = rentalQuoteRefusal(price, input); if (refusal) throw new RentalFinanceError(refusal);
  const quote = readRentalCharge(job.rentalCharge) ?? buildRentalCharge(price, job.addonsSnapshot, false);
  if (!job.rentalCharge && job.promoCodeId) {
    const { evaluation } = await resolvePromoCodeById(job.promoCodeId, quote.amountCents, job.property.customer.email);
    if (!evaluation.valid) throw new RentalFinanceError("The selected promo needs review before accepting a financial quote");
    quote.chargeAmountCents = evaluation.finalAmountCents;
    quote.promo = { promoCodeId: job.promoCodeId, code: evaluation.code, discountAmountCents: evaluation.discountCents };
  }
  return db.transaction(async tx => {
    const [current] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    const prior = await jobFinance(jobId, tx); if (prior) return prior;
    if (!current || current.subscriptionId !== job.subscriptionId || current.propertyId !== job.propertyId || current.paymentIntentId ||
        current.paymentStatus || current.status === "canceled" || current.status === "completed" || JSON.stringify(current.addonsSnapshot) !== JSON.stringify(job.addonsSnapshot) || current.promoCodeId !== job.promoCodeId)
      throw new RentalFinanceError("Job changed while preparing its financial quote. Reload and retry.");
    const [owner] = rows<{ customer_id: string; bed_count: number; bath_count: string; sq_ft: number }>(await tx.execute(sql`select customer_id,bed_count,bath_count,sq_ft from properties where id=${current.propertyId}::uuid for share`));
    if (!owner || owner.customer_id !== contract.customer_id || owner.bed_count !== job.property!.bedCount || Number(owner.bath_count) !== Number(job.property!.bathCount) || Number(owner.sq_ft) !== Number(job.property!.sqFt))
      throw new RentalFinanceError("Property pricing scope changed; reload before billing");
    const [saved] = rows<JobFinance>(await tx.execute(sql`insert into rental_job_finances(job_id,subscription_id,customer_id,property_id,quote,scope)
      values(${jobId}::uuid,${contract.subscription_id}::uuid,${contract.customer_id}::uuid,${contract.property_id}::uuid,${json(quote)},${rentalScope(input)}) returning *`));
    return saved;
  });
}
async function paymentParams(customerId: string, cents: number, offSession: boolean) {
  const stripe = getStripe(); if (!stripe) throw new RentalFinanceError("Payment provider unavailable");
  const [owner] = rows<{ stripe_customer_id: string }>(await db.execute(sql`select stripe_customer_id from customers where id=${customerId}::uuid`));
  if (!owner?.stripe_customer_id) throw new RentalFinanceError("Saved payment customer requires review");
  const methods = offSession ? await stripe.paymentMethods.list({ customer: owner.stripe_customer_id, type: "card", limit: 1 }) : null;
  if (offSession && !methods?.data.length) throw new RentalFinanceError("No saved payment method. Customer payment action is required.");
  return { amount: cents, currency: "usd", customer: owner.stripe_customer_id,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" as const },
    ...(offSession ? { payment_method: methods!.data[0].id, off_session: true, confirm: true } : {}) };
}

/** No date-bound credit allocation at preauthorization. New contracts collect
 * only after canonical evidence, or as a distinct cancellation obligation. */
export async function prepareFinancialJob(jobId: string) {
  return !!(await ensureJobFinance(jobId));
}
export async function prepareRentalCompletion(jobId: string, consent?: { actor: string; expectedCents: number }) {
  const f = await ensureJobFinance(jobId); if (!f) return null;
  const contract = (await financeContract(f.subscription_id))!;
  const source = await entitlement(contract.entitlement_id);
  if (!source) throw new RentalFinanceError("Prepayment provenance is missing");
  const stripe = getStripe(); if (!stripe) throw new RentalFinanceError("Payment provider unavailable");
  await verifyCreditSource(stripe, source);
  const prepared = await db.transaction(async tx => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!job || job.status !== "awaiting_capture") throw new RentalFinanceError("Canonical final evidence is required before supplemental payment or credit settlement");
    const [proof] = rows(await tx.execute(sql`select job_id from evidence_packets where job_id=${jobId}::uuid and status::text='complete' and final_evidence_submitted_at is not null`));
    if (!proof) throw new RentalFinanceError("Final evidence is missing");
    const e = (await entitlement(source.id, tx, true))!;
    const current = (await jobFinance(jobId, tx))!;
    // Preserve the purchased first-clean discount for matching scope. Periodic
    // due drain remains a separately scheduled component of the frozen quote.
    const matching = e.applied === 0 && e.balance > 0 && current.scope === e.purchase.scope;
    const acceptedFirstAmount = e.funded_cents + f.quote.drainCents;
    const total = current.completion_cents ?? (matching
      ? f.quote.promo ? Math.min(acceptedFirstAmount, f.quote.chargeAmountCents) : acceptedFirstAmount
      : f.quote.chargeAmountCents);
    await tx.execute(sql`update rental_job_finances set completion_cents=${total} where job_id=${jobId}::uuid`);
    const credit = await reserveCredit(tx, jobId, e, total);
    const due = total - credit;
    if (consent) {
      if (consent.expectedCents !== due || due <= 0) throw new RentalFinanceError("Supplemental amount changed; review the current quote before accepting");
      await tx.execute(sql`update rental_job_finances set topup_consent_cents=${due},topup_consent_actor=${consent.actor} where job_id=${jobId}::uuid`);
    }
    return { total, credit, due, requiresConsent: credit > 0 && due > 0 && current.topup_consent_cents !== due && !consent };
  });
  if (prepared.requiresConsent && (await operation(`clean:${jobId}`))?.state !== "waived") throw new RentalFinanceError(`Additional payment of $${(prepared.due / 100).toFixed(2)} requires customer approval in the job payment panel. Prepayment is reserved, not applied.`);
  if (prepared.due) {
    const identity = `clean:${jobId}`;
    let op = await operation(identity);
    if (!op) {
      const params = await paymentParams(f.customer_id, prepared.due, prepared.credit === 0);
      op = await prepareOperation(db, { identity, jobId, kind: "clean_payment", cents: prepared.due, params,
        actor: consent?.actor ?? "canonical-settlement", reason: prepared.credit ? "Explicitly accepted supplemental clean payment" : "Frozen scheduled clean payment after final evidence" });
    }
    if (!consent) {
      op = await runOperation(identity);
      if (op.state !== "paid" && op.state !== "waived") throw new RentalFinanceError(`Clean payment is ${op.state}; reconcile or complete customer payment before settlement`);
    } else op = await runOperation(identity);
    return { ...prepared, collectedCents: prepared.credit + (op.state === "waived" ? 0 : prepared.due), entitlementId: source.id, paymentId: op.provider_id, operationState: op.state };
  }
  return { ...prepared, collectedCents: prepared.total, entitlementId: source.id, paymentId: null, operationState: "paid" };
}
export async function applyRentalCompletion(tx: FinanceTx, jobId: string, expected: NonNullable<Awaited<ReturnType<typeof prepareRentalCompletion>>>) {
  const f = (await jobFinance(jobId, tx))!;
  if (!f || f.cancellation || f.completion_cents !== expected.total) throw new RentalFinanceError("Financial settlement changed");
  const [owner] = rows<{ customer_id: string }>(await tx.execute(sql`select customer_id from properties where id=${f.property_id}::uuid for share`));
  if (owner?.customer_id !== f.customer_id) throw new RentalFinanceError("Property ownership changed; reconcile its original financial contract");
  const missing = rows(await tx.execute(sql`select x.cleaner_id from jobs_to_cleaners x where x.job_id=${jobId}::uuid and x.role::text in('primary','laundry_lead') and not exists(
    select 1 from phase3a_assignment_offers o join phase3a_offer_jobs v on v.job_id=o.job_id and v.schedule_version=o.schedule_version where o.job_id=x.job_id and o.cleaner_id=x.cleaner_id and o.role=x.role::text and o.state='accepted')`));
  if (missing.length) throw new RentalFinanceError("Working acceptance changed before settlement; review worker obligations");
  const paid = await operation(`clean:${jobId}`, tx);
  if (expected.due && (!paid || !["paid", "waived"].includes(paid.state) || paid.cents !== expected.due)) throw new RentalFinanceError("Supplemental or clean payment is not settled");
  const used = await applyCredit(tx, jobId, expected.entitlementId);
  if (used !== expected.credit) throw new RentalFinanceError("Credit allocation changed");
  await tx.execute(sql`select set_config('cleannami.rental_finance','v1',true)`);
  await financeNotice(tx, `credit-applied:${jobId}`, f.customer_id, jobId, used ? "First-clean prepayment applied" : "Completed clean payment",
    [`Completed-clean total: $${(expected.total / 100).toFixed(2)}.`, `Prepayment applied: $${(used / 100).toFixed(2)}.`, `${paid?.state === "waived" ? "Additional balance waived" : "Separate payment"}: $${(expected.due / 100).toFixed(2)}.`]);
}

/** Cancellation and worker obligations commit before collection. Provider
 * failure never undoes cancellation or silently removes agreed cleaner pay. */
export async function cancelFinancialJob(jobId: string, source: "customer" | "admin", actor: string): Promise<CancelJobResult | null> {
  const f = await ensureJobFinance(jobId); if (!f) return null;
  const result = await db.transaction(async tx => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    const current = (await jobFinance(jobId, tx))!;
    if (!job) throw new RentalFinanceError("Job not found");
    const [owner] = rows<{ customer_id: string }>(await tx.execute(sql`select customer_id from properties where id=${f.property_id}::uuid for share`));
    if (owner?.customer_id !== f.customer_id) throw new RentalFinanceError("Property ownership changed; reconcile its original financial contract");
    if (current.cancellation) return { late: current.cancellation === "late_customer", count: 0, already: true };
    const [packet] = rows(await tx.execute(sql`select job_id from evidence_packets where job_id=${jobId}::uuid and gps_check_in_timestamp is not null`));
    const [clock] = rows<{ now: string }>(await tx.execute(sql`select clock_timestamp() now`));
    const lead = job.checkInTime ? +job.checkInTime - +new Date(clock.now) : -1;
    if (!["assigned", "unassigned"].includes(job.status ?? "") || packet || lead <= 0) throw new RentalFinanceError("Started/past jobs need separately reviewed cancellation");
    const late = source === "customer" && isLateFinancialCancellation(job.checkInTime!, new Date(clock.now));
    const assignments = await tx.query.jobsToCleaners.findMany({ where: eq(jobsToCleaners.jobId, jobId), with: { cleaner: true } });
    const accepted = rows<{ cleaner_id: string; role: string; version: number }>(await tx.execute(sql`select o.cleaner_id,o.role,o.version from phase3a_assignment_offers o
      join phase3a_offer_jobs v on v.job_id=o.job_id and v.schedule_version=o.schedule_version
      join jobs_to_cleaners x on x.job_id=o.job_id and x.cleaner_id=o.cleaner_id and x.role::text=o.role
      where o.job_id=${jobId}::uuid and o.state='accepted' and o.role in('primary','laundry_lead')`));
    const paid = late ? assignments.filter(a => accepted.some(o => o.cleaner_id === a.cleanerId && o.role === a.role)) : [];
    const terms = paid.map(a => {
      if (!a.frozenHourlyRateCents || a.frozenHourlyRateCents <= 0 || !job.expectedHours || Number(job.expectedHours) <= 0)
        throw new RentalFinanceError("Accepted working-pay terms are missing; review before financial cancellation");
      return { assignment: a, pay: computeCleanerPay({ expectedHours: Number(job.expectedHours),
      hourlyRateCents: a.frozenHourlyRateCents, role: a.role, laundryLoads: job.addonsSnapshot?.laundryLoads,
      urgentBonus: a.urgentBonus, settlement: "late_cancellation" }) };
    });
    const contract = (await financeContract(f.subscription_id, tx))!;
    await entitlement(contract.entitlement_id, tx, true);
    await tx.execute(sql`update prepaid_reservations set state='released' where job_id=${jobId}::uuid and state='active'`);
    await tx.execute(sql`update rental_job_finances set cancellation=${late ? "late_customer" : source === "admin" ? "business" : "timely_customer"},canceled_at=clock_timestamp() where job_id=${jobId}::uuid`);
    await tx.execute(sql`select set_config('cleannami.rental_finance','v1',true)`);
    await tx.update(jobs).set({ status: "canceled", updatedAt: new Date() }).where(eq(jobs.id, jobId));
    for (const { assignment: a, pay } of terms) await tx.insert(payouts).values({ jobId, cleanerId: a.cleanerId,
      amount: pay.total.toFixed(2), payReceipt: pay.receipt ?? null, urgentBonusAmount: pay.urgentBonus?.toFixed(2) ?? null,
      laundryBonusAmount: pay.laundryBonus?.toFixed(2) ?? null, status: "pending" }).onConflictDoNothing({ target: [payouts.jobId, payouts.cleanerId] });
    await tx.execute(sql`insert into rental_finance_audit(identity,job_id,actor,action,reason,details)
      values(${`cancellation:${jobId}`},${jobId}::uuid,${actor},'record_cancellation',${late ? "Customer cancellation inside 24 hours" : "Fee-free cancellation"},
      ${json({ source, acceptedOffers: accepted, payouts: terms.map(({ assignment, pay }) => ({ cleanerId: assignment.cleanerId, role: assignment.role, rateCents: assignment.frozenHourlyRateCents, expectedHours: job.expectedHours, laundryLoads: job.addonsSnapshot?.laundryLoads ?? 0, urgentBonus: assignment.urgentBonus, cents: Math.round(pay.total * 100) })) })}) on conflict do nothing`);
    // Keep assignment/pay history. Offer invalidation and authorization derive
    // from canceled status; no timer may now turn standby into working pay.
    await tx.execute(sql`update phase3a_assignment_offers set state='revoked',revoked_at=clock_timestamp(),reason='job_canceled' where job_id=${jobId}::uuid and state in('pending','accepted')`);
    await financeNotice(tx, `cancel:${jobId}`, f.customer_id, jobId, late ? "Clean late canceled" : "Clean canceled",
      [late ? `Late-cancellation fee assessed: $${(f.quote.chargeAmountCents / 100).toFixed(2)}. See the job portal for its current collection, waiver or refund status.` : "No late-cancellation fee.",
        "Your unused first-clean prepayment remains available for this property. The clean was canceled, not completed."]);
    return { late, count: paid.length, already: false };
  });
  let charged = false;
  if (result.late) {
    try {
      const identity = `late:${jobId}`;
      if (!(await operation(identity))) {
        const params = await paymentParams(f.customer_id, f.quote.chargeAmountCents, true);
        await prepareOperation(db, { identity, jobId, kind: "late_fee", cents: f.quote.chargeAmountCents, params, actor, reason: "Customer cancellation inside 24 hours; independent of prepayment" });
      }
      charged = (await runOperation(identity)).state === "paid";
    } catch {
      // Cancellation is durable; the fee stays visibly due and can be retried
      // with its original identity. Missing card/config never erases the debt.
    }
  }
  return { jobId, lateCancel: result.late, cleanersReleased: result.already ? 0 : result.count,
    customerCharged: charged, cleanerPaid: false,
    message: result.late ? `Clean late canceled. Fee ${charged ? "collected" : "pending or requiring payment review"}; accepted working-cleaner payouts are recorded separately. Unused prepayment is preserved.`
      : "Clean canceled without a late fee. Unused first-clean prepayment is preserved." };
}
