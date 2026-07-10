/**
 * Defines the geographic boundaries of your service areas.
 * Each item in the array is a separate polygon representing a distinct service area.
 * These coordinates can be generated using a tool like http://geojson.io/.
 */
export const serviceAreaPolygons: google.maps.LatLngLiteral[][] = [
  [
    { lat: 29.356, lng: -81.165 }, // North West (Daytona)
    { lat: 29.356, lng: -80.980 }, // North East
    { lat: 28.890, lng: -80.820 }, // South East (New Smyrna/Edgewater)
    { lat: 28.890, lng: -81.050 }, // South West
  ],

  // Vancouver
  [
    { lat: 49.31, lng: -123.23 },
    { lat: 49.31, lng: -123.02 },
    { lat: 49.20, lng: -123.02 },
    { lat: 49.20, lng: -123.23 },
  ],

  // Calgary
  [
    { lat: 51.18, lng: -114.26 },
    { lat: 51.18, lng: -113.94 },
    { lat: 50.90, lng: -113.94 },
    { lat: 50.90, lng: -114.26 },
  ],
];

