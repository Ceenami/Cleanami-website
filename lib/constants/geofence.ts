/**
 * Geofence bounds, in a module with no server-only imports so the admin form
 * can share them with the API route and the GPS service.
 * `lib/services/gps/geofence.ts` is `server-only` and cannot be reached from a
 * client component; duplicating these numbers in the form is how they drift.
 *
 * Mirrors the CHECK constraint in migration 0033.
 */

/**
 * A fence tighter than this would sit inside typical consumer GPS error, so it
 * would refuse honest check-ins and push them all through the override path —
 * which is the same as having no fence, only with more admin noise.
 */
export const MIN_GEOFENCE_RADIUS_METERS = 50;

/**
 * Client-agreed ceiling. At 1000 m the fence already covers ~3.1 km²; beyond
 * that it stops being evidence that the cleaner attended the property at all.
 */
export const MAX_GEOFENCE_RADIUS_METERS = 1000;
