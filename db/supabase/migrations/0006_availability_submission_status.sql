CREATE TYPE "public"."availability_submission_status" AS ENUM('on_time', 'late_accepted', 'late_warning');

ALTER TABLE "availability"
ADD COLUMN "submission_status" "availability_submission_status" DEFAULT 'on_time' NOT NULL;
