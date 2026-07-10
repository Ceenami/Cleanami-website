'use client';

import type { JobDetails } from '@/lib/queries/jobs';
import { ClientTime } from '../ui/ClientTime';

const STATUS_STYLES = {
  'unassigned': 'bg-gray-100 text-gray-800',
  'assigned': 'bg-indigo-100 text-indigo-800',
  'in-progress': 'bg-blue-100 text-blue-800',
  'completed_pending_evidence': 'bg-yellow-100 text-yellow-800',
  'awaiting_capture': 'bg-purple-100 text-purple-800',
  'completed': 'bg-green-100 text-green-800',
  'canceled': 'bg-red-100 text-red-800',
} as const;

export function JobSummaryHeader({ job }: { job: JobDetails }) {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex flex-col md:flex-row justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Job {job.id.substring(0, 8)}
          </h1>
          <p className="text-gray-500 mt-1">{job.property?.address || 'No property'}</p>
          {/* {job.isUrgentBonus && (
            <span className="mt-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
              🔥 Urgent Bonus
            </span>
          )} */}
        </div>
        <div className="mt-4 md:mt-0 text-right">
          <span className="text-xs font-medium text-gray-500">STATUS</span>
          <p className={`mt-1 px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full ${STATUS_STYLES[job.status || 'unassigned']}`}>
            {job.status}
          </p>
          
        </div>
        
      </div>
       <p className={`mt-1 px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full`}>
        <span className="text-md pr-2 font-medium text-gray-500">Cleaner Check in:</span>
            <ClientTime dateString={job.checkInTime!} />
          </p>

      
    </div>
  );
}