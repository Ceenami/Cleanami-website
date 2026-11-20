import "server-only";
import { RentalFinanceError } from "./rental-finance-error";
import { db } from "@/db";
import { subscriptions } from "@/db/schemas";
import { eq, sql } from "drizzle-orm";
import { rows, json, financeContract, entitlement } from "./rental-credit";
import { RENTAL_FINANCE_POLICY, rentalFinanceReady } from "./rental-finance-settings";
import { thirtyDayMinimum } from "@/lib/subscriptions/minimum";
import { rentalReactivationEndDate } from "@/lib/subscriptions/rental-finance-policy";
import { toEasternDateString } from "@/lib/time/eastern";
import { auditFinance } from "./rental-finance-admin";

/** Explicit new term on the SAME property and owner, with no new first-clean
 * purchase. Original subscription, accepted dates, ledger and receipts remain. */
export async function reactivateRentalSubscription(subscriptionId: string, actor: string, input: { startDate: string; endDate: string; durationMonths: number; reason: string; requestId: string }) {
  if (!rentalFinanceReady()) throw new RentalFinanceError("Credit schema is not ready");
  for (const value of [input.startDate, input.endDate]) if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T12:00Z`).toISOString().slice(0, 10) !== value) throw new RentalFinanceError("Choose valid service dates");
  if (input.startDate < toEasternDateString(new Date()) || input.endDate < input.startDate || input.reason.trim().length < 10 || !Number.isInteger(input.durationMonths) || input.durationMonths < 1 || input.durationMonths > 6) throw new RentalFinanceError("Provide an explicit future term, selected duration and reason");
  const minimum = thirtyDayMinimum(input.startDate);
  if (input.endDate !== rentalReactivationEndDate(input.startDate, input.durationMonths)) throw new RentalFinanceError(`The selected ${input.durationMonths}-month term ends on ${rentalReactivationEndDate(input.startDate, input.durationMonths)}. Review the agreed dates before reactivation.`);
  if (input.endDate < toEasternDateString(new Date(minimum.endsAt))) throw new RentalFinanceError("The new term must cover its 30-day minimum");
  return db.transaction(async tx => {
    const original = await tx.query.subscriptions.findFirst({ where: eq(subscriptions.id, subscriptionId) });
    const contract = await financeContract(subscriptionId, tx);
    if (!original || !contract) throw new RentalFinanceError("Enrolled subscription not found");
    await tx.execute(sql`select id from properties where id=${contract.property_id}::uuid for update`);
    const [prior] = rows<{ subscription_id: string; reactivation_terms: { sourceSubscriptionId: string; startDate: string; endDate: string } }>(await tx.execute(sql`select subscription_id,reactivation_terms from rental_finance_contracts where reactivation_terms->>'requestId'=${input.requestId}`));
    if (prior) {
      if (prior.reactivation_terms.sourceSubscriptionId !== subscriptionId) throw new RentalFinanceError("Reactivation request belongs to another subscription");
      const created = await tx.query.subscriptions.findFirst({ where: eq(subscriptions.id, prior.subscription_id) });
      if (prior.reactivation_terms.startDate !== input.startDate || prior.reactivation_terms.endDate !== input.endDate || created?.durationMonths !== input.durationMonths)
        throw new RentalFinanceError("Reactivation request already has different accepted dates or term");
      return { subscriptionId: prior.subscription_id, alreadyCreated: true };
    }
    if (!["expired", "canceled"].includes(original.status)) throw new RentalFinanceError("Only an ended or canceled subscription can start an explicit new term; resume paused terms separately");
    const [property] = rows<{ customer_id: string }>(await tx.execute(sql`select customer_id from properties where id=${contract.property_id}::uuid`));
    if (property.customer_id !== contract.customer_id) throw new RentalFinanceError("Credit cannot transfer to a new property owner");
    if (rows(await tx.execute(sql`select id from subscriptions where property_id=${contract.property_id}::uuid and status::text in('active','paused','pending')`)).length) throw new RentalFinanceError("This property already has a live subscription");
    const e = (await entitlement(contract.entitlement_id, tx, true))!;
    if (e.state !== "active" || e.reserved) throw new RentalFinanceError("Resolve held/reserved prepayment before reactivation");
    const [next] = await tx.insert(subscriptions).values({ customerId: contract.customer_id, propertyId: contract.property_id,
      durationMonths: input.durationMonths, startDate: input.startDate, endDate: input.endDate, status: "active", isFirstCleanPrepaid: false }).returning();
    const terms = { startDate: input.startDate, endDate: input.endDate, minimumEndsAt: minimum.endsAt, requestId: input.requestId, sourceSubscriptionId: subscriptionId };
    await tx.execute(sql`insert into rental_finance_contracts(subscription_id,customer_id,property_id,entitlement_id,policy,reactivation_terms)
      values(${next.id}::uuid,${contract.customer_id}::uuid,${contract.property_id}::uuid,${e.id}::uuid,${RENTAL_FINANCE_POLICY},${json(terms)})`);
    await auditFinance(tx, `reactivate:${input.requestId}`, actor, "reactivate_subscription", input.reason, null, e.id, { ...terms, subscriptionId: next.id, durationMonths: input.durationMonths });
    return { subscriptionId: next.id, alreadyCreated: false };
  });
}
