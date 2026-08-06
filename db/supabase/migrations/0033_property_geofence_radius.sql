-- Per-property check-in geofence radius.
--
-- The geofence was a single hardcoded constant (0.3 mi / ~483 m) applied to
-- every property. That is wrong at both ends: a townhouse wants a tighter fence
-- than 483 m, and a property with a large lot can have its front door legitimately
-- that far from the geocoded street pin — the cleaner is standing at the door and
-- the server refuses them.
--
-- The radius is therefore a property attribute. NULL means "use the system
-- default", which is what every existing row gets, so this migration does not
-- change the behaviour of a single property until an admin deliberately sets one.
--
-- Stored in METRES even though the rest of the GPS code works in miles
-- (evidence_packets.check_in_distance_miles and friends). Metres are the unit
-- admins and the client actually reason about ("allow up to 1000 m"), and a
-- whole-number metre value round-trips through a form without the drift that a
-- decimal-mile field would introduce. Conversion happens once, in
-- lib/services/gps/geofence.ts.
--
-- The bounds are enforced here rather than only in application code because this
-- column is a payout-relevant control: the geofence is what stops a cleaner being
-- paid for a job they never attended. An unbounded value silently disables it.
--   * 1000 m is the client-agreed ceiling.
--   * 50 m floor: consumer GPS is routinely worse than that even outdoors, so a
--     tighter fence would refuse nearly everyone and push every check-in through
--     the override path, which defeats the point of having the fence at all.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS geofence_radius_meters integer;

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_geofence_radius_meters_range;

ALTER TABLE public.properties
  ADD CONSTRAINT properties_geofence_radius_meters_range
  CHECK (
    geofence_radius_meters IS NULL
    OR (geofence_radius_meters >= 50 AND geofence_radius_meters <= 1000)
  );

COMMENT ON COLUMN public.properties.geofence_radius_meters IS
  'Check-in geofence radius in metres for this property (50-1000). NULL = use the system default (~483 m). Raise it for properties whose lot is large enough that the door is far from the geocoded street address.';
