import "server-only";

import { db } from "@/db";
import { processedStripeEvents } from "@/db/schemas";

/**
 * Records a Stripe event id as processed and reports whether this is the first
 * time we've seen it. Relies on the unique index on `event_id`:
 * `onConflictDoNothing` inserts nothing on a replay, so an empty `returning()`
 * means the event was already handled.
 *
 * Usage in the webhook / money crons:
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
