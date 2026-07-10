ALTER TABLE "cleaners"
ADD COLUMN IF NOT EXISTS "availability_late_override_period_start" date;
