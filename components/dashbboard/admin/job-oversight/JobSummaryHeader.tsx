'use client';

import type { JobDetails } from '@/lib/queries/jobs';
import { ClientTime } from '../ui/ClientTime';
import {
  getArrivalWindow,
  type ArrivalWindowKey,
} from '@/lib/scheduling/arrival-windows';
import {
  getJobDisplay,
  type JobDisplay,
  type ServiceType,
} from '@/lib/constants/service-type';
import { getPaymentDisplay, type PaymentDisplay } from '@/lib/constants/payment-status';

const STATUS_STYLES = {
  'unassigned': 'bg-gray-100 text-gray-800',
  'assigned': 'bg-indigo-100 text-indigo-800',
  'in-progress': 'bg-blue-100 text-blue-800',
  'completed_pending_evidence': 'bg-yellow-100 text-yellow-800',
  'awaiting_capture': 'bg-purple-100 text-purple-800',
  'completed': 'bg-green-100 text-green-800',
  'canceled': 'bg-red-100 text-red-800',
} as const;

const PAYMENT_TONE_STYLES: Record<PaymentDisplay['tone'], string> = {
  positive: 'bg-green-100 text-green-800',
  negative: 'bg-red-100 text-red-800',
  pending: 'bg-yellow-100 text-yellow-800',
  neutral: 'bg-gray-100 text-gray-700',
};

const JOB_TONE_STYLES: Record<JobDisplay['tone'], string> = {
  vacation_rental: 'bg-sky-100 text-sky-800',
  residential: 'bg-violet-100 text-violet-800',
  labeled: 'bg-amber-100 text-amber-900',
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
    checkIn: 'Arrival window opens',
    checkInHint: 'Earliest the cleaner may arrive',
    checkOut: 'Must finish before',
    checkOutHint: 'Window end plus the expected hours — not the window end',
  },
};

export function JobSummaryHeader({
  job,
  isAdmin = false,
}: {
  job: JobDetails;
  /**
   * This header renders on the customer's own job page as well as the admin
   * one. It decides wording and whether the Stripe id is shown - never what is
   * fetched. The page authorizes the read before this ever renders.
   */
  isAdmin?: boolean;
}) {
  const serviceType: ServiceType =
    (job.serviceType as ServiceType | null) ?? 'vacation_rental_subscription';
  const labels = TIME_LABELS[serviceType];

  // A manual reclean/correction label wins over the service type. The time
  // labels above still come from `service_type`, because a reclean of a
  // turnover is still scheduled like a turnover.
  const display = getJobDisplay(job);

  // The window's own bounds live in the snapshot as a KEY, not as two
  // timestamps — `check_out_time` is the finish deadline, which is the window
  // end PLUS the job's expected hours, so the window cannot be reconstructed
  // from the two columns. Rendering it from the key is the only truthful
  // version.
  const arrivalWindow = getArrivalWindow(
    job.addonsSnapshot?.arrivalWindow as ArrivalWindowKey | undefined
  );

  // Null for every job that predates payment tracking. Rendering nothing is the
  // point: those jobs were not "unpaid", nobody ever recorded a status for them.
  const payment = getPaymentDisplay(job.status, job.paymentStatus);

  // `check_out_time` on a residential clean is the internal finish deadline -
  // the window's end PLUS the expected hours. Showing a customer "must finish
  // before 3:47 PM" states a promise nobody made and one they would reasonably
  // hold us to. Admin still sees it, because staffing depends on it, and a
  // vacation-rental owner still sees it, because for them it is the real and
  // familiar fact: the next guest's check-in.
  const residentialCustomerView =
    !isAdmin && serviceType === 'residential_one_time';
  const showFinishDeadline = !residentialCustomerView;

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex flex-col md:flex-row justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Job {job.id.substring(0, 8)}
          </h1>
          <p className="text-gray-500 mt-1">{job.property?.address || 'No property'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${JOB_TONE_STYLES[display.tone]}`}
            >
              {display.label}
            </span>
            {/* The badge carries the client's own "Reclean/Correction"
                wording everywhere. Here there is room to say which of the two
                it actually is. */}
            {display.specific && (
              <span className="text-xs text-gray-500">{display.specific}</span>
            )}
          </div>
        </div>
        <div className="mt-4 md:mt-0 text-right">
          <span className="text-xs font-medium text-gray-500">STATUS</span>
          <p className={`mt-1 px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full ${STATUS_STYLES[job.status || 'unassigned']}`}>
            {job.status}
          </p>
          {payment && (
            <div className="mt-2">
              <span className="text-xs font-medium text-gray-500">PAYMENT</span>
              <p
                className={`mt-1 px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full ${PAYMENT_TONE_STYLES[payment.tone]}`}
              >
                {isAdmin ? payment.admin : payment.customer}
              </p>
              {/* The admin's next step is opening this in Stripe. A customer
                  has no use for it, so it is gated on the role rather than on
                  the page - this component renders on both.

                  A display rule, not a data rule: the job payload carries
                  `paymentIntentId` to the customer either way, because the
                  portal's promo-code affordance needs to know whether a
                  payment intent exists yet. It is the customer's own id and
                  useless without our Stripe keys - the reason it is not shown
                  is that it means nothing to them, not that it is a secret. */}
              {isAdmin && job.paymentIntentId && (
                <p className="mt-1 font-mono text-[11px] text-gray-500">
                  {job.paymentIntentId}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 border-t pt-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {residentialCustomerView ? 'Your clean' : labels.checkIn}
          </p>
          <p className="text-sm font-medium text-gray-900">
            {job.checkInTime ? (
              <ClientTime
                dateString={job.checkInTime}
                // The stored instant is the START of the window the customer
                // chose, so printing it to the minute promises a precision
                // nobody gave them. The window label below is the promise.
                dateOnly={Boolean(residentialCustomerView && arrivalWindow)}
              />
            ) : (
              'Not set'
            )}
          </p>
          <p className="text-xs text-gray-500">
            {arrivalWindow
              ? residentialCustomerView
                ? `Your cleaner will arrive between ${arrivalWindow.label}`
                : `Arrival window: ${arrivalWindow.label}`
              : residentialCustomerView
                ? 'We will confirm your arrival time before the clean.'
                : labels.checkInHint}
          </p>
        </div>
        {showFinishDeadline && (
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
        )}
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
