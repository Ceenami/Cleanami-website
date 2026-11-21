import "server-only";
import { RentalFinanceError } from "./rental-finance-error";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import type { RentalCheckoutTerms } from "@/db/schemas";
import { rentalFinanceReady, RENTAL_FINANCE_POLICY } from "./rental-finance-settings";
import { PURCHASE_DATE_START, purchaseTermDates } from "@/lib/subscriptions/purchase-start";

export type FinanceTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type FinanceWriter = FinanceTx | typeof db;
export const rows = <T>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
export const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
export type Entitlement = { id: string; customer_id: string; property_id: string; source_payment_id: string;
  funded_cents: number; purchase: { scope: string; price: RentalCheckoutTerms["price"]; form: Record<string, unknown>; serviceNotBefore?: string };
  state: "active" | "held"; hold_reason: string | null; balance: number; applied: number; reserved: number };
export type FinanceContract = { subscription_id: string; customer_id: string; property_id: string; entitlement_id: string; policy: string;
  reactivation_terms: { startDate: string; endDate: string; minimumEndsAt: string; requestId: string; sourceSubscriptionId: string } | null };
/** Disabling enrollment is supported; disabling readers cannot route an
 * enrolled obligation back into legacy financial handling. */
export async function assertFinanceCompatibility(jobId: string, writer: FinanceWriter = db) {
  if (rentalFinanceReady()) return;
  const [catalog] = rows<{ present: string | null }>(await writer.execute(sql`select to_regclass('public.rental_finance_contracts')::text present`));
  if (!catalog?.present) return;
  if (rows(await writer.execute(sql`select c.subscription_id from rental_finance_contracts c join jobs j on j.subscription_id=c.subscription_id where j.id=${jobId}::uuid`)).length)
    throw new RentalFinanceError("Recorded prepaid/separate-fee contract requires compatible readers. Restore schema readiness before financial processing.");
}

