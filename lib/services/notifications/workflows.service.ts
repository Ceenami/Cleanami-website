import "server-only";
import { db } from "@/db";
import { jobs, subscriptions, cleaners, jobsToCleaners } from "@/db/schemas";
import { and, eq, sql } from "drizzle-orm";
import { getAppBaseUrl } from "@/lib/app-url";
import { getJobDisplay } from "@/lib/constants/service-type";
import { getArrivalWindow } from "@/lib/scheduling/arrival-windows";
import { toEasternDateString } from "@/lib/time/eastern";
import { overdueArrivalFilter } from "@/lib/jobs/operations-filter";
import { residentialCustomerScope } from "@/lib/customer/residential-scope";
import { readResidentialSnapshot } from "@/lib/pricing/residential-v2/contracts";
import { sendTransactionalEmail, buildResidentialBookingConfirmationEmail } from "@/lib/services/email.service";
import type { TransactionalEmailProps } from "@/lib/emails/TransactionalEmail";
import { notifyCleaner } from "./notify";
import { notificationWorkflowCutoff, workflowRecipientAllowed } from "./workflow-settings";
import { enqueueAdminSmsSafely } from "./admin-sms.service";
import type { AdminSmsCategory } from "@/lib/notifications/admin-sms";

type Event = { identity: string; kind: string; job_id: string | null; subscription_id: string | null; cleaner_id: string | null; state: string };
function rows<T>(result: unknown): T[] { return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[]; }
const management = () => process.env.NOTIFICATION_MANAGEMENT_EMAIL || "cleannami@ceenami.com";
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
type Message = { to: string; subject: string; props: Omit<TransactionalEmailProps, "previewText"> & { previewText?: string } };

/** Discovery is idempotent; checks are repeated immediately before provider dispatch. */
export async function discoverNotificationEvents(now = new Date()) {
  const cutoff = notificationWorkflowCutoff();
  if (!cutoff) return;
  const today = toEasternDateString(now);
  await db.execute(sql`insert into phase3a_notification_events(identity,kind,subscription_id)
    select 'term_end:'||id::text||':'||end_date::text,'term_end',id from subscriptions
    where status::text='active' and end_date=${today}::date+7 on conflict do nothing`);
  const due = await db.select({ id: jobs.id, start: jobs.checkInTime, snapshot: jobs.addonsSnapshot }).from(jobs)
    .where(and(overdueArrivalFilter(), sql`${jobs.checkInTime}>=${cutoff.toISOString()}::timestamptz`, sql`(${jobs.checkInTime} at time zone 'America/New_York')::date=${today}::date`,
      sql`not exists(select 1 from phase3a_notification_events n where n.identity='gps_overdue:'||${jobs.id}::text||':'||to_char(${jobs.checkInTime} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')||':'||coalesce(${jobs.addonsSnapshot}->>'arrivalWindow',''))`)).orderBy(jobs.checkInTime, jobs.id).limit(200);
  for (const job of due) {
    const identity = `gps_overdue:${job.id}:${job.start!.toISOString()}:${job.snapshot?.arrivalWindow ?? ""}`;
    await db.execute(sql`insert into phase3a_notification_events(identity,kind,job_id) values(${identity},'gps_overdue',${job.id}::uuid) on conflict do nothing`);
  }
}

