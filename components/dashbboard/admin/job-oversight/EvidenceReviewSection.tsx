'use client';

import type { JobDetails } from '@/lib/queries/jobs';

type ChecklistItem = {
  id: string;
  task: string;
  completed: boolean;
  photoIndex?: number;
};

type ChecklistLog = {
  items: ChecklistItem[];
};

export function EvidenceReviewSection({
  evidencePacket,
  onReviewPhoto,
}: {
  evidencePacket: JobDetails['evidencePacket'];
  onReviewPhoto: (index: number) => void;
}) {
  const checklistLog = evidencePacket?.checklistLog as ChecklistLog | null;
  const items = checklistLog?.items || [];

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center mb-4 border-b pb-3">
        <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
        <h3 className="ml-3 text-lg font-semibold text-gray-800">Evidence Review</h3>
      </div>

      {items.length > 0 ? (
        <div className="divide-y divide-gray-200">
          {items.map((item) => (
            <div key={item.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={item.completed}
                  disabled
                  className="h-5 w-5 rounded border-gray-300 text-teal-600"
                />
                <span className={`ml-4 text-sm ${item.completed ? 'line-through text-gray-500' : 'text-gray-800'}`}>
                  {item.task}
                </span>
              </div>
              {typeof item.photoIndex === 'number' && evidencePacket?.photoUrls?.[item.photoIndex] ? (
                <button
                  onClick={() => onReviewPhoto(item.photoIndex!)}
                  className="flex items-center text-sm font-medium text-teal-600 hover:text-teal-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- dynamic evidence URLs */}
                  <img
                    src={evidencePacket.photoUrls[item.photoIndex]}
                    alt="Evidence thumbnail"
                    className="h-10 w-10 rounded-md object-cover mr-3"
                  />
                  Review
                </button>
              ) : (
                <div className="flex items-center text-sm text-gray-400">
                  <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  No Photo
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="p-4 text-sm text-gray-500">No checklist items for this job.</p>
      )}

      {/* Overall status */}
      {evidencePacket && (
        <div className="mt-4 pt-4 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">Checklist Complete:</span>
            <span className={evidencePacket.isChecklistComplete ? 'text-green-600' : 'text-yellow-600'}>
              {evidencePacket.isChecklistComplete ? '✓ Yes' : '⚠ No'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm mt-2">
            <span className="font-medium text-gray-700">Status:</span>
            <span>{evidencePacket.status}</span>
          </div>
        </div>
      )}
    </div>
  );
}