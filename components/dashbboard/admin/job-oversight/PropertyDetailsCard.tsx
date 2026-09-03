'use client';

import type { JobDetails } from '@/lib/queries/jobs';
import { AccessDetailsPanel } from '../AccessDetailsPanel';

export function PropertyDetailsCard({
  property,
  /**
   * Counterproposal items 6 and 12 put entry, access and parking on the admin
   * job view. They are admin-and-assigned-cleaner only, and this card is
   * rendered by `JobDetailsClient`, which serves the **customer portal** off the
   * same component — so the panel is gated here, at the call site, and
   * defaults to hidden. A customer seeing their own door code would be
   * harmless; the gate exists because the next person to reuse this card will
   * not re-derive that, and defaulting to shown is how a credential ends up on
   * a page nobody audited.
   */
  showAccessDetails = false,
}: {
  property: JobDetails['property'];
  showAccessDetails?: boolean;
}) {
  if (!property) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-md">
        <p className="text-sm text-gray-500">No property information</p>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center mb-4 border-b pb-3">
        <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
        <h3 className="ml-3 text-lg font-semibold text-gray-800">Property Details</h3>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Address:</span>
          <span className="font-medium text-gray-900">{property.address}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Beds / Baths:</span>
          <span className="font-medium text-gray-900">
            {property.bedCount} / {property.bathCount}
          </span>
        </div>
        {property.sqFt && (
          <div className="flex justify-between">
            <span className="text-gray-600">Size:</span>
            <span className="font-medium text-gray-900">{property.sqFt} sqft</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-600">Hot Tub:</span>
          <span className="font-medium text-gray-900">{property.hasHotTub ? 'Yes' : 'No'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Laundry:</span>
          <span className="font-medium text-gray-900 capitalize">
            {property.laundryType.replace('_', ' ')}
          </span>
        </div>
      </div>

      {showAccessDetails && (
        <div className="mt-4 pt-4 border-t">
          <p className="mb-2 text-xs font-medium text-gray-500">
            Access &amp; entry
          </p>
          <AccessDetailsPanel
            entryMethod={property.entryMethod}
            entryInstructions={property.entryInstructions}
            parkingInstructions={property.parkingInstructions}
            petsAllowed={property.petsAllowed}
          />
        </div>
      )}

      {property.customer && (
        <div className="mt-4 pt-4 border-t">
          <p className="text-xs font-medium text-gray-500 mb-2">Customer</p>
          <p className="text-sm font-medium text-gray-900">{property.customer.name}</p>
          <p className="text-sm text-gray-600">{property.customer.email}</p>
          {property.customer.phone && (
            <p className="text-sm text-gray-600">{property.customer.phone}</p>
          )}
        </div>
      )}
    </div>
  );
}