async function messageFor(event: Event, now: Date): Promise<Message | null> {
  if (event.kind === "subscription_purchase" || event.kind === "term_end") {
    if (!event.subscription_id) return null;
    const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, event.subscription_id), with: { customer: true, property: true } });
    if (!sub || sub.status !== "active") return null;
    if (event.kind === "term_end") {
      if (event.identity !== `term_end:${sub.id}:${sub.endDate}` ||
          new Date(`${sub.endDate}T12:00Z`).getTime() - new Date(`${toEasternDateString(now)}T12:00Z`).getTime() !== 7 * 86400000 || !sub.customer?.email) return null;
      return { to: sub.customer.email, subject: "Your CleanNami subscription term ends in seven days", props: {
        heading: "Your selected term ends soon", bodyLines: [`Your selected term for ${sub.property?.address ?? "your property"} ends on ${dateLabel(sub.endDate)}.`,
          "Review your subscription in the portal or contact management about next steps."],
        ctaLabel: "View subscription", ctaUrl: `${getAppBaseUrl()}/customer/subscriptions`,
      } };
    }
    return { to: management(), subject: "New paid subscription", props: {
      heading: "New subscription purchase", bodyLines: [`Property: ${sub.property?.address ?? "Not recorded"}.`, `Term: ${sub.durationMonths} months. Selected end: ${dateLabel(sub.endDate)}.`],
      ctaLabel: "View subscriptions", ctaUrl: `${getAppBaseUrl()}/admin/subscriptions`,
    } };
  }
  if (!event.job_id) return null;
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, event.job_id), with: { property: { with: { customer: true } }, evidencePacket: true } });
  if (!job) return null;
  const address = job.property?.address ?? "Property not recorded";
  const label = getJobDisplay(job).label;
  if (event.kind.startsWith("worker_removed")) {
    if (!event.cleaner_id) return null;
    // A queued removal must never tell someone they are unassigned after a later re-assignment.
    const member = await db.query.jobsToCleaners.findFirst({ where: and(eq(jobsToCleaners.jobId, job.id), eq(jobsToCleaners.cleanerId, event.cleaner_id)) });
    if (member) return null;
    const cleaner = await db.query.cleaners.findFirst({ where: eq(cleaners.id, event.cleaner_id) });
    if (!cleaner || cleaner.accountStatus !== "active") return null;
    return { to: cleaner.email, subject: "Your CleanNami assignment changed", props: {
      heading: "Assignment updated", bodyLines: [`You are no longer assigned to the ${label} at ${address}.`, "Review your current assignments. New working or backup duties require their own confirmation."],
      ctaLabel: "View current assignments", ctaUrl: `${getAppBaseUrl()}/cleaner/jobs`,
    } };
  }
  if (job.status === "canceled") return null;
  if (event.kind === "gps_overdue") {
    if (event.identity !== `gps_overdue:${job.id}:${job.checkInTime?.toISOString()}:${job.addonsSnapshot?.arrivalWindow ?? ""}`) return null;
    const due = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, job.id), overdueArrivalFilter()));
    if (!due.length) return null;
    return { to: management(), subject: "Urgent: overdue GPS check-in", props: {
      heading: "Arrival overdue — no check-in recorded", bodyLines: [`${label} at ${address} has passed its arrival allowance without a recorded check-in. Review staffing and contact the working team.`],
      ctaLabel: "Review job", ctaUrl: `${getAppBaseUrl()}/admin/job-oversight/${job.id}`,
    } };
  }
  if (event.kind === "one_off_receipt") {
    const terms = job.addonsSnapshot?.residentialPricing;
    if (terms) readResidentialSnapshot(job.addonsSnapshot);
    const customer = job.property?.customer;
    if (!customer?.email || !job.checkInTime || (job.paymentStatus !== "captured" && terms?.exception !== "owner_comp")) return null;
    if (job.serviceType === "residential_one_time" && terms) {
      const built = buildResidentialBookingConfirmationEmail({ to: customer.email, name: customer.name, propertyAddress: address,
        cleanDate: toEasternDateString(job.checkInTime), arrivalWindowLabel: getArrivalWindow(job.addonsSnapshot?.arrivalWindow ?? "")?.label ?? "See job details",
        amount: `$${(Number(terms.amountChargedCents) / 100).toFixed(2)}`, petsAllowed: !!job.addonsSnapshot?.petsAllowed,
        petFeeApplied: terms.ruleVersion === "residential-v2" && terms.input.petsAllowed && terms.exception !== "owner_comp",
        entryMethod: job.property?.entryMethod ?? null, cleaningLevel: terms.input.cleaningLevel,
        purpose: "purpose" in terms.input ? terms.input.purpose : undefined, purchasedScope: residentialCustomerScope(job.addonsSnapshot),
        paymentWaived: terms.exception === "owner_comp",
      });
      return { to: customer.email, ...built };
    }
    return { to: customer.email, subject: "Your one-time clean is booked", props: { heading: "Booking confirmed",
      bodyLines: [`Service: ${label}.`, `Property: ${address}.`, `Date: ${dateLabel(toEasternDateString(job.checkInTime))}.`, "Your payment is recorded. View your booking for details."],
      ctaLabel: "View booking", ctaUrl: `${getAppBaseUrl()}/customer/job-oversight/${job.id}` } };
  }
  if (!["one_off_booking", "turnover_created"].includes(event.kind)) return null;
  return { to: management(), subject: event.kind === "turnover_created" ? "New iCal turnover" : "New one-time booking", props: {
    heading: event.kind === "turnover_created" ? "Turnover created from iCal" : "One-time booking recorded",
    bodyLines: [`Service: ${label}.`, `Property: ${address}.`, `Payment status: ${job.paymentStatus ?? "No payment recorded"}.`],
    ctaLabel: "View job", ctaUrl: `${getAppBaseUrl()}/admin/job-oversight/${job.id}`,
  } };
}

