import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getTwilio } from "@/lib/services/sms.service";
import { normalizeSmsPhone } from "@/lib/sms/consent";
import { getAppBaseUrl } from "@/lib/app-url";
import { ADMIN_SMS_LABELS, adminSmsDestination, type AdminSmsRequest, type AdminSmsCategory } from "@/lib/notifications/admin-sms";
import { overdueArrivalFilter } from "@/lib/jobs/operations-filter";
import { jobs } from "@/db/schemas";
import { and, eq } from "drizzle-orm";
import { recordNotificationAttempt } from "./notification-log";
import { adminSmsSettings } from "./admin-sms-settings";
const rows = <T>(value: unknown): T[] => (Array.isArray(value) ? value : (value as { rows: T[] }).rows) as T[];
type Intent = { identity: string; recipient: string; sender_key: string; environment: string; category: AdminSmsCategory;
  job_id: string | null; destination: string; state: string; created_at: string; claimed_at: string | null; provider_sid: string | null };
type Preference = { carrier_blocked: boolean; last_stop_sid: string | null; last_stop_at: string | null; last_start_at: string | null };

/** ADMIN_SMS_ENABLED is the operator's explicit application opt-in for the
 * configured number. Carrier START does not set it or enroll a cleaner. */
export async function enqueueAdminSms(notice: AdminSmsRequest, jobId: string | null = null) {
  const settings = adminSmsSettings();
  if (!settings.enabled) return { state: "disabled" };
  if (!settings.schemaReady || !settings.recipient || !settings.senderKey || !settings.environment || !settings.allowed)
    return { state: "skipped", reason: "Admin SMS configuration is incomplete or TEST recipient is not allowlisted" };
  if (!notice.identity || notice.identity.length > 2000 || !Object.hasOwn(ADMIN_SMS_LABELS, notice.category)) throw Error("Invalid admin SMS identity/category");
  const identity = createHash("sha256").update(`admin-email:${notice.identity}`).digest("hex");
  await db.transaction(async tx => {
    await tx.execute(sql`insert into admin_sms_preferences(recipient,sender_key,opted_in_at) values(${settings.recipient},${settings.senderKey},clock_timestamp())
      on conflict(recipient,sender_key) do update set opted_in_at=coalesce(admin_sms_preferences.opted_in_at,excluded.opted_in_at)`);
    await tx.execute(sql`insert into admin_sms_intents(identity,recipient,sender_key,environment,category,job_id,destination)
      values(${identity},${settings.recipient},${settings.senderKey},${settings.environment},${notice.category},${jobId}::uuid,${adminSmsDestination(notice.destination, jobId)}) on conflict do nothing`);
  });
  return { state: "queued", identity };
}
export async function enqueueAdminSmsSafely(notice: AdminSmsRequest, jobId: string | null = null) {
  try { return await enqueueAdminSms(notice, jobId); }
  catch {
    await recordNotificationAttempt({ channel: "sms", status: "failed", error: "Admin SMS intent could not be recorded; no provider request attempted", meta: { trigger: "admin_sms_intent", jobId } });
    return { state: "failed" };
  }
}

/** Failed/claimed/unknown outcomes never return to pending. An interrupted
 * provider request can have been accepted; automatic replay would duplicate it. */
