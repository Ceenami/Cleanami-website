import "server-only";

import { geocodeAddressResult } from "@/lib/services/google-maps/geocoding";
// The module on disk is `serviceArea/index.ts.ts` (doubled extension); imports
// resolve through `.../serviceArea/index.ts`. Odd, but renaming it is unrelated
// churn on a path several client components also import.
import { isPointInServiceArea } from "@/lib/google-maps/serviceArea/index.ts";
import type { Coordinates } from "@/lib/services/google-maps/geocoding";

/**
 * Server-side service-area gate for property writes.
 *
 * This is the same three-state contract `create-payment-intent.service.ts`
 * already applies at booking time, lifted so property create/update cannot
 * bypass it — which is how a Switzerland address ended up saved against a
 * Florida-only business.
 *
 *   ok + inside polygon  → proceed, and hand back coordinates to persist
 *   ok + outside polygon → reject (an address we will not serve)
 *   not_found            → reject (an address that does not exist)
 *   unavailable          → ALLOW, logged at error level
 *
 * The last row is deliberate and asymmetric: a bad address is the customer's
 * problem, but a geocoder we cannot reach is ours, and failing closed there
 * would block every property write during a Google outage or a missing key.
 * That leaves a narrow, known hole — an out-of-area save can land while
 * geocoding is down — which is why the log is an error, not a warning.
 */

export class OutOfServiceAreaError extends Error {
  readonly code = "OUT_OF_SERVICE_AREA";
  constructor(message: string) {
    super(message);
    this.name = "OutOfServiceAreaError";
  }
}

export class AddressNotFoundError extends Error {
  readonly code = "ADDRESS_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "AddressNotFoundError";
  }
}

/** Spec §29.2 — the only live service zone. Named in the rejection copy so the customer knows why. */
export const SERVICE_AREA_DESCRIPTION =
  "Volusia County, Florida (New Smyrna Beach, Daytona Beach and Edgewater)";

export const OUT_OF_SERVICE_AREA_MESSAGE = `That address is outside our current service area — we serve ${SERVICE_AREA_DESCRIPTION}. Please contact CleanNami if you believe this is an error.`;

export const ADDRESS_NOT_FOUND_MESSAGE =
  "We could not verify that address. Please check it and try again, or contact CleanNami and we will help.";

export type ServiceAreaCheck = {
  /** Coordinates when the geocode succeeded; null when it was unavailable. */
  coordinates: Coordinates | null;
  /** True when the save proceeded without a usable geocode. */
  skipped: boolean;
};

/**
 * Throws unless the address is inside the service area.
 *
 * @param allowOutOfArea an explicit, admin-only override. Callers default to
 *   `false`, so a new code path is gated unless it opts out in writing.
 */
export async function assertAddressInServiceArea(
  address: string,
  options?: { allowOutOfArea?: boolean; context?: string }
): Promise<ServiceAreaCheck> {
  const allowOutOfArea = options?.allowOutOfArea === true;
  const context = options?.context ?? "properties";

  const geocode = await geocodeAddressResult(address);

  if (geocode.status === "ok") {
    const inside = isPointInServiceArea(
      geocode.coordinates.latitude,
      geocode.coordinates.longitude
    );

    if (!inside && !allowOutOfArea) {
      throw new OutOfServiceAreaError(OUT_OF_SERVICE_AREA_MESSAGE);
    }

    if (!inside) {
      console.warn(
        `[${context}] out-of-service-area address saved via explicit admin override: ${address}`
      );
    }

    return { coordinates: geocode.coordinates, skipped: false };
  }

  if (geocode.status === "not_found") {
    if (!allowOutOfArea) {
      throw new AddressNotFoundError(ADDRESS_NOT_FOUND_MESSAGE);
    }
    return { coordinates: null, skipped: true };
  }

  // `unavailable` — our infrastructure, not their address. Allow and shout.
  console.error(
    `[${context}] service-area check skipped, geocoding unavailable (${geocode.reason}). Save allowed WITHOUT service-area validation: ${address}`
  );
  return { coordinates: null, skipped: true };
}

/** Narrow helper so routes can map either rejection onto a `code` without instanceof chains. */
export function serviceAreaErrorCode(error: unknown): string | null {
  if (error instanceof OutOfServiceAreaError) return error.code;
  if (error instanceof AddressNotFoundError) return error.code;
  return null;
}