/** Claims commit before external work. Failed/unknown/claimed events require reviewed recovery, never blind replay. */
export async function dispatchNotificationEvents(now = new Date()) {
  const cutoff = notificationWorkflowCutoff();
  if (!cutoff) return { disabled: true, processed: 0 };
  const events = rows<Event>(await db.execute(sql`update phase3a_notification_events set state='claimed',claimed_at=clock_timestamp()
    where identity in(select identity from phase3a_notification_events where state='pending' and created_at>=${cutoff.toISOString()}::timestamptz order by created_at,identity limit 100 for update skip locked)
    and state='pending' returning *`));
  for (const event of events) {
    let state = "unknown", outcome: unknown = null, recipient: string | null = null;
    try {
      const message = await messageFor(event, now);
      // SMS eligibility is independent of email configuration/TEST allowlists.
      // Only known management events are mirrored, never customer receipts or
      // cleaner emails whose address happens to equal an admin mailbox.
      if (message && ["subscription_purchase", "one_off_booking", "turnover_created", "gps_overdue"].includes(event.kind))
        await enqueueAdminSmsSafely({ identity: `workflow:${event.identity}`, category: event.kind as AdminSmsCategory,
          destination: event.kind === "subscription_purchase" ? "/admin/subscriptions" : undefined }, event.job_id);
      if (!message) state = "skipped";
      else if (!workflowRecipientAllowed(message.to)) { state = "skipped"; outcome = { reason: "test_recipient_not_allowlisted" }; }
      else {
        recipient = message.to;
        if (event.kind === "worker_removed_cleaner" && event.cleaner_id) {
          const cleaner = await db.query.cleaners.findFirst({ where: eq(cleaners.id, event.cleaner_id), columns: { phone: true } });
          const sms = process.env.NOTIFICATION_WORKFLOWS_ENVIRONMENT !== "test" || (!!cleaner?.phone && workflowRecipientAllowed(cleaner.phone));
          outcome = await notifyCleaner({ cleanerId: event.cleaner_id, type: "assignment", title: message.subject, message: message.props.bodyLines.join(" "),
            jobId: event.job_id, url: "/cleaner/jobs", sms });
          state = "sent";
        } else {
          const result = await sendTransactionalEmail(message.to, message.subject, { ...message.props, previewText: message.props.previewText ?? message.subject }, { trigger: event.kind, jobId: event.job_id });
          outcome = { status: result.status ?? (result.success ? "sent" : "failed"), providerMessageId: result.providerMessageId ?? null };
          // A required email skipped for missing configuration is an unfulfilled
          // event, not a silent success. Keep its actual channel status in outcome.
          state = result.success ? "sent" : result.status === "unknown" ? "unknown" : "failed";
        }
      }
    } catch { outcome = { reason: "dispatch_result_uncertain_review_channel_logs" }; }
    await db.execute(sql`update phase3a_notification_events set state=${state},recipient=${recipient},outcome=${JSON.stringify(outcome)}::jsonb where identity=${event.identity} and state='claimed'`);
  }
  return { disabled: false, processed: events.length };
}
