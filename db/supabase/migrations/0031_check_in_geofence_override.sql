-- Geofenced check-in.
--
-- Check-in is now refused when the cleaner's device is CONFIDENTLY outside the
-- property's geofence. "Confidently" matters: a fix whose own error radius is
-- wider than the fence cannot place the device either way, and those are let
-- through and flagged rather than blocked.
--
-- A refused cleaner who is genuinely on site can proceed by stating a reason.
-- That is not a loophole, it is the required escape hatch: consumer GPS is
-- wrong often enough (indoors, urban multipath, iOS reduced accuracy) that a
-- block with no override would strand people at the door with no way to start
-- work. The reason is recorded here and raised to admins for review.

ALTER TABLE public.evidence_packets
  ADD COLUMN IF NOT EXISTS check_in_override_reason text,
  ADD COLUMN IF NOT EXISTS check_in_override_at timestamptz;

COMMENT ON COLUMN public.evidence_packets.check_in_override_reason IS
  'Cleaner-supplied justification for checking in while outside the geofence. NULL means the check-in was not overridden.';

COMMENT ON COLUMN public.evidence_packets.check_in_override_at IS
  'When the geofence override was exercised. Always set together with check_in_override_reason.';

-- Admin review queue: find overridden check-ins without scanning the table.
CREATE INDEX IF NOT EXISTS evidence_packets_check_in_override_idx
  ON public.evidence_packets (check_in_override_at)
  WHERE check_in_override_at IS NOT NULL;
