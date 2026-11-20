// Synthetic, in-memory PostgreSQL and controlled channels. Never load root env.
const path = require("node:path"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
for (const key of Object.keys(process.env)) {
  if (/database|postgres|supabase|stripe|resend|twilio|vapid|cron_secret/i.test(key)) delete process.env[key];
}
process.env.NEXT_PUBLIC_APP_URL = "https://app.example.invalid";
delete process.env.AVAILABILITY_GRACE_ENABLED;
process.env.TSX_TSCONFIG_PATH = path.join(root, "tsconfig.json");
require("tsx/cjs");
const Module = require("node:module"), originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === "server-only") return {};
  if (["dotenv", "postgres", "twilio", "resend", "web-push"].includes(name)) throw Error("Uncontrolled provider/env import: " + name);
  return originalLoad.call(this, name, ...args);
};
global.fetch = async () => { throw Error("Network prohibited"); };
for (const name of ["node:http", "node:https"]) {
  const transport = require(name);
  transport.request = transport.get = () => { throw Error("Network prohibited"); };
}
require("node:net").Socket.prototype.connect = function() { throw Error("Network prohibited"); };
function replace(file, exports) {
  const key = require.resolve(path.join(root, file));
  require.cache[key] = { id: key, filename: key, loaded: true, exports };
}
const { PGlite } = require("@electric-sql/pglite"), { drizzle } = require("drizzle-orm/pglite");
const { PgTable, PgDialect, getTableConfig, isPgEnum } = require("drizzle-orm/pg-core");
const { is, SQL, eq, and } = require("drizzle-orm");
const schema = require("../db/schema.ts"), pg = new PGlite(), db = drizzle(pg, { schema });
replace("db/index.ts", { db, schema });
const calls = [], emails = [];
let dispatchFails = false, emailOutcome = "accepted", linkedCleaner;
replace("lib/services/notifications/notify.ts", {
  notifyCleaner: async input => {
    calls.push(input);
    if (dispatchFails) throw Error("Synthetic dispatch failure");
  },
});
replace("lib/services/email.service.ts", {
  sendTransactionalEmail: async (...input) => {
    emails.push(input);
    if (emailOutcome === "throw") throw Error("Synthetic email failure");
    return { success: emailOutcome === "accepted", error: emailOutcome === "accepted" ? undefined : "Synthetic provider rejection" };
  },
});
replace("lib/cleaner-auth.ts", { getCleanerAuth: async () => ({ cleanerId: linkedCleaner }), cleanerAuthErrorStatus: () => 401 });
replace("lib/cleaner/require-eligible.ts", { requireCleanerAssignmentEligible: async () => ({ eligible: true }) });
replace("lib/services/trigger-assignment-engine.ts", { triggerAssignmentEngine: async () => {} });
const dates = require("../lib/cleaner/availability-deadline.ts");
const { availabilityReminderStage: stage } = require("../lib/scheduling/reminder-stage.ts");
const { sendStagedAvailabilityReminders: send } = require("../lib/services/notifications/availability-reminders.ts");
const api = require("../app/api/cleaner/availability/route.ts");
const availability = require("../lib/queries/cleaner-availability.ts");
let passed = 0;
async function test(name, run) { await run(); passed++; console.log("PASS " + name); }
async function setup() {
  const dialect = new PgDialect(), tables = new Map(), enums = new Map();
  for (const value of Object.values(schema)) {
    if (isPgEnum(value)) enums.set(value.enumName, value.enumValues);
    if (is(value, PgTable)) {
      const table = getTableConfig(value); tables.set(table.name, table);
      for (const c of table.columns) if (c.enum?.enumName) enums.set(c.enum.enumName, c.enum.enumValues);
    }
  }
  for (const [name, values] of enums) await pg.exec(`CREATE TYPE "${name}" AS ENUM (${values.map(v => `'${v}'`).join(",")});`);
  for (const table of tables.values()) {
    const columns = table.columns.map(c => {
      let def = "";
      if (c.default !== undefined) {
        const v = c.default;
        def = " DEFAULT " + (is(v, SQL) ? dialect.sqlToQuery(v).sql : typeof v === "string" ? `'${v.replaceAll("'", "''")}'` : typeof v === "object" ? `'${JSON.stringify(v)}'` : JSON.stringify(v));
      }
      return `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${def}`;
    });
    await pg.exec(`CREATE TABLE "${table.name}" (${columns.join(",")});`);
  }
  // Actual production keys used by ON CONFLICT, not a JS mock of deduplication.
  await pg.exec(`CREATE UNIQUE INDEX phase2c_reminder_dedupe_idx ON phase2c_reminder_deliveries(cleaner_id, period_start, stage);
    CREATE UNIQUE INDEX availability_submission_test_key ON cleaner_availability_submissions(cleaner_id, period_start);
    ALTER TABLE phase2c_availability_days ADD PRIMARY KEY(cleaner_id, date);`);
}
async function cleaner(values = {}) {
  return (await db.insert(schema.cleaners).values({ fullName: "Synthetic cleaner", email: `${crypto.randomUUID()}@example.invalid`, accountStatus: "active", eligibleForAssignments: true, ...values }).returning())[0];
}
async function run() {
  await setup();
  await test("Eastern cadence boundaries, DST transitions and host timezones", async () => {
    const cases = [
      ["2026-11-06T22:59:59Z", null], ["2026-11-06T23:00Z", "friday"],
      ["2026-11-07T04:59Z", "friday"], ["2026-11-07T05:00Z", null],
      ["2026-11-08T16:59:59Z", null], ["2026-11-08T17:00Z", "morning"],
      ["2026-11-08T21:59:59Z", "morning"], ["2026-11-08T22:00Z", "last_call"],
      ["2026-11-08T23:00Z", "missed"],
      ["2027-03-12T23:00Z", "friday"], ["2027-03-14T15:59Z", null],
      ["2027-03-14T16:00Z", "morning"], ["2027-03-14T21:00Z", "last_call"],
      ["2026-10-30T22:00Z", "friday"], ["2026-11-01T17:00Z", "morning"],
    ];
    for (const tz of ["UTC", "America/New_York", "Asia/Kolkata"]) {
      process.env.TZ = tz;
      for (const [instant, expected] of cases) assert.equal(stage(new Date(instant)), expected, tz + " " + instant);
    }
  });
  await test("Friday and Sunday target the same upcoming fortnight across DST/year end", async () => {
    for (const [friday, sunday, monday] of [
      ["2026-11-06T23:00Z", "2026-11-08T17:00Z", "2026-11-09"],
      ["2027-03-12T23:00Z", "2027-03-14T16:00Z", "2027-03-15"],
      ["2026-10-30T22:00Z", "2026-11-01T17:00Z", "2026-11-02"],
      ["2027-12-31T23:00Z", "2028-01-02T17:00Z", "2028-01-03"],
    ]) {
      const a = dates.getUpcomingAvailabilityWindow(new Date(friday)), b = dates.getUpcomingAvailabilityWindow(new Date(sunday));
      assert.deepEqual(a.period, b.period); assert.equal(a.period.start, monday); assert.equal(a.period.dates.length, 14);
    }
    assert.equal(dates.getAvailabilityWindow(new Date("2026-11-06T23:00Z")).period.start, "2026-11-02");
  });
  const friday = new Date("2026-11-06T23:00Z"), sunday = new Date("2026-11-08T17:00Z");
  const a = await cleaner(), b = await cleaner();
  await cleaner({ accountStatus: "suspended" }); await cleaner({ eligibleForAssignments: false });
  await db.insert(schema.cleanerAvailabilitySubmissions).values({ cleanerId: b.id, periodStart: "2026-11-09", periodEnd: "2026-11-22", submissionMode: "full" });
  await test("active eligible non-submitters only; upcoming acknowledgement suppresses Friday", async () => {
    assert.deepEqual(await send(friday), { reminded: 1, skipped: 1, failed: 0 });
    assert.equal(calls.length, 1); assert.equal(calls[0].cleanerId, a.id); assert.equal(calls[0].sms, true);
    assert.equal(calls[0].url, "/cleaner/availability?periodStart=2026-11-09");
    assert.equal(emails[0][2].ctaUrl, "https://app.example.invalid/cleaner/availability?periodStart=2026-11-09");
  });
  await test("poll retry dedupes Friday but does not suppress Sunday noon or last call", async () => {
    assert.deepEqual(await send(friday), { reminded: 0, skipped: 2, failed: 0 });
    assert.equal((await send(sunday)).reminded, 1);
    assert.equal((await send(new Date("2026-11-08T22:00Z"))).reminded, 1);
    assert.equal(calls.length, 3);
    const rows = await db.select().from(schema.reminderDeliveries).where(eq(schema.reminderDeliveries.cleanerId, a.id));
    assert.deepEqual(rows.map(r => r.stage).sort(), ["friday", "last_call", "morning"]);
    assert.ok(rows.every(r => r.periodStart === "2026-11-09" && r.attempts === 1));
  });
  await test("off-stage polls perform no dispatch", async () => {
    const before = calls.length;
    assert.deepEqual(await send(new Date("2026-11-08T16:59Z")), { reminded: 0, skipped: 0, failed: 0 });
    assert.equal(calls.length, before);
  });
  await test("an operational-period submission cannot suppress the upcoming-period reminder", async () => {
    const c = await cleaner();
    await db.insert(schema.cleanerAvailabilitySubmissions).values({ cleanerId: c.id, periodStart: "2026-11-02", periodEnd: "2026-11-15", submissionMode: "full" });
    assert.equal((await send(friday)).reminded, 1);
    assert.equal(calls.at(-1).cleanerId, c.id);
    await db.update(schema.cleaners).set({ eligibleForAssignments: false }).where(eq(schema.cleaners.id, c.id));
  });
  await test("legacy missed stage keeps its period and channels without introducing another SMS time", async () => {
    assert.equal((await send(new Date("2026-11-08T23:00Z"))).reminded, 1);
    assert.equal(calls.at(-1).metadata.stage, "missed");
    assert.equal(calls.at(-1).metadata.periodStart, "2026-11-09");
    assert.equal(calls.at(-1).sms, false);
  });
  await test("dispatch failure still attempts email; failed claims are never blindly replayed", async () => {
    await db.delete(schema.reminderDeliveries); dispatchFails = true;
    const before = emails.length;
    assert.equal((await send(friday)).failed, 1); assert.equal(emails.length, before + 1);
    const [row] = await db.select().from(schema.reminderDeliveries).where(eq(schema.reminderDeliveries.cleanerId, a.id));
    assert.equal(row.status, "failed"); assert.match(row.error, /channel logs/);
    assert.equal((await send(friday)).failed, 0); assert.equal(emails.length, before + 1);
    dispatchFails = false;
  });
  await test("rejected/thrown email does not claim success or starve other cleaners", async () => {
    for (const outcome of ["rejected", "throw"]) {
      await db.delete(schema.reminderDeliveries); emailOutcome = outcome;
      const c = await cleaner();
      const summary = await send(friday); assert.ok(summary.failed >= 2); assert.equal(summary.reminded, 0);
      const [row] = await db.select().from(schema.reminderDeliveries).where(eq(schema.reminderDeliveries.cleanerId, c.id));
      assert.equal(row.status, "failed");
      await db.update(schema.cleaners).set({ eligibleForAssignments: false }).where(eq(schema.cleaners.id, c.id));
    }
    emailOutcome = "accepted";
  });
  await test("uncertain sending claims are not replayed and next stage remains independent", async () => {
    await db.delete(schema.reminderDeliveries);
    await db.insert(schema.reminderDeliveries).values({ cleanerId: a.id, periodStart: "2026-11-09", stage: "friday", status: "sending", attempts: 1 });
    assert.equal((await send(friday)).reminded, 0);
    assert.equal((await send(sunday)).reminded, 1);
  });
  await test("explicit links accept only current/upcoming dates, keeping legacy defaults", async () => {
    assert.equal(dates.resolveAvailabilityWindow(undefined, friday).period.start, "2026-11-02");
    assert.equal(dates.resolveAvailabilityWindow("2026-11-09", friday).period.start, "2026-11-09");
    for (const value of ["2026-11-03", "2026-11-16", "2020-01-01", "", "bad"]) assert.throws(() => dates.resolveAvailabilityWindow(value, friday), RangeError);
  });
  await test("authenticated GET reads intended period; unrelated/stale dates and anonymous access fail", async () => {
    linkedCleaner = a.id;
    const upcoming = dates.getUpcomingAvailabilityWindow().period;
    const response = await api.GET(new Request(`https://app.example.invalid/api/cleaner/availability?periodStart=${upcoming.start}`));
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).period, upcoming);
    assert.equal((await api.GET(new Request("https://app.example.invalid/api/cleaner/availability?periodStart=2020-01-01"))).status, 400);
    linkedCleaner = null; assert.equal((await api.GET(new Request("https://app.example.invalid/api/cleaner/availability"))).status, 401);
  });
  await test("POST acknowledges the linked fortnight and stale periods cannot mutate data", async () => {
    linkedCleaner = a.id;
    const upcoming = dates.getUpcomingAvailabilityWindow().period;
    // PGlite is single-session; emulate only the unavailable advisory-lock primitive.
    await pg.exec("CREATE OR REPLACE FUNCTION pg_advisory_xact_lock(bigint) RETURNS void LANGUAGE sql AS 'SELECT';");
    const days = upcoming.dates.map(date => ({ date, revision: 0, isAvailable: false, onCallEligible: false, openPoolEligible: false }));
    const request = start => new Request(`https://app.example.invalid/api/cleaner/availability?periodStart=${start}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) });
    const response = await api.POST(request(upcoming.start));
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    const [ack] = await db.select().from(schema.cleanerAvailabilitySubmissions).where(and(eq(schema.cleanerAvailabilitySubmissions.cleanerId, a.id), eq(schema.cleanerAvailabilitySubmissions.periodStart, upcoming.start)));
    assert.equal(ack.periodEnd, upcoming.end);
    assert.equal((await api.POST(request("2020-01-01"))).status, 400);
    assert.equal((await availability.getCleanerAvailability(a.id, upcoming.start)).days.filter(d => d.acknowledged).length, 14);
  });
  await test("stale day revisions and incomplete fortnight writes remain rejected", async () => {
    const upcoming = dates.getUpcomingAvailabilityWindow().period;
    const days = upcoming.dates.map(date => ({ date, revision: 0, isAvailable: true, onCallEligible: false, openPoolEligible: false }));
    const post = body => api.POST(new Request(`https://app.example.invalid/api/cleaner/availability?periodStart=${upcoming.start}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: body }) }));
    assert.equal((await post(days)).status, 409);
    assert.equal((await post(days.slice(1))).status, 400);
    assert.ok((await availability.getCleanerAvailability(a.id, upcoming.start)).days.every(d => d.isAvailable === false));
  });
  await test("existing Sunday locks, assigned coverage and positive additions are unchanged", async () => {
    const { assertAvailabilityChange } = require("../lib/scheduling/availability-policy.ts");
    const no = { isAvailable: false, onCallEligible: false, openPoolEligible: false }, yes = { ...no, isAvailable: true };
    const now = new Date("2026-11-08T23:00Z");
    assert.throws(() => assertAvailabilityChange({ date: "2026-11-09", before: yes, after: no, assigned: false, reopened: false, now }), /locked/);
    assert.throws(() => assertAvailabilityChange({ date: "2026-11-09", before: yes, after: no, assigned: true, reopened: true, now }), /Assigned/);
    assert.equal(assertAvailabilityChange({ date: "2026-11-09", before: no, after: yes, assigned: false, reopened: false, now }).late, true);
  });
  await test("late availability submission and missed reminders do not change reliability, pay or job payments", async () => {
    const snapshot = async () => JSON.stringify({
      reliability: (await pg.query('select * from reliability_events order by id')).rows,
      payouts: (await pg.query('select * from payouts order by id')).rows,
      jobs: (await pg.query('select id,payment_intent_id,payment_status from jobs order by id')).rows,
      cleaners: (await pg.query('select * from cleaners order by id')).rows,
    });
    const subject = await cleaner();
    const baseline = await snapshot(), period = dates.getAvailabilityWindow().period;
    await availability.saveCleanerLateOverrideAvailability(subject.id, period.dates.map(date => ({date,revision:0,isAvailable:date>=dates.easternToday(),onCallEligible:false,openPoolEligible:false})),period);
    await send(new Date('2026-11-08T23:30:00Z'));
    assert.equal(await snapshot(),baseline);
  });
  await test("one-hour grace allows unassigned edits, then one catch-up per block with ordinary coverage locks restored", async () => {
    const RealDate=Date;let instant=Date.parse('2026-11-08T22:30:00Z');
    global.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;} };
    process.env.AVAILABILITY_GRACE_ENABLED='true';
    try {
      const subject=await cleaner(),period=dates.buildPeriodFromMonday('2026-11-09');
      const input=(available,revision=0)=>period.dates.map(date=>({date,revision,isAvailable:available,onCallEligible:false,openPoolEligible:false}));
      await availability.saveCleanerAvailability(subject.id,input(true),{period});
      instant=RealDate.parse('2026-11-08T23:30:00Z');assert.equal(stage(new Date()),null);
      const [assignedJob]=await db.insert(schema.jobs).values({status:'assigned',calendarEventUid:crypto.randomUUID(),checkInTime:new Date('2026-11-09T16:00Z')}).returning();
      await db.insert(schema.jobsToCleaners).values({jobId:assignedJob.id,cleanerId:subject.id,role:'primary'});
      await assert.rejects(()=>availability.saveCleanerAvailability(subject.id,input(false,1),{period}),/Assigned/);
      await db.delete(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,assignedJob.id));
      await availability.saveCleanerAvailability(subject.id,input(false,1),{period});
      assert.ok((await db.select().from(schema.availabilityDays).where(eq(schema.availabilityDays.cleanerId,subject.id))).every(row=>!row.late));
      instant=RealDate.parse('2026-11-09T00:00:00Z');assert.equal(stage(new Date()),'missed');
      const lateSubject=await cleaner();await availability.saveCleanerLateOverrideAvailability(lateSubject.id,input(false),period);
      const [ack]=await db.select().from(schema.cleanerAvailabilitySubmissions).where(eq(schema.cleanerAvailabilitySubmissions.cleanerId,lateSubject.id));assert.equal(ack.submissionMode,'override');
      await assert.rejects(()=>availability.saveCleanerLateOverrideAvailability(lateSubject.id,input(false,1),period),/already used/);
      assert.equal((await availability.getCleanerAvailability(lateSubject.id,period.start)).canLateOverride,false);
      await availability.saveCleanerAvailability(lateSubject.id,input(true,1),{period});
      await assert.rejects(()=>availability.saveCleanerAvailability(lateSubject.id,input(false,2),{period}),/locked/);
      // Exactly 19:00 is outside grace; host timezone does not change the allowance.
      assert.equal(dates.availabilitySubmissionPhase(period.start,new Date('2026-11-08T23:59:59.999Z')).grace,true);
      assert.equal(dates.availabilitySubmissionPhase(period.start,new Date('2026-11-09T00:00:00Z')).catchUp,true);
    } finally {global.Date=RealDate;delete process.env.AVAILABILITY_GRACE_ENABLED;}
  });
  await test("real SMS adapter honors consent/current number and records rejection separately from acceptance", async () => {
    let consent = { phone: "+12025550123", canSend: false }, rejected = false;
    const attempts = [], providerCalls = [];
    replace("lib/services/cleaner-sms-consent.ts", { getCleanerSmsConsentState: async () => consent });
    replace("lib/services/notifications/notification-log.ts", { recordNotificationAttempt: async input => attempts.push(input) });
    const restrictedLoad = Module._load;
    Module._load = function(name, ...args) {
      if (name === "twilio") return () => ({ messages: { create: async input => {
        providerCalls.push(input); if (rejected) throw Error("Synthetic provider rejection"); return { sid: "synthetic" };
      } } });
      return restrictedLoad.call(this, name, ...args);
    };
    process.env.TWILIO_ACCOUNT_SID = "synthetic"; process.env.TWILIO_AUTH_TOKEN = "synthetic"; process.env.TWILIO_FROM_NUMBER = "+15005550006";
    delete require.cache[require.resolve("../lib/services/sms.service.ts")];
    const { sendSms } = require("../lib/services/sms.service.ts");
    await db.update(schema.cleaners).set({ phone: consent.phone }).where(eq(schema.cleaners.id, a.id));
    assert.equal(await sendSms(consent.phone, "Synthetic reminder", { cleanerId: a.id }), false);
    assert.equal(providerCalls.length, 0); assert.equal(attempts.at(-1).status, "skipped");
    consent = { ...consent, canSend: true };
    assert.equal(await sendSms("+12025550124", "Synthetic reminder", { cleanerId: a.id }), false);
    assert.equal(providerCalls.length, 0);
    assert.equal(await sendSms(consent.phone, "Synthetic reminder", { cleanerId: a.id }), true);
    assert.equal(attempts.at(-1).status, "sent"); assert.equal(providerCalls.length, 1);
    rejected = true;
    assert.equal(await sendSms(consent.phone, "Synthetic reminder", { cleanerId: a.id }), false);
    assert.equal(attempts.at(-1).status, "failed");
    Module._load = restrictedLoad;
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) delete process.env[key];
  });
  console.log(`${passed}/${passed} availability checks passed; in-memory PostgreSQL, network blocked, mocked channels. Advisory locking/concurrency and provider delivery require separate verification.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pg.close());
