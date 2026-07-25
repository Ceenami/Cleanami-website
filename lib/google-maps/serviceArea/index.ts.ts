/**
 * Defines the geographic boundaries of your service areas.
 * Each item in the array is a separate polygon representing a distinct service area.
 * These coordinates can be generated using a tool like http://geojson.io/.
 */
export const serviceAreaPolygons: google.maps.LatLngLiteral[][] = [
  // Daytona / New Smyrna / Edgewater (FL) — the only live service zone.
  [
    { lat: 29.356, lng: -81.165 }, // North West (Daytona)
    { lat: 29.356, lng: -80.980 }, // North East
    { lat: 28.890, lng: -80.820 }, // South East (New Smyrna/Edgewater)
    { lat: 28.890, lng: -81.050 }, // South West
  ],
];

/**
 * Pure (no Google JS SDK) ray-casting point-in-polygon test. Safe to run on the
 * server so the client-supplied `isAddressInServiceArea` boolean can be
 * re-validated against the geocoded coordinates before taking payment.
 */
function pointInPolygon(
  lat: number,
  lng: number,
  polygon: google.maps.LatLngLiteral[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isPointInServiceArea(lat: number, lng: number): boolean {
  return serviceAreaPolygons.some((polygon) =>
    pointInPolygon(lat, lng, polygon)
  );
}

