import "server-only";

export function assertMoneyRecoveryReady() {
  if (process.env.MONEY_RECOVERY_SCHEMA_READY !== "true") {
    throw new Error("Payment recovery schema is not ready. Contact CleanNami before paying again.");
  }
}

/** Stop before Stripe's minimum 24h API-v1 idempotency retention expires. */
export const PROVIDER_RETRY_WINDOW_MS = 20 * 60 * 60 * 1000;

export function payoutTransferRolloutAt() {
  const value = process.env.PAYOUT_TRANSFER_ROLLOUT_AT;
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Payout transfer cutover is not configured; reconcile old pending payouts before enabling transfers.");
  }
  return new Date(value);
}
