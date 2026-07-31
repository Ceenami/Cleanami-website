-- Makes a job with an evidence packet deletable again.
--
-- `evidence_packets.job_id` is NOT NULL, but its foreign key was declared
-- ON DELETE SET NULL. Those two are contradictory: deleting a job made Postgres
-- try to null a NOT NULL column, so the delete failed with a constraint
-- violation and every job that had ever been checked into became permanently
-- undeletable.
--
-- That is not just a tidiness problem. `scripts/seed-demo-cleaner-jobs.mjs`
-- begins by deleting its previously seeded jobs, so a single tagged job with a
-- packet made re-seeding the demo environment impossible without hand surgery
-- on the database.
--
-- CASCADE is the correct semantic: an evidence packet is a record *of* a job
-- and has no independent meaning once that job is gone.
ALTER TABLE "evidence_packets"
  DROP CONSTRAINT IF EXISTS "evidence_packets_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "evidence_packets"
  ADD CONSTRAINT "evidence_packets_job_id_jobs_id_fk"
  FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
