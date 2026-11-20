import "server-only";
import { financeContract } from "./payment/rental-credit";
import { db, type Database } from "@/db";
import { subscriptionTerms, subscriptions, phase2cAudit } from "@/db/schemas";
import { and, eq, inArray, lt } from "drizzle-orm";
import { toEasternDateString } from "@/lib/time/eastern";
import { newSignupMinimumPolicy } from "./subscription-minimum.service";
type Writer = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
export const STOP_AT_TERM_END = "stop_at_selected_end_v1";
export const subscriptionTermReady = () => process.env.SUBSCRIPTION_TERM_SCHEMA_READY === "true";
export function newSignupTermPolicy() {
  if (process.env.SUBSCRIPTION_TERM_ENROLLMENT !== "true") return undefined;
  if (!subscriptionTermReady() || !newSignupMinimumPolicy()) throw Error("Subscription term and minimum schemas/enrollment must be ready before new term purchases");
  return STOP_AT_TERM_END;
}
export async function recordSubscriptionTerm(writer: Writer, subscription: { id: string; startDate: string; endDate: string; firstCleanPaymentId: string | null }, policy?: string) {
  if (!policy) return;
  if (policy !== STOP_AT_TERM_END || !subscriptionTermReady() || !subscription.firstCleanPaymentId) throw Error("Accepted subscription term needs compatible setup; preserve payment and retry");
  await writer.insert(subscriptionTerms).values({ subscriptionId: subscription.id, policy, startDate: subscription.startDate, endDate: subscription.endDate, paymentIntentId: subscription.firstCleanPaymentId });
}
export async function readSubscriptionTerm(subscriptionId: string, writer: Writer = db) {
  const [term] = subscriptionTermReady() ? await writer.select().from(subscriptionTerms).where(eq(subscriptionTerms.subscriptionId, subscriptionId)) : [];
  if (term && term.policy !== STOP_AT_TERM_END) throw Error("Unsupported recorded subscription term");
  if (term) return term;
  const reactivated = (await financeContract(subscriptionId, writer))?.reactivation_terms;
  return reactivated ? { subscriptionId, policy: STOP_AT_TERM_END, startDate: reactivated.startDate, endDate: reactivated.endDate, paymentIntentId: null } : null;
}
export function withinRecordedTerm(term: { startDate: string; endDate: string }, start: Date) {
  const day = toEasternDateString(start);
  return day >= term.startDate && day <= term.endDate;
}
export async function assertSubscriptionServiceAllowed(subscriptionId: string, start: Date, writer: Writer = db) {
  const term = await readSubscriptionTerm(subscriptionId, writer);
  if (!term) return;
  const [subscription] = await writer.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.id, subscriptionId));
  if (subscription?.status !== "active" || !withinRecordedTerm(term, start)) throw Error("This clean is outside the active recorded subscription term; review or explicitly extend service before booking or authorizing it");
}
export async function withSubscriptionTerms<T extends { id: string }>(rows: T[]) {
  const terms = subscriptionTermReady() && rows.length ? await db.select().from(subscriptionTerms).where(inArray(subscriptionTerms.subscriptionId, rows.map(row => row.id))) : [];
  const byId = new Map(terms.map(term => [term.subscriptionId, term]));
  const reactivated = new Set<string>();
  for (const row of rows) if (!byId.has(row.id) && (await financeContract(row.id))?.reactivation_terms) reactivated.add(row.id);
  return rows.map(row => ({ ...row, termEndPolicy: byId.get(row.id)?.policy ?? (reactivated.has(row.id) ? STOP_AT_TERM_END : null) }));
}
/** Status-only expiry. Issued jobs, payments, refunds, discounts and credit stay intact. */
export async function expireRecordedSubscriptionTerms(now = new Date()) {
  if (!subscriptionTermReady() || process.env.SUBSCRIPTION_TERM_WORKER_ENABLED !== "true") return { disabled: true, expired: 0 };
  const today = toEasternDateString(now);
  const due = await db.select({ term: subscriptionTerms }).from(subscriptionTerms)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionTerms.subscriptionId))
    .where(and(lt(subscriptionTerms.endDate, today), inArray(subscriptions.status, ["active", "paused"]))).limit(100);
  let expired = 0;
  for (const { term } of due) {
    await db.transaction(async tx => {
      const [current] = await tx.select().from(subscriptions).where(eq(subscriptions.id, term.subscriptionId)).for("update");
      if (!current || !["active", "paused"].includes(current.status)) return;
      await tx.update(subscriptions).set({ status: "expired", updatedAt: now }).where(and(eq(subscriptions.id, term.subscriptionId), inArray(subscriptions.status, ["active", "paused"])));
      await tx.insert(phase2cAudit).values({ subjectId: current.id, kind: "subscription_term_ended", actorId: "subscription-term-worker", payload: { endDate: term.endDate, policy: term.policy } });
      expired++;
    });
  }
  return { expired };
}
