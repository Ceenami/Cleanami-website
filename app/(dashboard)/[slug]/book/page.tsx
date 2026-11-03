import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { properties } from "@/db/schemas";
import { getCustomerAuth } from "@/lib/customer-auth";
import { PricingService } from "@/lib/services/pricing.service";
import { OneOffCleanBooking } from "@/components/customer/OneOffCleanBooking";
import { toPublicResidentialQuote } from "@/lib/pricing/residential";
import { evaluateResidentialSale } from "@/lib/pricing/residential-sales";

export default async function BookOneOffPage() {
  const { customerId, error } = await getCustomerAuth();
  if (!customerId) {
    redirect(
      `/?portalBlocked=1&message=${encodeURIComponent(error ?? "Portal unavailable")}`,
    );
  }

  const props = await db.query.properties.findMany({
    where: eq(properties.customerId, customerId),
  });

  const pricing = new PricingService();
  // Priced one property at a time. The first call populates the shared rules
  // cache, so the rest are pure computation — and concurrent DB reads here
  // would risk the pooler-pipelining hang described in db/index.ts.
  const items = [];
  for (const p of props) {
    if (p.serviceType === "residential_one_time") {
      const residentialOptions =
        p.priceOverrideCents != null
          ? []
          : (["standard", "deep"] as const).flatMap((cleaningLevel) => {
              const result = evaluateResidentialSale({
                bedrooms: p.bedCount,
                bathrooms: Number(p.bathCount),
                sqft: p.sqFt,
                petsAllowed: p.petsAllowed,
                cleaningLevel,
                hotTub: "none",
                inUnitLaundryLoads: 0,
              });
              return result.ok ? [toPublicResidentialQuote(result.terms)] : [];
            });
      items.push({
        id: p.id,
        address: p.address,
        price: null,
        serviceType: p.serviceType,
        residentialOptions,
      });
      continue;
    }
    const pd = await pricing.calculatePrice({
      bedrooms: p.bedCount,
      bathrooms: Number(p.bathCount),
      sqft: p.sqFt ?? 0,
      laundryService: p.laundryType,
      laundryLoads: p.laundryLoads,
      hasHotTub: p.hasHotTub,
      hotTubService: p.hotTubServiceLevel,
      hotTubDrain: p.hotTubDrain,
      hotTubDrainCadence: p.hotTubDrainCadence,
      // must match what `priceOneOffCents` will actually charge, or
      // the customer is quoted one number and billed another.
      petsAllowed: p.petsAllowed,
      subscriptionMonths: 1,
      priceOverrideCents: p.priceOverrideCents,
    } as any);
    // A home is offered arrival windows, and which ones fit the operating day
    // depends on how long the clean takes. Same inputs the public residential
    // flow uses, so the window list the customer sees here matches the one
    // they would have seen there.
    items.push({
      id: p.id,
      address: p.address,
      price:
        pd.pricingUnavailable || pd.isCustomQuote ? null : pd.totalPerClean,
      serviceType: p.serviceType,
      residentialOptions: [],
    });
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-gray-900">Book a one-off clean</h1>
      <p className="mt-2 text-sm text-gray-600">
        A single, non-recurring clean for one of your properties. Charged up
        front to your card on file. No subscription commitment.
      </p>
      <div className="mt-6">
        <OneOffCleanBooking properties={items} />
      </div>
    </div>
  );
}
