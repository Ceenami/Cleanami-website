/**
 * The Phase 2A rollback lever.
 *
 * "Hiding the service-type question in the booking wizard restores exactly
 * today's product, because every discriminator defaults to
 * `vacation_rental_subscription`. Build it so that is a one-line change — a
 * single feature flag read that the booking entry point honours. That flag is
 * the only rollback that does not need a deploy of new code."
 *
 * It is an env var rather than `platform_config` for one reason: the booking
 * modal is a client component, and `platform_config` is reachable only through
 * `import "server-only"` code. Reading it would mean a round trip on modal open
 * and a loading state in front of the first question — a worse product, in
 * exchange for a lever nobody pulls twice.
 *
 * `process.env.NEXT_PUBLIC_*` is inlined by the Next.js compiler only where the
 * property is written out literally, so the literal lives here and nowhere else.
 *
 * Default is **on**: the flag exists to turn the new question off, not to gate
 * shipping it. Set `NEXT_PUBLIC_SERVICE_TYPE_CHOICE=false` to restore today's
 * product exactly — the modal then opens on the vacation-rental wizard's step 1
 * with no service-type question at all.
 */

/**
 * A flag value that has been through an env var is always a STRING, and
 * `Boolean("false")` is `true`, which once cost this project a $10 pet
 * fee on properties with no pets. Read the string; never coerce it.
 */
function isDisabled(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "false" || v === "0" || v === "off" || v === "no";
}

export function isServiceTypeChoiceEnabled(): boolean {
  return !isDisabled(process.env.NEXT_PUBLIC_SERVICE_TYPE_CHOICE);
}
