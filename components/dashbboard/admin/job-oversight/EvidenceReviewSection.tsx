'use client';

import type { JobDetails } from '@/lib/queries/jobs';

type ChecklistItem = {
  id: string;
  task: string;
  completed: boolean;
};

type ChecklistLog = {
  items: ChecklistItem[];
};

/**
 * The checklist half of an evidence packet. Photos are rendered separately by
 * `EvidencePhotoGallery`.
 *
 * This section used to try to hang a thumbnail off each checklist item via a
 * `photoIndex` field. Nothing has ever written that field — photos are stored
 * per room, not per checklist item — so every row rendered "No Photo" and the
 * packet's photos were unreachable in the UI entirely. The two are genuinely
 * separate axes of evidence and are now presented as such.
 */
export function EvidenceReviewSection({
  evidencePacket,
}: {
  evidencePacket: JobDetails['evidencePacket'];
}) {
  const checklistLog = evidencePacket?.checklistLog as ChecklistLog | null;
  const items = checklistLog?.items || [];

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-center mb-4 border-b pb-3">
        <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
        <h3 className="ml-3 text-lg font-semibold text-gray-800">Checklist</h3>
      </div>

      {items.length > 0 ? (
        <div className="divide-y divide-gray-200">
          {items.map((item) => (
            <div key={item.id} className="p-4 flex items-center hover:bg-gray-50">
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