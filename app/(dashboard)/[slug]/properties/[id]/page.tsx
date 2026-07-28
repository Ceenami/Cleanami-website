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
  // Link-based checklist rows (a pasted Google Sheet URL) have no storage
  // path to sign — only uploaded files go through createSignedUrls.
  const uploadedChecklistFiles = propertyDetails.checklistFiles.filter(
    (f) => f.storagePath
  );
  const checklistSignedUrls = await createSignedUrls(
    CHECKLISTS_BUCKET,
    uploadedChecklistFiles.map((f) => f.storagePath!)
  );
  let signedUrlIndex = 0;
  const checklistFiles = propertyDetails.checklistFiles.map((f) => {
    if (f.storagePath) {
      const url = checklistSignedUrls[signedUrlIndex] ?? "";
      signedUrlIndex += 1;
      return { id: f.id, fileName: f.fileName, url, isLink: false, createdAt: f.createdAt };
    }
    return {
      id: f.id,
      fileName: f.fileName,
      url: f.sourceUrl ?? "",
      isLink: true,
      createdAt: f.createdAt,
    };
  });

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