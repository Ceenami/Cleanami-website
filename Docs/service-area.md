## Service Area Polygons Documentation

### Overview

The `serviceAreaPolygons` constant is an exported array that defines the operational boundaries of the service using geographical coordinates. It is designed to be easily consumed by mapping libraries, like Google Maps (indicated by the `google.maps.LatLngLiteral` type), for functions like determining a property's service eligibility or optimizing cleaner routing.

### Data Structure

| Component | Type | Description |
| :--- | :--- | :--- |
| **Constant Name** | `serviceAreaPolygons` | The main exported constant. |
| **Data Type** | `google.maps.LatLngLiteral[][]` | An array of arrays of coordinate objects. |
| **Structure** | `Array<Polygon>` | The top-level array holds one or more distinct service areas (polygons). |
| | `Polygon: Array<Coordinate>` | Each inner array defines a single polygon boundary. |
| | `Coordinate: { lat: number, lng: number }` | Each object within a polygon array represents a vertex defined by latitude (`lat`) and longitude (`lng`). |

### Implementation Details and Usage

#### 1\. Defining a Polygon

  * Each inner array represents a **closed polygon**. While the first and last coordinates are often identical in some geographic data formats to close the loop, in the `google.maps.LatLngLiteral` structure, the polygon will generally be closed automatically by the mapping library.
  * **Coordinate Order:** The coordinates should be listed in a sequential order (e.g., clockwise or counter-clockwise) to correctly define the boundary.

#### 2\. Service Area List

The current array defines the following three distinct service areas:

| Service Area | Description | Defining Vertices (Approx.) |
| :--- | :--- | :--- |
| **Daytona/New Smyrna Area** | A region in Florida covering Daytona, New Smyrna, and Edgewater. | North West, North East, South East, South West. |
| **Vancouver** | A boundary encompassing a specific section of Vancouver, Canada. | North West, North East, South East, South West. |
| **Calgary** | A boundary defining a service area within Calgary, Canada. | North West, North East, South East, South West. |

#### 3\. Generating Coordinates

The coordinates are intended to be generated using an external geographic tool, such as **[http://geojson.io/](http://geojson.io/)**, which allows for visual drawing and export of polygons.

#### 4\. Example Application: Point-in-Polygon Check

This constant is typically used to implement a **Point-in-Polygon (PIP)** check.

```typescript
// Example usage (simplified TypeScript function)
import { serviceAreaPolygons } from './serviceAreaPolygons';

interface Point {
  lat: number;
  lng: number;
}

/**
 * Checks if a given point is within ANY of the defined service areas.
 * Note: A full implementation requires a robust point-in-polygon algorithm.
 */
function isPropertyInServiceArea(point: Point): boolean {
  for (const polygon of serviceAreaPolygons) {
    // A mapping library or a geospatial utility would be used here.
    // E.g., if (google.maps.geometry.poly.containsLocation(point, new google.maps.Polygon({ paths: polygon })))
    
    // For documentation purposes, assume a function exists:
    if (checkIfPointIsInPolygon(point, polygon)) {
      return true;
    }
  }
  return false;
}
```