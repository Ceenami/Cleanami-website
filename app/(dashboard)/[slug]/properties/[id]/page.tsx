import { getPropertyDetails } from "@/lib/queries/properties";
import { PropertyDetailesRightColumn } from "@/components/dashbboard/admin/properties/PropertyDetailsRightColumn";
import PropertyDetailsLeftColumn from "@/components/dashbboard/admin/properties/PropertyDetailsLeftColumn";
import { PropertyHeader } from "@/components/dashbboard/admin/properties/PropertyHeader";

// The page now receives the dynamic route parameter, e.g., 'id'
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const propertyDetails = await getPropertyDetails(id);
 
  return (
    <div className="space-y-6">
      <PropertyHeader 
        property={propertyDetails} 
        customer={propertyDetails.customer}
        listHref={`/${slug}/properties`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PropertyDetailsLeftColumn 
          property={propertyDetails} 
          subscription={propertyDetails.activeSubscription} 
        />
        
         {/* checklistFiles={propertyDetails.checklistFiles}  */}
        <PropertyDetailesRightColumn />
      </div>
    </div>
  );
};