'use client';

import type { JobDetails } from '@/lib/queries/jobs';
import { ClientTime } from '../ui/ClientTime';
import { SERVICE_TYPE_LABELS, type ServiceType } from '@/lib/constants/service-type';

const STATUS_STYLES = {
  'unassigned': 'bg-gray-100 text-gray-800',
  'assigned': 'bg-indigo-100 text-indigo-800',
  'in-progress': 'bg-blue-100 text-blue-800',
  'completed_pending_evidence': 'bg-yellow-100 text-yellow-800',
  'awaiting_capture': 'bg-purple-100 text-purple-800',
  'completed': 'bg-green-100 text-green-800',
  'canceled': 'bg-red-100 text-red-800',
} as const;

const SERVICE_TYPE_STYLES: Record<ServiceType, string> = {
  vacation_rental_subscription: 'bg-sky-100 text-sky-800',
  residential_one_time: 'bg-violet-100 text-violet-800',
};

/**
 * `check_in_time` and `check_out_time` mean the same two things for both
 * service types — *arrive no earlier than this* and *be finished by this* — but
 * they are named for the vacation-rental case, and reading a residential job
 * through vacation-rental words is how this gets implemented backwards.
 *
 * So every surface that renders them reads `service_type` and picks its
 * wording. This is that switch for the admin job header.
 */
const TIME_LABELS: Record<
  ServiceType,
  { checkIn: string; checkInHint: string; checkOut: string; checkOutHint: string }
> = {
  // Word for word what this header said before M4, so a VR job's labels are
  // unchanged. The disambiguation goes in the hint underneath rather than
  // into the label, which is the only way to satisfy both.
  vacation_rental_subscription: {
    checkIn: 'Cleaner Check in',
    checkInHint: 'Guest check-out',
    checkOut: 'Must finish before',
    checkOutHint: 'Next guest check-in',
  },
  residential_one_time: {
    checkIn: 'Arrival time',
    checkInHint: 'Customer-selected cleaner arrival time',
    checkOut: 'Estimated finish',
    checkOutHint: 'Window end plus the expected hours — not the window end',
  },
};

export function JobSummaryHeader({ job }: { job: JobDetails }) {
  const serviceType: ServiceType =
    (job.serviceType as ServiceType | null) ?? 'vacation_rental_subscription';
  const labels = TIME_LABELS[serviceType];

  // The window's own bounds live in the snapshot as a KEY, not as two
  // timestamps — `check_out_time` is the finish deadline, which is the window
  // end PLUS the job's expected hours, so the window cannot be reconstructed
  // from the two columns. Rendering it from the key is the only truthful
  // version.
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex flex-col md:flex-row justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Job {job.id.substring(0, 8)}
          </h1>
          <p className="text-gray-500 mt-1">{job.property?.address || 'No property'}</p>
          <span
            className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SERVICE_TYPE_STYLES[serviceType]}`}
          >
            {SERVICE_TYPE_LABELS[serviceType]}
          </span>
        </div>
        <div className="mt-4 md:mt-0 text-right">
          <span className="text-xs font-medium text-gray-500">STATUS</span>
          <p className={`mt-1 px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full ${STATUS_STYLES[job.status || 'unassigned']}`}>
            {job.status}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 border-t pt-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {labels.checkIn}
          </p>
          <p className="text-sm font-medium text-gray-900">
            {job.checkInTime ? <ClientTime dateString={job.checkInTime} /> : 'Not set'}
          </p>
          <p className="text-xs text-gray-500">
            {labels.checkInHint}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {labels.checkOut}
          </p>
          <p className="text-sm font-medium text-gray-900">
            {job.checkOutTime ? (
              <ClientTime dateString={job.checkOutTime} />
            ) : (
              'Not set'
            )}
          </p>
          <p className="text-xs text-gray-500">{labels.checkOutHint}</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Actual check-in</p>
          <p className="text-sm font-medium text-gray-900">
            {job.evidencePacket?.gpsCheckInTimestamp ? <ClientTime dateString={job.evidencePacket.gpsCheckInTimestamp} /> : 'Not recorded'}
          </p>
        </div>
        <div className="rounded bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Actual check-out</p>
          <p className="text-sm font-medium text-gray-900">
            {job.evidencePacket?.gpsCheckOutTimestamp ? <ClientTime dateString={job.evidencePacket.gpsCheckOutTimestamp} /> : 'Not recorded'}
          </p>
        </div>
      </div>
    </div>
  );
}