/** Only service/pricing inputs; never access codes, customer notes or dates. */
export function rentalScope(input: Record<string, unknown>) {
  const laundry = input.laundryService ?? "none";
  // A recorded tub with no booked service is not an extra cleaning scope.
  // Periodic drain occurrence is priced separately on the scheduled quote.
  const values = [Number(input.bedrooms), Number(input.bathrooms), Number(input.sqft ?? 0),
    laundry, laundry === "none" ? 0 : Number(input.laundryLoads ?? 0), !!input.petsAllowed,
    !!input.hasHotTub && !!input.hotTubService];
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
export async function financeContract(subscriptionId: string | null | undefined, writer: FinanceWriter = db) {
  if (!rentalFinanceReady() || !subscriptionId) return null;
  return rows<FinanceContract>(await writer.execute(sql`select * from rental_finance_contracts where subscription_id=${subscriptionId}::uuid`))[0] ?? null;
}
export async function entitlement(id: string, writer: FinanceWriter = db, lock = false) {
  if (lock) await writer.execute(sql`select id from prepaid_entitlements where id=${id}::uuid for update`);
  return rows<Entitlement>(await writer.execute(sql`select e.*,
    coalesce((select sum(cents)::int from prepaid_entries where entitlement_id=e.id),0) balance,
    coalesce((select -sum(cents)::int from prepaid_entries where entitlement_id=e.id and kind='application'),0) applied,
    coalesce((select sum(cents)::int from prepaid_reservations where entitlement_id=e.id and state='active'),0) reserved
    from prepaid_entitlements e where e.id=${id}::uuid`))[0] ?? null;
}
export async function recordRentalFunding(tx: FinanceTx, subscription: { id: string; customerId: string; propertyId: string },
  pi: Stripe.PaymentIntent, terms: RentalCheckoutTerms | undefined) {
  const policy = pi.metadata?.rental_finance_policy;
  if (!policy) return false;
  if (policy !== RENTAL_FINANCE_POLICY || !rentalFinanceReady() || !terms || terms.financePolicy !== policy ||
      pi.status !== "succeeded" || pi.currency !== "usd" || pi.amount_received !== pi.amount || pi.amount < 50)
    throw new RentalFinanceError("Accepted prepayment needs compatible credit setup. Preserve payment and retry; do not pay again.");
  if (!rows(await tx.execute(sql`select identity from rental_finance_audit where identity=${`consent:${pi.id}`} and action='accept_financial_terms' and details->>'policy'=${policy}`)).length)
    throw new RentalFinanceError("Accepted financial terms are missing; preserve payment for management review");
  const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const serviceNotBefore = terms.subscriptionStartPolicy === PURCHASE_DATE_START
    ? purchaseTermDates(charge?.created ?? 0, Number(terms.form.subscriptionMonths)).serviceNotBefore : undefined;
  const purchase = { scope: rentalScope(terms.form), form: terms.form, price: terms.price,
    ...(serviceNotBefore ? { serviceNotBefore } : {}) };
  const [e] = rows<{ id: string }>(await tx.execute(sql`insert into prepaid_entitlements(customer_id,property_id,source_payment_id,funded_cents,purchase)
    values(${subscription.customerId}::uuid,${subscription.propertyId}::uuid,${pi.id},${pi.amount},${json(purchase)}) returning id`));
  await tx.execute(sql`insert into prepaid_entries(entitlement_id,kind,cents,identity,actor,reason)
    values(${e.id}::uuid,'funding',${pi.amount},${`fund:${pi.id}`},'paid-onboarding','Verified first-clean purchase')`);
  await tx.execute(sql`insert into rental_finance_contracts(subscription_id,customer_id,property_id,entitlement_id,policy)
    values(${subscription.id}::uuid,${subscription.customerId}::uuid,${subscription.propertyId}::uuid,${e.id}::uuid,${policy})`);
  return true;
}
export async function financeNotice(tx: FinanceWriter, identity: string, customerId: string, jobId: string | null, subject: string, lines: string[]) {
  await tx.execute(sql`insert into rental_finance_notices(identity,customer_id,job_id,subject,lines)
    values(${identity},${customerId}::uuid,${jobId}::uuid,${subject},${json(lines)}) on conflict do nothing`);
}

/** Fresh source truth before spending. Approved partial refunds reconcile to
 * ledger entries; unknown dashboard refunds/disputes freeze remaining credit. */
export async function verifyCreditSource(stripe: Stripe, e: Entitlement) {
  try {
    const pi = await stripe.paymentIntents.retrieve(e.source_payment_id, { expand: ["latest_charge"] });
    const customer = typeof pi.customer === "string" ? pi.customer : pi.customer?.id;
    const [owner] = rows<{ stripe_customer_id: string }>(await db.execute(sql`select stripe_customer_id from customers where id=${e.customer_id}::uuid`));
    const charge = typeof pi.latest_charge === "string" ? await stripe.charges.retrieve(pi.latest_charge) : pi.latest_charge;
    const refunds = await stripe.refunds.list({ payment_intent: pi.id, limit: 100 });
    const successfulRefunds = refunds.data.filter(r => r.status === "succeeded").reduce((sum, r) => sum + r.amount, 0);
    const [ledger] = rows<{ cents: number }>(await db.execute(sql`select coalesce(-sum(cents),0)::int cents from prepaid_entries where entitlement_id=${e.id}::uuid and kind='refund'`));
    const chargePi = typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id;
    if (pi.id !== e.source_payment_id || pi.status !== "succeeded" || pi.currency !== "usd" || pi.amount !== e.funded_cents ||
        pi.amount_received !== e.funded_cents || !owner?.stripe_customer_id || customer !== owner.stripe_customer_id ||
        !charge || chargePi !== pi.id || !charge.paid || !charge.captured || charge.disputed || charge.currency !== "usd" || charge.amount !== e.funded_cents ||
        refunds.has_more || refunds.data.some(r => ["pending", "requires_action"].includes(r.status ?? "")) ||
        charge.amount_refunded !== successfulRefunds || successfulRefunds !== ledger.cents)
      throw new RentalFinanceError("Prepayment has a refund, dispute or funding mismatch requiring reconciliation");
  } catch (error) {
    // Fail closed on uncertain source state too. A reasoned admin reconciliation
    // is required to release the hold; never restore spendability on an old event.
    await db.execute(sql`update prepaid_entitlements set state='held',hold_reason='Source payment needs reconciliation' where id=${e.id}::uuid`);
    throw error;
  }
}

export async function reserveCredit(tx: FinanceTx, jobId: string, e: Entitlement, amount: number) {
  if (e.state !== "active") throw new RentalFinanceError("Prepayment is held for reconciliation");
  const existing = rows<{ cents: number; state: string }>(await tx.execute(sql`select cents,state from prepaid_reservations where job_id=${jobId}::uuid`))[0];
  if (existing) {
    if (existing.state !== "active") throw new RentalFinanceError("Credit reservation is already terminal");
    return existing.cents;
  }
  if (e.reserved) throw new RentalFinanceError("Another clean is settling this prepayment. Retry after that settlement is resolved.");
  const cents = Math.min(e.balance, amount);
  if (cents > 0) await tx.execute(sql`insert into prepaid_reservations(job_id,entitlement_id,cents) values(${jobId}::uuid,${e.id}::uuid,${cents})`);
  return cents;
}
export async function applyCredit(tx: FinanceTx, jobId: string, entitlementId: string) {
  await entitlement(entitlementId, tx, true);
  const [r] = rows<{ cents: number; state: string }>(await tx.execute(sql`select cents,state from prepaid_reservations where job_id=${jobId}::uuid and entitlement_id=${entitlementId}::uuid`));
  if (!r || r.state === "applied") return r?.cents ?? 0;
  if (r.state !== "active") throw new RentalFinanceError("Credit was released; settlement requires review");
  await tx.execute(sql`insert into prepaid_entries(entitlement_id,job_id,kind,cents,identity,actor,reason)
    values(${entitlementId}::uuid,${jobId}::uuid,'application',${-r.cents},${`complete:${jobId}`},'canonical-settlement','First eligible completed-clean settlement') on conflict do nothing`);
  await tx.execute(sql`update prepaid_reservations set state='applied' where job_id=${jobId}::uuid and state='active'`);
  return r.cents;
}
