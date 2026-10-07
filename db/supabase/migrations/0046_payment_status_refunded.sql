-- Keep the payment record after a prepaid job is refunded.
-- Apply before deploying code that writes payment_status = 'refunded'.

ALTER TYPE "payment_status" ADD VALUE IF NOT EXISTS 'refunded';
