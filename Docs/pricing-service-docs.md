# PricingService Documentation

## Overview

The `PricingService` class handles dynamic pricing calculations for property cleaning services based on various factors including property size, amenities, and add-on services.

## Class: `PricingService`

### Public Methods

#### `calculatePrice(formData: SignupFormData): Promise<PriceDetails>`

Calculates the total pricing breakdown for a cleaning service based on form data.

**Parameters:**
- `formData: SignupFormData` - Object containing property and service details

**Returns:**
- `Promise<PriceDetails>` - Detailed pricing breakdown including:
  - `basePrice` - Base cleaning cost based on bedrooms/bathrooms
  - `sqftSurcharge` - Additional charge based on square footage
  - `laundryCost` - Total laundry service cost
  - `hotTubCost` - Hot tub maintenance cost
  - `totalPerClean` - Sum of all costs per cleaning
  - `isCustomQuote` - Whether property requires custom pricing
  - `periodicCharges` - Array of recurring charges (e.g., hot tub drains)

**Process:**
1. Fetches pricing rules from database (base prices, sqft surcharges, laundry rules, hot tub rules)
2. Calculates individual cost components
3. Determines if custom quote is needed
4. Returns comprehensive pricing details

---

### Private Methods

#### `_calculateBasePrice(beds: number, baths: number, rules: any[]): number`

Calculates the base cleaning price based on bedroom and bathroom count.

**Parameters:**
- `beds: number` - Number of bedrooms
- `baths: number` - Number of bathrooms
- `rules: any[]` - Array of base pricing rules from database

**Returns:**
- `number` - Base price in dollars (converted from cents)

**Logic:**
- Finds matching rule for bedroom count
- Retrieves price for specific bathroom count using dynamic property access
- Converts from cents to dollars

---

#### `_calculateSqftSurcharge(sqft: number, rules: any[]): number`

Calculates additional charge based on property square footage.

**Parameters:**
- `sqft: number` - Property square footage
- `rules: any[]` - Array of square footage surcharge rules

**Returns:**
- `number` - Surcharge amount in dollars

**Logic:**
- Finds rule where sqft falls within range (rangeStart to rangeEnd)
- Excludes custom quote rules
- Returns surcharge converted from cents to dollars

---

#### `_calculateLaundryCost(formData: SignupFormData, rules: any[]): { total: number }`

Calculates laundry service costs based on service type and load count.

**Parameters:**
- `formData: SignupFormData` - Form data containing laundry preferences
- `rules: any[]` - Array of laundry pricing rules

**Returns:**
- `{ total: number }` - Object with total laundry cost

**Logic:**
- **In-Unit Service**: Cost = loads × per-load rate
- **Off-Site Service**: Cost = base fee + (loads × per-load rate)
- Returns 0 if no laundry service selected

---

#### `_calculateHotTubCost(formData: SignupFormData, rules: any[]): { total: number; periodic: any[] }`

Calculates hot tub maintenance costs including basic service and periodic drains.

**Parameters:**
- `formData: SignupFormData` - Form data containing hot tub service details
- `rules: any[]` - Array of hot tub pricing rules

**Returns:**
- Object containing:
  - `total: number` - Per-cleaning hot tub cost
  - `periodic: any[]` - Array of recurring charges with description, amount, and cadence

**Logic:**
- Returns zero costs if no hot tub present
- Adds basic maintenance cost if service selected
- Adds periodic drain charges with specified cadence
- Converts all prices from cents to dollars

---

## Data Flow

```
User Form Data
      ↓
calculatePrice()
      ↓
Fetch Pricing Rules (parallel)
      ↓
Calculate Components:
  - Base Price
  - Sqft Surcharge
  - Laundry Cost
  - Hot Tub Cost
      ↓
Aggregate Results
      ↓
Return PriceDetails
```

## Usage Example

```typescript
import { PricingService } from './pricing-service';

const pricingService = new PricingService();

const formData = {
  bedrooms: 3,
  bathrooms: 2,
  sqft: 1800,
  laundryService: 'in_unit',
  laundryLoads: 2,
  hasHotTub: true,
  hotTubService: true,
  hotTubDrain: true,
  hotTubDrainCadence: 'monthly'
};

const pricing = await pricingService.calculatePrice(formData);

console.log(pricing);
// {
//   basePrice: 150.00,
//   sqftSurcharge: 25.00,
//   laundryCost: 40.00,
//   hotTubCost: 30.00,
//   totalPerClean: 245.00,
//   isCustomQuote: false,
//   periodicCharges: [...]
// }
```

## Dependencies

- `@/db` - Database connection
- `@/lib/validations/bookng-modal` - Type definitions for `PriceDetails` and `SignupFormData`

## Database Tables Used

- `basePricingRules` - Base pricing by bedroom/bathroom count
- `sqftSurchargeRules` - Square footage-based surcharges
- `laundryPricingRules` - Laundry service pricing
- `hotTubPricingRules` - Hot tub maintenance pricing

## Notes

- All prices stored in database as cents, converted to dollars in calculations
- Custom quote flag triggered when property size exceeds threshold
- Laundry and hot tub costs are optional based on user selections
- Parallel database queries optimize performance