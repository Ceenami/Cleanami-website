import { TrashIcon } from "lucide-react";
import Link from "next/link";
import { PropertiesWithOwner } from "@/lib/queries/properties";
import { formatContactValue } from "@/components/dashbboard/admin/ui/formatContact";
import { ClientTime } from "@/components/dashbboard/admin/ui/ClientTime";

interface PropertiesTableProps {
  properties: PropertiesWithOwner['data'];
  onDelete: (property: PropertiesWithOwner['data'][number]) => void;
  portalPrefix?: string;
  showDelete?: boolean;
}

const getStatusBadge = (status: string | null | undefined) => {
    // Dummy implementation
    if (status === 'active') return 'bg-green-100 text-green-800';
    return 'bg-gray-100 text-gray-800';
}

export const PropertiesTable = ({
  properties,
  onDelete,
  portalPrefix = "/admin",
  showDelete = true,
}: PropertiesTableProps) => {

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property Address</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Owner</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Owner Email</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Owner Phone</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Next Clean</th>
              <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {properties.map((property) => (
              <tr key={property.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{property.address}</div>
                  <div className="text-sm text-gray-500 font-mono">{property.id.substring(0,8)}...</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {property.customer?.name ?? 'N/A'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {formatContactValue(property.customer?.email)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {formatContactValue(property.customer?.phone)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge('active')}`}>
                    {/* Placeholder for status */}
                    Active
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {property.nextJob?.checkInTime ? (
                    <ClientTime
                      dateString={new Date(property.nextJob.checkInTime)}
                    />
                  ) : (
                    <span className="text-gray-400">None scheduled</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex items-center justify-end space-x-4">
                    <Link href={`${portalPrefix}/properties/${property.id}`} className="text-teal-600 hover:text-teal-900">
                      Details
                    </Link>
                    {showDelete && (
                    <button
                      onClick={() => onDelete(property)}
                      className="text-gray-400 hover:text-red-600"
                      aria-label={`Delete ${property.address}`}
                    >
                      <TrashIcon className="h-5 w-5" />
                    </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {properties.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No properties found.</p>
        </div>
      )}
    </div>
  );
};