export async function dispatchAdminSms(now = new Date()) {
  const settings = adminSmsSettings();
  if (!settings.enabled || !settings.schemaReady || !settings.recipient || !settings.senderKey || !settings.environment || !settings.allowed) return { disabled: true, processed: 0 };
  let processed = 0;
  const began = Date.now();
  while (processed < 100 && Date.now() - began < 20_000) {
    const [intent] = rows<Intent>(await db.execute(sql`with candidate as materialized(
      select identity from admin_sms_intents where state='pending' and environment=${settings.environment}
      order by (category='gps_overdue') desc,created_at,identity limit 1 for update skip locked)
      update admin_sms_intents i set state='claimed',claimed_at=clock_timestamp()
      from candidate c where i.identity=c.identity and i.state='pending' returning i.*`));
    if (!intent) break;
    processed++;
    let state = "unknown", reason: string | null = "Dispatch interrupted; review provider history before resending", sid: string | null = null;
    try {
      const fresh = adminSmsSettings();
      const [pref] = rows<Preference>(await db.execute(sql`select * from admin_sms_preferences where recipient=${intent.recipient} and sender_key=${intent.sender_key}`));
      let skip = !fresh.enabled || !fresh.schemaReady || !fresh.allowed || fresh.recipient !== intent.recipient || fresh.senderKey !== intent.sender_key || fresh.environment !== intent.environment
        ? "Recipient/sender/environment changed; old notice was not retargeted"
        : +now - +new Date(intent.created_at) > 30 * 60_000 ? "Operational notice expired after 30 minutes"
        : pref?.carrier_blocked ? "Admin recipient opted out at the carrier" : null;
      if (!skip && intent.category === "gps_overdue") {
        const due = intent.job_id ? await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, intent.job_id), overdueArrivalFilter())) : [];
        if (!due.length) skip = "Arrival warning is no longer current";
      }
      const client = getTwilio();
      if (skip) { state = "skipped"; reason = skip; }
      else if (!client) { state = "failed"; reason = "Twilio credentials unavailable; no request attempted"; }
      else {
        const destination = adminSmsDestination(intent.destination, intent.job_id);
        // Fixed category + scoped link only. No arbitrary email subject/body,
        // property address, access code or private note enters this channel.
        const message = await providerDeadline(client.messages.create({ to: intent.recipient,
          ...(intent.sender_key.startsWith("service:") ? { messagingServiceSid: intent.sender_key.slice(8) } : { from: intent.sender_key.slice(5) }),
          body: `CleanNami: ${ADMIN_SMS_LABELS[intent.category]}. ${getAppBaseUrl()}${destination}\nReply STOP to opt out or HELP for help.`,
          ...(process.env.NOTIFICATION_WORKFLOWS_SCHEMA_READY === "true" && process.env.TWILIO_STATUS_WEBHOOK_URL ? { statusCallback: process.env.TWILIO_STATUS_WEBHOOK_URL } : {}),
        }));
        if (!/^(SM|MM)[0-9a-f]{32}$/i.test(message.sid ?? "")) throw Error("Provider acceptance could not be identified");
        sid = message.sid; state = "sent"; reason = null;
      }
    } catch (error) {
      const status = Number((error as { status?: number }).status), code = Number((error as { code?: number }).code);
      state = status >= 400 && status < 500 && status !== 408 ? "failed" : "unknown";
      reason = state === "failed" ? "Provider rejected the request; inspect delivery history" : "Provider acceptance is uncertain; do not automatically resend";
      if (code === 21610) await db.execute(sql`update admin_sms_preferences set carrier_blocked=true,last_stop_sid=null,last_stop_at=clock_timestamp() where recipient=${intent.recipient} and sender_key=${intent.sender_key}`);
    }
    await db.execute(sql`update admin_sms_intents set state=${state},provider_sid=${sid},last_error=${reason} where identity=${intent.identity} and state='claimed'`);
    await recordNotificationAttempt({ channel: "sms", status: state === "sent" ? "sent" : state === "skipped" ? "skipped" : "failed",
      providerMessageId: sid, error: reason, meta: { trigger: `admin_sms_${intent.category}`, recipient: intent.recipient, jobId: intent.job_id } });
  }
  return { disabled: false, processed };
}

async function providerDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Provider outcome timed out")), 10_000); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function messageTime(sid: string, phone: string): Promise<Date> {
  const client = getTwilio(); if (!client) throw Error("Cannot verify carrier event order");
  const message = await providerDeadline(client.messages(sid).fetch());
  if (message.accountSid !== process.env.TWILIO_ACCOUNT_SID || normalizeSmsPhone(message.from) !== phone || !message.dateCreated || !Number.isFinite(+message.dateCreated)) throw Error("Carrier message identity/order could not be verified");
  return message.dateCreated;
}

/** Called only after existing inbound signature/account/sender validation.
 * STOP is fail-closed immediately; START must have verifiable provider ordering.
 * Same-second ambiguity favors STOP. No external request holds a DB lock. */
