import "server-only";
import { financeContract } from "./payment/rental-credit";
import { db, type Database } from "@/db";
import { subscriptionMinimums } from "@/db/schemas";
import { inArray } from "drizzle-orm";
import { THIRTY_DAY_MINIMUM, legacySubscriptionMinimum, thirtyDayMinimum, type SubscriptionMinimum } from "@/lib/subscriptions/minimum";

type Writer = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
export const subscriptionMinimumSchemaReady = () => process.env.SUBSCRIPTION_MINIMUM_SCHEMA_READY === "true";
export function newSignupMinimumPolicy() {
  return subscriptionMinimumSchemaReady() && process.env.SUBSCRIPTION_MINIMUM_ENROLLMENT === "true" ? THIRTY_DAY_MINIMUM : undefined;
}

/** Read only the server-created PaymentIntent metadata, never a form policy value. */
export async function recordSubscriptionMinimum(writer: Writer, subscription: { id: string; startDate: string; firstCleanPaymentId: string | null }, paymentPolicy?: string) {
  if (!paymentPolicy) return; // Already accepted legacy payments keep their old contract.
  if (paymentPolicy !== THIRTY_DAY_MINIMUM) throw Error("Unsupported subscription minimum policy");
  if (!subscriptionMinimumSchemaReady()) throw Error("Subscription minimum schema is not ready; preserve the accepted payment and retry setup");
  const minimum = thirtyDayMinimum(subscription.startDate);
  if (!subscription.firstCleanPaymentId) throw Error("Subscription minimum requires payment provenance");
  await writer.insert(subscriptionMinimums).values({ subscriptionId: subscription.id, policy: minimum.policy,
    startDate: subscription.startDate, endsAt: new Date(minimum.endsAt), paymentIntentId: subscription.firstCleanPaymentId });
}

/** Call after scoping the subscriptions themselves; never return another owner's rows. */
export async function withSubscriptionMinimums<T extends { id: string; startDate: string | Date }>(rows: T[], database: Writer = db): Promise<(T & { cancellationMinimum: SubscriptionMinimum })[]> {
  const snapshots = subscriptionMinimumSchemaReady() && rows.length
    ? await database.select().from(subscriptionMinimums).where(inArray(subscriptionMinimums.subscriptionId, rows.map(row => row.id))) : [];
  const byId = new Map(snapshots.map(snapshot => [snapshot.subscriptionId, snapshot]));
  const reactivated = new Map<string, SubscriptionMinimum>();
  for (const row of rows) if (!byId.has(row.id)) {
    const terms = (await financeContract(row.id, database))?.reactivation_terms;
    if (terms) {
      const start = typeof row.startDate === "string" ? row.startDate : row.startDate.toISOString().slice(0, 10);
      if (start !== terms.startDate || terms.minimumEndsAt !== thirtyDayMinimum(terms.startDate).endsAt) throw Error("Recorded reactivation minimum requires review");
      reactivated.set(row.id, { policy: THIRTY_DAY_MINIMUM, endsAt: terms.minimumEndsAt });
    }
  }
  return rows.map(row => {
    const saved = byId.get(row.id);
    if (saved && (saved.policy !== THIRTY_DAY_MINIMUM || saved.endsAt.toISOString() !== thirtyDayMinimum(saved.startDate).endsAt))
      throw Error("Invalid recorded subscription minimum; contact support");
    return { ...row, cancellationMinimum: saved
      ? { policy: THIRTY_DAY_MINIMUM, endsAt: saved.endsAt.toISOString() }
      : reactivated.get(row.id) ?? legacySubscriptionMinimum(row.startDate) };
  });
}
