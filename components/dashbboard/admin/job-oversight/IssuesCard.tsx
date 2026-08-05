'use client';

import type { JobDetails } from '@/lib/queries/jobs';

export function IssuesCard({ evidencePacket }: { evidencePacket: JobDetails['evidencePacket'] }) {
  const hasPendingReview = evidencePacket?.status === 'pending_review';
  const isIncomplete = evidencePacket?.status === 'incomplete';

  // Location accountability. These columns have always been written and never
  // shown, which made flagging an out-of-range check-in pointless — the alert
  // fired and then led to a page that did not mention location at all.
  const overrideReason = evidencePacket?.checkInOverrideReason ?? null;
  const checkInDistance = evidencePacket?.checkInDistanceMiles ?? null;
  const outOfRange = evidencePacket?.checkInWithinGeofence === false;
  // Distinguish "we checked and could not tell" from "never checked": a
  // recorded check-in with no distance means the fix or the property
  // coordinates were missing.
  const locationUnverified =
    !!evidencePacket?.gpsCheckInTimestamp &&
    evidencePacket?.checkInWithinGeofence == null;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center mb-4 border-b pb-3">
        <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="ml-3 text-lg font-semibold text-gray-800">Issues</h3>
      </div>

      <div className="space-y-3">
        {overrideReason && (
          <div className="p-3 rounded-md bg-orange-50 border border-orange-300">
            <p className="text-sm font-semibold text-orange-900">
              Geofence overridden at check-in
            </p>
            {checkInDistance != null && (
              <p className="text-xs text-orange-800 mt-1">
                Device was {checkInDistance} mi from the property.
              </p>
            )}
            <p className="text-sm text-orange-800 mt-1 italic">
              &ldquo;{overrideReason}&rdquo;
            </p>
          </div>
        )}

        {!overrideReason && outOfRange && (
          <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200">
            <p className="text-sm text-yellow-800">
              Checked in
              {checkInDistance != null ? ` ${checkInDistance} mi` : ''} outside
              the geofence
            </p>
          </div>
        )}

        {!overrideReason && locationUnverified && (
          <div className="p-3 rounded-md bg-gray-50 border border-gray-200">
            <p className="text-sm text-gray-700">
              Check-in location could not be verified (no usable GPS fix, or the
              property has no coordinates on file)
            </p>
          </div>
        )}

        {hasPendingReview && (
          <div className="p-3 rounded-md bg-yellow-50 border border-yellow-200">
            <p className="text-sm text-yellow-800">Evidence pending admin review</p>
          </div>
        )}

        {isIncomplete && (
          <div className="p-3 rounded-md bg-red-50 border border-red-200">
            <p className="text-sm text-red-800">Evidence packet incomplete</p>
          </div>
        )}

        {!hasPendingReview &&
          !isIncomplete &&
          !overrideReason &&
          !outOfRange &&
          !locationUnverified &&
          evidencePacket?.status === 'complete' && (
            <p className="text-sm text-green-600">✓ No issues</p>
          )}

        {!evidencePacket && (
          <p className="text-sm text-gray-500">No evidence packet yet</p>
        )}

        {/* TODO: Add admin notes display when field is added */}
      </div>
    </div>
  );
}