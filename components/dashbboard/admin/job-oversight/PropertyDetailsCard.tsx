'use client';

import type { JobDetails } from '@/lib/queries/jobs';

export function PropertyDetailsCard({ property }: { property: JobDetails['property'] }) {
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