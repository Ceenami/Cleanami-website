import { PropertyDetails } from "@/lib/queries/properties";
import { formatContactValue } from "@/components/dashbboard/admin/ui/formatContact";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

interface PropertyHeaderProps {
  property: PropertyDetails;
  customer: PropertyDetails['customer'];
  listHref?: string;
  /**
   * Owner name/email/phone. Off in the customer portal: it is the viewer's own
   * contact detail, so it adds nothing, and rendering an owner block on a page
   * a customer can reach is the habit that leaked other customers' details in
   * the first place.
   */
  showOwner?: boolean;
}

export const PropertyHeader = ({
  property,
  customer,
  listHref = "/admin/properties",
  showOwner = true,
}: PropertyHeaderProps) => {
  return (
    <div>
      <Link
        href={listHref}
        className="flex items-center text-sm font-semibold text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeftIcon className="mr-2 h-5 w-5" />
        Back to Properties List
      </Link>
      <div className="min-w-0 rounded-lg bg-white p-4 shadow-md sm:p-6">
        <h1 className="text-2xl font-bold text-gray-900 [overflow-wrap:anywhere] sm:text-3xl">{property.address}</h1>
        {showOwner && (
          <>
            <p className="mt-1 text-gray-500 [overflow-wrap:anywhere]">
              Owned by: {customer?.name ?? 'N/A'}
            </p>
            <div className="mt-3 flex flex-col gap-1 text-sm text-gray-600 sm:flex-row sm:flex-wrap sm:gap-x-6">
              <p className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium text-gray-700">Email:</span>{" "}
                {formatContactValue(customer?.email)}
              </p>
              <p className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium text-gray-700">Phone:</span>{" "}
                {formatContactValue(customer?.phone)}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
