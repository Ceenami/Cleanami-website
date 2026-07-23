import { getPropertyDetails } from "@/lib/queries/properties";
import { PropertyDetailesRightColumn } from "@/components/dashbboard/admin/properties/PropertyDetailsRightColumn";
import { CHECKLISTS_BUCKET, createSignedUrls } from "@/lib/storage/signed-url";
import { PropertyEditForm } from "@/components/dashbboard/admin/properties/PropertyEditForm";
import { PropertyCleanerRoster } from "@/components/dashbboard/admin/properties/PropertyCleanerRoster";
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

  // Sign the private-bucket checklist paths for the admin download links.
  const checklistSignedUrls = await createSignedUrls(
    CHECKLISTS_BUCKET,
    propertyDetails.checklistFiles.map((f) => f.storagePath)
  );
  const checklistFiles = propertyDetails.checklistFiles.map((f, i) => ({
    id: f.id,
    fileName: f.fileName,
    url: checklistSignedUrls[i] ?? "",
    createdAt: f.createdAt,
  }));

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
        
        <div className="space-y-6">
          <PropertyEditForm property={propertyDetails} />
          <PropertyCleanerRoster propertyId={propertyDetails.id} />
          <PropertyDetailesRightColumn
            propertyId={propertyDetails.id}
            checklistFiles={checklistFiles}
          />
        </div>
      </div>
    </div>
  );
};