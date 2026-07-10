ALTER TYPE "public"."job_status" ADD VALUE IF NOT EXISTS 'completed_pending_evidence' BEFORE 'completed';
ALTER TYPE "public"."job_status" ADD VALUE IF NOT EXISTS 'awaiting_capture' BEFORE 'completed';