export async function recordAdminCarrierPreference(phoneValue: string, blocked: boolean, messageSid: string) {
  const settings = adminSmsSettings(), phone = normalizeSmsPhone(phoneValue);
  if (!settings.schemaReady || !settings.senderKey || !phone) return false;
  const [prior] = rows<Preference>(await db.execute(sql`select * from admin_sms_preferences where recipient=${phone} and sender_key=${settings.senderKey}`));
  if (phone !== settings.recipient && !prior) return false;
  if (rows(await db.execute(sql`select message_sid from admin_sms_carrier_events where message_sid=${messageSid}`)).length) return true;
  let created: Date | null = null, stopTime = prior?.last_stop_at ? new Date(prior.last_stop_at) : null;
  try { created = await messageTime(messageSid, phone); } catch (error) { if (!blocked) throw error; }
  if (!blocked && prior?.carrier_blocked && !stopTime && prior.last_stop_sid) stopTime = await messageTime(prior.last_stop_sid, phone);
  if (!blocked && prior?.carrier_blocked && !stopTime) throw Error("Carrier block order needs review; START cannot clear an unknown block");
  await db.transaction(async tx => {
    await tx.execute(sql`insert into admin_sms_preferences(recipient,sender_key) values(${phone},${settings.senderKey}) on conflict do nothing`);
    const [current] = rows<Preference>(await tx.execute(sql`select * from admin_sms_preferences where recipient=${phone} and sender_key=${settings.senderKey} for update`));
    const inserted = rows(await tx.execute(sql`insert into admin_sms_carrier_events(message_sid,recipient,sender_key,blocked,provider_created_at)
      values(${messageSid},${phone},${settings.senderKey},${blocked},${created?.toISOString() ?? null}::timestamptz) on conflict do nothing returning message_sid`));
    if (!inserted.length) return;
    if (blocked) {
      // A delayed older STOP must not erase the latest STOP. Preserve an
      // unverifiable block until its own provider timestamp can be checked.
      if (!created || (!(current.carrier_blocked && !current.last_stop_at) &&
          (!current.last_start_at || +created >= +new Date(current.last_start_at)) &&
          (!current.last_stop_at || +created >= +new Date(current.last_stop_at))))
        await tx.execute(sql`update admin_sms_preferences set carrier_blocked=true,last_stop_sid=${messageSid},last_stop_at=${created?.toISOString() ?? null}::timestamptz where recipient=${phone} and sender_key=${settings.senderKey}`);
    } else {
      const lastStop = current.last_stop_at ? new Date(current.last_stop_at) : current.last_stop_sid === prior?.last_stop_sid ? stopTime : null;
      if ((!current.carrier_blocked || lastStop) && created && (!lastStop || +created > +lastStop) && (!current.last_start_at || +created > +new Date(current.last_start_at)))
        await tx.execute(sql`update admin_sms_preferences set carrier_blocked=false,last_start_at=${created.toISOString()}::timestamptz where recipient=${phone} and sender_key=${settings.senderKey}`);
    }
  });
  return true;
}

export async function loadAdminSmsStatus() {
  const settings = adminSmsSettings();
  const configuration = { enabled: settings.enabled, schemaReady: settings.schemaReady, recipientConfigured: !!settings.recipient,
    recipientLabel: settings.recipient ? `…${settings.recipient.slice(-4)}` : null, senderConfigured: !!settings.senderKey,
    environment: settings.environment, recipientAllowed: settings.allowed };
  if (!settings.schemaReady) return { configuration, carrierBlocked: false, items: [] };
  const [pref] = settings.recipient && settings.senderKey ? rows<Preference>(await db.execute(sql`select * from admin_sms_preferences where recipient=${settings.recipient} and sender_key=${settings.senderKey}`)) : [];
  const items = rows(await db.execute(sql`select i.identity,i.category,i.job_id,i.state,i.last_error,i.created_at,i.provider_sid,s.status delivery_status,s.error_code
    from admin_sms_intents i left join phase3a_message_status s on s.message_sid=i.provider_sid
    order by i.created_at desc,i.identity limit 100`));
  return { configuration, carrierBlocked: !!pref?.carrier_blocked, items };
}
