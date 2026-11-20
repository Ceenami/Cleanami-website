import "server-only";

import { db } from "@/db";
import { processedStripeEvents, stripeWebhookClaims as claims } from "@/db/schemas";
import { eq, and, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { assertMoneyRecoveryReady } from "../payment/money-recovery-settings";

const CLAIM_LEASE_MS = 15 * 60 * 1000;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Legacy processed rows stay completed. New claims are NOT completions. A
 * process death leaves a lease that a later Stripe retry can reclaim.
 */
export async function claimStripeWebhook(event: Stripe.Event): Promise<
  { state: "completed" } | { state: "busy" } | { state: "claimed"; token: string }
> {
  assertMoneyRecoveryReady();
  const payloadHash = createHash("sha256").update(canonical([event.type, event.account ?? null, event.data])).digest("hex");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`stripe-event:${event.id}`},0))`);
    const current = await tx.query.stripeWebhookClaims.findFirst({ where: eq(claims.eventId, event.id) });
    if (!current) {
      const legacy = await tx.query.processedStripeEvents.findFirst({ where: eq(processedStripeEvents.eventId, event.id) });
      if (legacy) return { state: "completed" };
    }
    if (current && (current.eventType !== event.type || current.payloadHash !== payloadHash)) throw new Error("Stripe event identity changed");
    if (current?.state === "completed") return { state: "completed" };
    if (current?.state === "processing" && Date.now() - current.claimedAt.getTime() < CLAIM_LEASE_MS) return { state: "busy" };
    const token = randomUUID(), claimedAt = new Date();
    if (current) await tx.update(claims).set({ state: "processing", token, claimedAt, completedAt: null }).where(eq(claims.eventId, event.id));
    else await tx.insert(claims).values({ eventId: event.id, eventType: event.type, payloadHash, state: "processing", token, claimedAt });
    return { state: "claimed", token };
  });
}

export async function finishStripeWebhook(eventId: string, token: string) {
  await db.transaction(async tx => {
    // Use the same lock as claiming. Otherwise a stale-lease reclaimer could
    // read processing, wait for this completion, then overwrite completed.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`stripe-event:${eventId}`},0))`);
    const [claim] = await tx.select().from(claims).where(eq(claims.eventId, eventId)).for("update");
    if (!claim || claim.token !== token || claim.state !== "processing") throw new Error("Stripe event lease lost before completion");
    await tx.insert(processedStripeEvents).values({ eventId, eventType: claim.eventType }).onConflictDoNothing({ target: processedStripeEvents.eventId });
    await tx.update(claims).set({ state: "completed", completedAt: new Date() }).where(eq(claims.eventId, eventId));
  });
}

export async function failStripeWebhook(eventId: string, token: string) {
  await db.update(claims).set({ state: "failed" }).where(and(eq(claims.eventId, eventId), eq(claims.token, token), eq(claims.state, "processing")));
}

/**
 * Records a Stripe event id as processed and reports whether this is the first
 * time we've seen it. Relies on the unique index on `event_id`:
 * `onConflictDoNothing` inserts nothing on a replay, so an empty `returning()`
 * means the event was already handled.
 *
 * Legacy caller compatibility only. Webhooks must use the recoverable claim /
 * completion functions above, never this pre-handler receipt marker.
 * Usage in legacy money crons:
 *   if (!(await markStripeEventProcessed(event.id, event.type))) return ok();
 *
 * @returns true if newly recorded (process it), false if already processed (skip).
 */
export async function markStripeEventProcessed(
  eventId: string,
  eventType: string
): Promise<boolean> {
  const inserted = await db
    .insert(processedStripeEvents)
    .values({ eventId, eventType })
    .onConflictDoNothing({ target: processedStripeEvents.eventId })
    .returning({ id: processedStripeEvents.id });

  return inserted.length > 0;
}
