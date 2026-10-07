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
    <>
      <div className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white md:hidden">
        {properties.map((property) => (
          <details key={property.id} className="group p-4">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{property.address}</p>
                <p className="mt-1 text-sm text-gray-500">{property.customer?.name ?? "N/A"}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${getStatusBadge("active")}`}>Active</span>
            </summary>
            <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4 text-sm">
              <p><span className="text-gray-500">Email: </span>{formatContactValue(property.customer?.email)}</p>
              <p><span className="text-gray-500">Phone: </span>{formatContactValue(property.customer?.phone)}</p>
              <p><span className="text-gray-500">Next clean: </span>{property.nextJob?.checkInTime ? <ClientTime dateString={new Date(property.nextJob.checkInTime)} /> : "None scheduled"}</p>
              <p className="font-mono text-xs text-gray-500">{property.id}</p>
              <div className="flex items-center justify-between pt-1">
                <Link href={`${portalPrefix}/properties/${property.id}`} className="font-medium text-teal-700 hover:text-teal-900">Details</Link>
                {showDelete && <button onClick={() => onDelete(property)} className="text-sm font-medium text-red-600 hover:text-red-700">Delete</button>}
              </div>
            </div>
          </details>
        ))}
        {properties.length === 0 && <div className="p-10 text-center text-sm text-gray-500">No properties found.</div>}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white md:block">
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
    </>
  );
};
