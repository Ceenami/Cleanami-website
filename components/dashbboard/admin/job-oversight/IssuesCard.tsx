'use client';

import type { JobDetails } from '@/lib/queries/jobs';

export function IssuesCard({ evidencePacket }: { evidencePacket: JobDetails['evidencePacket'] }) {
  const hasPendingReview = evidencePacket?.status === 'pending_review';
  const isIncomplete = evidencePacket?.status === 'incomplete';

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center mb-4 border-b pb-3">
        <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h3 className="ml-3 text-lg font-semibold text-gray-800">Issues</h3>
      </div>

      <div className="space-y-3">
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

        {!hasPendingReview && !isIncomplete && evidencePacket?.status === 'complete' && (
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