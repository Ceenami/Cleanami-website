/** Fixed operational summaries. Never mirror arbitrary email/user text into SMS. */
export const ADMIN_SMS_LABELS = {
  admin_notice: "New administration notice", assignment: "Assignment update",
  swap_requested: "Cleaner swap request", dispute_update: "Dispute update",
  booking_alert: "Booking update", subscription_purchase: "Paid subscription recorded",
  one_off_booking: "One-time booking recorded", turnover_created: "New calendar turnover",
  gps_overdue: "Urgent: overdue GPS check-in",
} as const;
export type AdminSmsCategory = keyof typeof ADMIN_SMS_LABELS;
export type AdminSmsRequest = { identity: string; category: AdminSmsCategory; destination?: string };
export function adminSmsDestination(value: string | undefined, jobId: string | null) {
  // Paths only, with no query parameters, fragments or user-supplied text.
  if (jobId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return `/admin/job-oversight/${jobId}`;
  return value && /^\/admin\/(dashboard|job-oversight|subscriptions|availability|notifications)$/.test(value) ? value : "/admin/notifications";
}
