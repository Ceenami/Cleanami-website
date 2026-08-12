import { redirect } from "next/navigation";
import { getPropertyDetails } from "@/lib/queries/properties";
import { PropertyDetailesRightColumn } from "@/components/dashbboard/admin/properties/PropertyDetailsRightColumn";
import { CHECKLISTS_BUCKET, createSignedUrls } from "@/lib/storage/signed-url";
import { PropertyEditForm } from "@/components/dashbboard/admin/properties/PropertyEditForm";
import { PropertyCleanerRoster } from "@/components/dashbboard/admin/properties/PropertyCleanerRoster";
import { RequestPropertyChangeCard } from "@/components/dashbboard/admin/properties/RequestPropertyChangeCard";
import PropertyDetailsLeftColumn from "@/components/dashbboard/admin/properties/PropertyDetailsLeftColumn";
import { PropertyHeader } from "@/components/dashbboard/admin/properties/PropertyHeader";
import { getSessionRole } from "@/lib/auth/server-roles";
import { getCustomerAuth } from "@/lib/customer-auth";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;

  // This page is shared between /admin/properties/[id] and
  // /customer/properties/[id], and it fetches the FULL property — including the
  // joined customer row — on the server. Without the checks below a customer
  // could open /customer/properties/<any id> and receive another customer's
  // name, email and phone in the SSR payload, and would also be shown the admin
  // price-override, check-in-radius and cleaner-hierarchy controls.
  //
  // Same shape as job-oversight/[id]: the role comes from `users.role`, never
  // from the URL prefix, so a customer who types the admin slug is still scoped
  // as a customer.
  const userRole = await getSessionRole();
  const isAdminRole = userRole === "admin" || userRole === "super_admin";
  const isCustomerRole = userRole === "user";

  if (!isAdminRole && !isCustomerRole) {
    redirect("/sign-in");
  }

  // null = deliberate unscoped read (admin). A customer is always scoped to
  // their own id, so a property they do not own resolves to notFound().
  let scopeCustomerId: string | null = null;
  if (!isAdminRole) {
    const { customerId, error } = await getCustomerAuth();
    if (!customerId) {
      redirect(
        `/?portalBlocked=1&message=${encodeURIComponent(
          error ?? "Portal unavailable"
        )}`
      );
    }
    scopeCustomerId = customerId;
  }

  // Admin controls need BOTH the role and the admin portal: role alone would
  // show them to an admin previewing /customer/*, and slug alone would hand
  // them to any customer who typed /admin/*. Mirrors the owner-portal rule in
  // PropertiesPageClient.
  const showAdminControls = isAdminRole && slug === "admin";

  const propertyDetails = await getPropertyDetails(id, {
    customerId: scopeCustomerId,
  });

  // Checklist files are an admin concern, and signing their URLs for a customer
  // would put private-bucket links in a payload that has no business carrying
  // them — so the signing round trip is skipped entirely, not just hidden.
  let checklistFiles: {
    id: string;
    fileName: string;
    url: string;
    isLink: boolean;
    createdAt: Date;
  }[] = [];

  if (showAdminControls) {
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
    checklistFiles = propertyDetails.checklistFiles.map((f) => {
      if (f.storagePath) {
        const url = checklistSignedUrls[signedUrlIndex] ?? "";
        signedUrlIndex += 1;
        return {
          id: f.id,
          fileName: f.fileName,
          url,
          isLink: false,
          createdAt: f.createdAt,
        };
      }
      return {
        id: f.id,
        fileName: f.fileName,
        url: f.sourceUrl ?? "",
        isLink: true,
        createdAt: f.createdAt,
      };
    });
  }

  return (
    <div className="space-y-6">
      <PropertyHeader
        property={propertyDetails}
        customer={propertyDetails.customer}
        listHref={`/${slug}/properties`}
        showOwner={showAdminControls}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PropertyDetailsLeftColumn
          property={propertyDetails}
          subscription={propertyDetails.activeSubscription}
          isAdmin={showAdminControls}
        />

        <div className="space-y-6">
          {showAdminControls ? (
            <>
              <PropertyEditForm property={propertyDetails} />
              <PropertyCleanerRoster propertyId={propertyDetails.id} />
              <PropertyDetailesRightColumn
                propertyId={propertyDetails.id}
                checklistFiles={checklistFiles}
              />
            </>
          ) : (
            <RequestPropertyChangeCard address={propertyDetails.address} />
          )}
        </div>
      </div>
    </div>
  );
}
