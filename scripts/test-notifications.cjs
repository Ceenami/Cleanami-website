// Real in-process PostgreSQL; no credentials, network, or provider sends.
const path = require("node:path"), fs = require("node:fs"), assert = require("node:assert/strict"), crypto = require("node:crypto"), vm = require("node:vm");
process.env.TSX_TSCONFIG_PATH = path.join(__dirname, "../tsconfig.json");
require("tsx/cjs");
const Module = require("node:module"), originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === "server-only") return {};
  return originalLoad.call(this, name, ...args);
};
const root = path.resolve(__dirname, ".."), uuid = () => crypto.randomUUID();
function replace(file, exports) {
  const key = require.resolve(path.join(root, file));
  require.cache[key] = { id: key, filename: key, loaded: true, exports };
}
global.fetch = async () => { throw Error("Network prohibited"); };
const { PGlite } = require("@electric-sql/pglite"), { drizzle } = require("drizzle-orm/pglite");
const { PgTable, PgDialect, getTableConfig, isPgEnum } = require("drizzle-orm/pg-core");
const { is, SQL, eq, and } = require("drizzle-orm");
const schema = require("../db/schema.ts"), pg = new PGlite(), database = drizzle(pg, { schema });
let inboxFails = false, pushFails = false, smsFails = false, claimable = new Set();
const attempts = [], pushes = [], sms = [], emails = [];
const db = new Proxy(database, {
  get(target, key) {
    if (key === "insert") return table => {
      if (table === schema.notifications && inboxFails) throw Error("Synthetic inbox failure");
      return target.insert(table);
    };
    const value = target[key];
    return typeof value === "function" ? value.bind(target) : value;
  }
});
replace("db/index.ts", { db, schema });
replace("lib/services/urgent-replacement.service.ts", { getClaimableUrgentJobIds: async ids => new Set(ids.filter(id => claimable.has(id))) });
replace("lib/services/notifications/notification-log.ts", { recordNotificationAttempt: async entry => attempts.push(entry) });
replace("lib/services/push.service.ts", { sendPushToCleaner: async (id, payload) => { pushes.push({ id, payload }); if (pushFails) throw Error("Synthetic push failure"); return 1; } });
replace("lib/services/sms.service.ts", { sendSms: async (phone, message, meta) => { sms.push({ phone, message, meta }); if (smsFails) throw Error("Synthetic SMS failure"); return true; } });
replace("lib/services/email.service.ts", { sendAdminAlertEmail: async input => emails.push(input) });
replace("lib/services/job-execution-contract.ts", { getExecutionContract: async () => null });
replace("lib/queries/cleaner-swap.ts", { expireStaleSwapRequests: async () => 0 });
replace("lib/services/notifications/availability-reminders.ts", { sendStagedAvailabilityReminders: async () => ({ reminded: 0 }) });
let adminSession, cleanerSession, role = "admin";
replace("lib/supabase/server.ts", { createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: adminSession ? { sub: adminSession.supabaseUserId, email: adminSession.email } : null } }) } }) });
replace("lib/auth/server-roles.ts", { resolveRoleFromDatabase: async () => role });
replace("lib/cleaner-auth.ts", { getCleanerAuth: async () => ({ cleanerId: cleanerSession, error: cleanerSession ? null : "Unauthorized" }), cleanerAuthErrorStatus: () => 401 });
const reader = require("../lib/queries/user-notifications.ts"), cleaner = require("../lib/queries/cleaner-notifications.ts");
const { notifyCleaner } = require("../lib/services/notifications/notify.ts"), { notifyAdmins } = require("../lib/queries/admin-notifications.ts");
const reminders = require("../lib/services/notifications/reminders.service.ts"), reconciliation = require("../lib/services/job-reconciliation.service.ts");
const adminApi = require("../app/api/notifications/route.ts"), singleApi = require("../app/api/notifications/[id]/mark-read/route.ts"), cleanerApi = require("../app/api/cleaner/notifications/route.ts");
const destination = require("../lib/notifications/destination.ts");
const results = [];
async function test(name, fn) { await fn(); results.push(name); console.log("PASS " + name); }
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
  await pg.exec("ALTER TABLE notifications ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE; ALTER TABLE notifications ADD FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;");
}
async function user(role) { return (await db.insert(schema.users).values({ supabaseUserId: uuid(), role, email: `${uuid()}@example.invalid` }).returning())[0]; }
async function worker() {
  const u = await user("cleaner");
  const [c] = await db.insert(schema.cleaners).values({ userId: u.id, fullName: "Synthetic Cleaner", email: u.email, phone: "+12025550123" }).returning();
  return { ...c, user: u };
}
async function job(values = {}) { return (await db.insert(schema.jobs).values({ calendarEventUid: uuid(), ...values }).returning())[0]; }
async function notification(userId, values = {}) { return (await db.insert(schema.notifications).values({ userId, type: "assignment", title: "Synthetic notification", message: "Synthetic message", ...values }).returning())[0]; }
async function row(id) { return (await db.select().from(schema.notifications).where(eq(schema.notifications.id, id)))[0]; }
async function clearInbox() { await db.delete(schema.notifications); }

// Render actual components with real React. Hook adapters supply controlled server responses.
const React = require("react"), ReactDOM = require("react-dom/server"), ts = require("typescript");
function loadUi(file, mocks) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const m = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${js}\n})`)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (["react", "react/jsx-runtime"].includes(name)) return require(name);
    throw Error("Uncontrolled UI dependency: " + name);
  }, m, m.exports);
  return m.exports;
}
function render(file, component, data, extra = {}) {
  const mod = loadUi(file, {
    react: { ...React, useState: value => React.useState(value === false ? true : value) },
    "next/link": ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children),
    "lucide-react": new Proxy({}, { get: () => () => null }),
    "sonner": { toast: { error() { }, success() { } } },
    "@/lib/utils": { cn: (...args) => args.filter(Boolean).join(" ") },
    "@/hooks/useSignOut": { useSignOut: () => () => { } },
    "@/hooks/useCurrentUser": { useCurrentUser: () => ({ data: { role: "admin" } }) },
    "@/hooks/useNotificationInbox": { useNotificationInbox: () => ({ data, isLoading: false, isFetching: false, isError: false, refetch() { }, markRead: { isPending: false, isError: false, mutate() { } }, ...extra }) },
  });
  return ReactDOM.renderToStaticMarkup(React.createElement(mod[component]));
}
async function run() {
  await setup();
  const admin = await user("admin"), superAdmin = await user("super_admin"), other = await user("customer"), a = await worker(), b = await worker(), backup = await worker();
  adminSession = admin; cleanerSession = a.id;
  const j = await job();
  await test("reconciliation review and uncovered alerts persist destinations for every admin", async () => {
    await job({ status: "in-progress", checkInTime: new Date("2026-10-28T12:00Z") });
    await job({ status: "unassigned", checkInTime: new Date("2026-10-28T12:00Z") });
    const summary = await reconciliation.reconcileStaleJobs(new Date("2026-10-29T12:00Z"));
    assert.equal(summary.alertsSent, 2);
    const rows = await db.select().from(schema.notifications);
    assert.equal(rows.length, 4);
    for (const n of rows) { assert.ok([admin.id, superAdmin.id].includes(n.userId)); assert.equal(n.metadata.url, `/admin/job-oversight/${n.jobId}`); }
  });
  await clearInbox();
  await test("older job notifications gain links without rewriting rows", async () => {
    const n = await notification(admin.id, { type: "completion_reminder", jobId: j.id, metadata: { source: "job_reconciliation", outcome: "incomplete_evidence" } });
    const response = await adminApi.GET(); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.notifications[0].url, `/admin/job-oversight/${j.id}`);
    assert.equal((await row(n.id)).metadata.url, undefined);
    for (const [file, component] of [["components/dashbboard/admin/notifications/NotificationsPageClient.tsx", "NotificationsPageClient"], ["components/dashbboard/layout/header/AdminNotificationsBell.tsx", "AdminNotificationsBell"]]) {
      assert.ok(render(file, component, body).includes(`href="/admin/job-oversight/${j.id}"`));
    }
  });
  await test("booking and swap destinations retain their explicit destination", async () => {
    await notifyAdmins({ type: "booking_alert", title: "Booking", message: "Fixture", jobId: j.id, url: `/admin/job-oversight/${j.id}` });
    await notifyAdmins({ type: "swap_requested", title: "Swap", message: "Fixture", jobId: j.id, url: "/admin/job-oversight?view=swaps" });
    const inbox = await reader.getUserNotificationsBySupabaseId(admin.supabaseUserId);
    assert.equal(inbox.notifications.find(n => n.title === "Booking").url, `/admin/job-oversight/${j.id}`);
    assert.equal(inbox.notifications.find(n => n.title === "Swap").url, "/admin/job-oversight?view=swaps");
  });
  await test("dispute and restock alerts open their management pages, including older rows", async () => {
    await cleaner.notifyAdminsOfDispute("Synthetic", "pay");
    await cleaner.notifyAdminsOfRestockRequest({ cleanerName: "Synthetic", propertyAddress: "Synthetic", item: "Soap", quantity: 1, urgency: "urgent", jobId: j.id });
    const inbox = await reader.getUserNotificationsBySupabaseId(admin.supabaseUserId);
    assert.equal(inbox.notifications.find(n => n.title === "New cleaner dispute").url, "/admin/disputes");
    assert.equal(inbox.notifications.find(n => n.title === "URGENT: Restock request").url, "/admin/restocking");
    assert.equal(destination.adminNotificationUrl({ type: "urgent_job", metadata: { source: "cleaner_dispute" } }), "/admin/disputes");
    assert.equal(destination.adminNotificationUrl({ type: "urgent_job", jobId: j.id, metadata: { source: "restock_request" } }), "/admin/restocking");
  });
  await test("deleted jobs clear old JSON detail links as well as legacy links", async () => {
    const deleted = await job();
    const n = await notification(admin.id, { jobId: deleted.id, metadata: { url: `/admin/job-oversight/${deleted.id}` } });
    await db.delete(schema.jobs).where(eq(schema.jobs.id, deleted.id));
    assert.equal((await row(n.id)).jobId, null);
    const inbox = await reader.getUserNotificationsBySupabaseId(admin.supabaseUserId);
    assert.equal(inbox.notifications.find(v => v.id === n.id).url, null);
    assert.equal(destination.adminNotificationUrl({ type: "assignment", jobId: null }), null);
    assert.equal(destination.cleanerNotificationUrl({ type: "assignment", jobId: null, metadata: { url: `/cleaner/jobs/${deleted.id}` } }), null);
  });
  await test("external, cross-role, malformed and traversal URLs never become links", () => {
    for (const url of ["javascript:alert(1)", "https://evil.invalid/admin/jobs", "//evil.invalid", "/admin/../api/private", "/admin/%2e%2e/api", "/admin/\\evil", "/admin/\nfoo", "/cleaner/jobs"]) assert.equal(destination.adminNotificationUrl({ type: "assignment", metadata: { url } }), null, url);
    assert.equal(destination.adminNotificationUrl({ type: "assignment", jobId: "../../evil" }), null);
    assert.equal(destination.adminNotificationUrl({ type: "assignment", jobId: j.id, metadata: { url: `/admin/job-oversight/${uuid()}` } }), `/admin/job-oversight/${j.id}`);
  });
  await clearInbox();
  await test("unread badge counts beyond the first page and excludes future notifications", async () => {
    for (let i = 0;i < 55;i++) await notification(admin.id);
    await notification(other.id);
    const future = await notification(admin.id, { scheduledFor: new Date("2099-01-01T00:00Z") });
    const inbox = await reader.getUserNotificationsBySupabaseId(admin.supabaseUserId, { limit: 2 });
    assert.equal(inbox.notifications.length, 2); assert.equal(inbox.unreadCount, 55);
    assert.equal(await reader.markUserNotificationRead(admin.supabaseUserId, future.id), false);
    await reader.markAllUserNotificationsRead(admin.supabaseUserId);
    assert.equal((await row(future.id)).isRead, false);
  });
  await test("API writes stay recipient-scoped and reject signed-out or non-admin users", async () => {
    const own = await notification(admin.id), foreign = await notification(other.id);
    const post = id => singleApi.POST(new Request("https://example.invalid"), { params: Promise.resolve({ id }) });
    assert.equal((await post(foreign.id)).status, 404); assert.equal((await row(foreign.id)).isRead, false);
    assert.equal((await post(own.id)).status, 200); assert.equal((await row(own.id)).isRead, true);
    role = "customer"; assert.equal((await adminApi.GET()).status, 401); assert.equal((await adminApi.PATCH()).status, 401); assert.equal((await post(own.id)).status, 401);
    role = "admin"; adminSession = null; assert.equal((await adminApi.GET()).status, 401); assert.equal((await adminApi.PATCH()).status, 401); assert.equal((await post(own.id)).status, 401); adminSession = admin;
    assert.equal((await adminApi.PATCH()).status, 200); assert.equal((await row(foreign.id)).isRead, false);
  });
  await clearInbox();
  await test("cleaner availability destination survives writer, reader, API and rendered drawer", async () => {
    await notifyCleaner({ cleanerId: a.id, type: "availability_reminder", title: "Availability", message: "Fixture", url: "/cleaner/availability" });
    const response = await cleanerApi.GET(); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.notifications[0].url, "/cleaner/availability");
    assert.equal(pushes.at(-1).payload.url, "/cleaner/availability");
    assert.ok(render("components/cleaner/CleanerHeader.tsx", "CleanerHeader", body).includes('href="/cleaner/availability"'));
  });
  await test("cleaner legacy payment, dispute, assignment and reminder destinations stay in cleaner portal", async () => {
    for (const [type, url] of [["payment_ready", "/cleaner/pay"], ["dispute_update", "/cleaner/profile"], ["assignment", "/cleaner/jobs"], ["job_reminder", "/cleaner/jobs"]]) {
      const n = await notification(a.user.id, { type, jobId: j.id });
      assert.equal((await cleaner.getCleanerNotifications(a.id)).notifications.find(v => v.id === n.id).url, url);
    }
    await notifyCleaner({ cleanerId: a.id, type: "job_reminder", title: "Reminder", message: "Fixture", jobId: j.id, url: `/cleaner/jobs/${j.id}` });
    assert.equal((await cleaner.getCleanerNotifications(a.id)).notifications.find(v => v.title === "Reminder").url, `/cleaner/jobs/${j.id}`);
  });
  await test("ordinary swap offers reach candidates and never render an urgent-accept action", async () => {
    const ordinarySwap = loadUi("lib/queries/cleaner-swap.ts", {
      "server-only": {}, "@/db": { db }, "@/db/schemas": schema, "drizzle-orm": require("drizzle-orm"),
      "@/lib/queries/admin-notifications": { notifyAdmins },
      "@/lib/services/assignment/team-roles": {},
      "@/lib/services/notifications/notify": { notifyCleaner },
      "@/lib/services/assignment/eligibility": {},
      "@/lib/services/swap/swap-candidates": { getSwapCandidates: async () => ({ candidates: [{ cleanerId: a.id, fullName: a.fullName }] }) },
      "@/lib/services/urgent-replacement.service": {},
    });
    const swapJob = await job({ status: "assigned", checkInTime: new Date(Date.now() + 3 * 86400000) });
    await db.insert(schema.jobsToCleaners).values({ jobId: swapJob.id, cleanerId: b.id, role: "primary" });
    const opened = await ordinarySwap.createCleanerSwapRequest(b.id, swapJob.id);
    assert.equal(opened.success, true);
    let inbox = await cleaner.getCleanerNotifications(a.id);
    const offer = inbox.notifications.find(n => n.jobId === swapJob.id);
    assert.equal(offer.type, "swap_requested"); assert.equal(offer.url, "/cleaner/jobs");
    const html = render("components/cleaner/CleanerHeader.tsx", "CleanerHeader", { notifications: [offer], unreadCount: 1 });
    assert.ok(html.includes('href="/cleaner/jobs"')); assert.ok(!html.includes("Accept urgent job"));
    const oldOffer = await notification(a.user.id, { type: "swap_available", jobId: swapJob.id });
    inbox = await cleaner.getCleanerNotifications(a.id);
    assert.equal(inbox.notifications.find(n => n.id === oldOffer.id).type, "swap_requested");
    await db.update(schema.swapRequests).set({ expiresAt: new Date(0) }).where(eq(schema.swapRequests.id, opened.swapRequestId));
    inbox = await cleaner.getCleanerNotifications(a.id);
    assert.ok(!inbox.notifications.some(n => n.jobId === swapJob.id));
    claimable.add(swapJob.id);
    inbox = await cleaner.getCleanerNotifications(a.id);
    const urgent = inbox.notifications.find(n => n.id === oldOffer.id);
    assert.equal(urgent.type, "swap_available");
    assert.ok(render("components/cleaner/CleanerHeader.tsx", "CleanerHeader", { notifications: [urgent], unreadCount: 1 }).includes("Accept urgent job"));
    claimable.clear();
  });
  await clearInbox();
  await test("stale cover offers are filtered before pagination and never hide valid older rows", async () => {
    const valid = await notification(a.user.id, { createdAt: new Date("2020-01-01Z") });
    for (let i = 0;i < 25;i++) await notification(a.user.id, { type: "swap_available", jobId: j.id });
    await notification(a.user.id, { type: "swap_available", jobId: null });
    await notification(a.user.id, { scheduledFor: new Date("2099-01-01Z") });
    await notification(b.user.id);
    let inbox = await cleaner.getCleanerNotifications(a.id, 1);
    assert.equal(inbox.notifications[0].id, valid.id); assert.equal(inbox.unreadCount, 1);
    claimable.add(j.id); inbox = await cleaner.getCleanerNotifications(a.id, 1); assert.equal(inbox.notifications.length, 1); assert.equal(inbox.unreadCount, 26);
    assert.equal(await cleaner.getUnreadNotificationCount(a.id), 26); claimable.clear();
  });
  await test("cleaner mark-all-read stays scoped and does not consume future reminders", async () => {
    await cleanerApi.PATCH();
    const others = await cleaner.getCleanerNotifications(b.id); assert.equal(others.unreadCount, 1);
    const [future] = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, a.user.id), eq(schema.notifications.scheduledFor, new Date("2099-01-01Z"))));
    assert.equal(future.isRead, false);
    cleanerSession = null; assert.equal((await cleanerApi.GET()).status, 401); assert.equal((await cleanerApi.PATCH()).status, 401); cleanerSession = a.id;
  });
  await test("in-app failure still attempts push and SMS and records the failed channel", async () => {
    inboxFails = true; const p = pushes.length, s = sms.length;
    await assert.rejects(notifyCleaner({ cleanerId: a.id, type: "job_reminder", title: "Fixture", message: "Fixture", jobId: j.id, sms: true }), /dispatch failed/);
    inboxFails = false; assert.equal(pushes.length, p + 1); assert.equal(sms.length, s + 1);
    assert.ok(attempts.some(a => a.channel === "in_app" && a.status === "failed"));
  });
  await test("push failure cannot prevent time-critical SMS", async () => {
    pushFails = true; const s = sms.length;
    await assert.rejects(notifyCleaner({ cleanerId: a.id, type: "job_reminder", title: "Fixture", message: "Fixture", jobId: j.id, sms: true }), /dispatch failed/);
    pushFails = false; assert.equal(sms.length, s + 1); assert.ok(attempts.some(a => a.channel === "push" && a.status === "failed"));
  });
  await test("SMS failure retains in-app notification and reports dispatch failure", async () => {
    smsFails = true;
    await assert.rejects(notifyCleaner({ cleanerId: a.id, type: "job_reminder", title: "SMS failure fixture", message: "Fixture", sms: true }), /dispatch failed/);
    smsFails = false;
    assert.ok((await cleaner.getCleanerNotifications(a.id)).notifications.some(n => n.title === "SMS failure fixture"));
    assert.ok(attempts.some(a => a.channel === "sms" && a.status === "failed"));
  });
  await test("admin inbox failure still sends critical email without claiming inbox success", async () => {
    inboxFails = true; const e = emails.length;
    assert.equal(await notifyAdmins({ type: "assignment", title: "Critical", message: "Fixture", jobId: j.id, email: true }), 0);
    inboxFails = false; assert.equal(emails.length, e + 2); assert.equal(emails.at(-1).url, `/admin/job-oversight/${j.id}`);
  });
  await clearInbox();
  const now = new Date("2035-10-29T12:00Z"), start = new Date(+now + 30 * 60000);
  const upcoming = await job({ status: "assigned", checkInTime: start });
  for (const [c, role] of [[a, "primary"], [b, "laundry_lead"], [backup, "backup"]]) await db.insert(schema.jobsToCleaners).values({ jobId: upcoming.id, cleanerId: c.id, role });
  await test("partial team reminder retries only missing recipients, excluding backups", async () => {
    await notification(a.user.id, { type: "job_reminder", jobId: upcoming.id, metadata: { source: "notify", scheduleStart: start.toISOString() } });
    const p = pushes.length;
    assert.equal((await reminders.sendUpcomingJobReminders(now)).reminded, 1);
    assert.equal(pushes.length, p + 1); assert.equal(pushes.at(-1).id, b.id);
    assert.equal((await reminders.sendUpcomingJobReminders(now)).skipped, 1); assert.equal(pushes.length, p + 1);
  });
  await test("revised starts get new reminders and untagged creation-trigger rows cannot suppress them", async () => {
    const revised = new Date(+now + 45 * 60000);
    await db.update(schema.jobs).set({ checkInTime: revised }).where(eq(schema.jobs.id, upcoming.id));
    await notification(a.user.id, { type: "job_reminder", jobId: upcoming.id });
    const p = pushes.length; await reminders.sendUpcomingJobReminders(now); assert.equal(pushes.length, p + 2);
  });
  await test("one dispatch failure does not starve the remaining team", async () => {
    await clearInbox(); pushFails = true; const p = pushes.length, s = sms.length;
    await assert.rejects(reminders.sendUpcomingJobReminders(now), /Some job reminders failed/);
    pushFails = false; assert.equal(pushes.length, p + 2); assert.equal(sms.length, s + 2);
  });
  await test("inbox components show failures and keep unread badges until a confirmed write", () => {
    for (const [file, component] of [["components/dashbboard/layout/header/AdminNotificationsBell.tsx", "AdminNotificationsBell"], ["components/cleaner/CleanerHeader.tsx", "CleanerHeader"]]) {
      const html = render(file, component, { notifications: [], unreadCount: 3 }, { isError: true, markRead: { isError: true, error: Error("Write failed"), isPending: true } });
      assert.ok(html.includes('role="alert"')); assert.ok(html.includes("Write failed")); assert.ok(html.includes("Retry")); assert.ok(html.includes("disabled=")); assert.ok(!html.includes("No notifications yet"));
    }
  });
  await test("shared hook rejects HTTP/network failures and invalidates both admin surfaces after success", async () => {
    let query, mutation, invalidated, calls = [];
    const hook = loadUi("hooks/useNotificationInbox.ts", { "@tanstack/react-query": { useQuery: options => { query = options; return {}; }, useMutation: options => { mutation = options; return {}; }, useQueryClient: () => ({ invalidateQueries: input => { invalidated = input; } }) } });
    hook.useNotificationInbox("admin");
    global.fetch = async (...args) => { calls.push(args); return { ok: false }; };
    await assert.rejects(query.queryFn(), /Could not load/); await assert.rejects(mutation.mutationFn(), /Could not mark/); assert.equal(invalidated, undefined);
    global.fetch = async (...args) => { calls.push(args); return { ok: true, json: async () => ({ notifications: [], unreadCount: 0 }) }; };
    await mutation.mutationFn(); mutation.onSuccess(); assert.deepEqual(invalidated.queryKey, ["notifications", "admin"]); assert.equal(calls.at(-1)[1].method, "PATCH");
    await mutation.mutationFn(j.id); assert.equal(calls.at(-1)[0], `/api/notifications/${j.id}/mark-read`); assert.equal(calls.at(-1)[1].method, "POST");
    hook.useNotificationInbox("cleaner"); await query.queryFn(); assert.equal(calls.at(-1)[0], "/api/cleaner/notifications");
    global.fetch = async () => { throw Error("Offline"); }; await assert.rejects(query.queryFn(), /Offline/); await assert.rejects(mutation.mutationFn(), /Offline/);
  });
  const channelMocks = {
    "server-only": {}, "@/db": { db }, "@/db/schemas": schema, "drizzle-orm": require("drizzle-orm"),
    "@/lib/services/notifications/notification-log": { recordNotificationAttempt: async entry => attempts.push(entry) },
  };
  const savedPublic = process.env.VAPID_PUBLIC_KEY, savedPrivate = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  const webPush = { setVapidDetails() {}, sendNotification: async subscription => {
    if (subscription.endpoint.includes("expired")) throw { statusCode: 410 };
    if (subscription.endpoint.includes("rejected")) throw Error("Provider rejected");
  } };
  await test("unconfigured push is logged as skipped", async () => {
    const push = loadUi("lib/services/push.service.ts", { ...channelMocks, "web-push": webPush });
    assert.equal(await push.sendPushToCleaner(a.id, { title: "Fixture", body: "Fixture" }), 0);
    assert.equal(attempts.at(-1).status, "skipped"); assert.equal(attempts.at(-1).channel, "push");
  });
  process.env.VAPID_PUBLIC_KEY = "synthetic-public"; process.env.VAPID_PRIVATE_KEY = "synthetic-private";
  const actualPush = loadUi("lib/services/push.service.ts", { ...channelMocks, "web-push": webPush });
  await test("configured push with no registered devices is skipped", async () => {
    assert.equal(await actualPush.sendPushToCleaner(a.id, { title: "Fixture", body: "Fixture" }), 0);
    assert.equal(attempts.at(-1).status, "skipped");
  });
  await test("push prunes expired subscriptions and still sends to healthy devices", async () => {
    for (const endpoint of ["expired", "healthy"]) await db.insert(schema.pushNotificationTokens).values({ cleanerId: a.id, token: JSON.stringify({ endpoint: `https://${endpoint}.invalid`, keys: {} }) });
    await db.insert(schema.pushNotificationTokens).values({ cleanerId: a.id, token: "malformed-json" });
    assert.equal(await actualPush.sendPushToCleaner(a.id, { title: "Fixture", body: "Fixture" }), 1);
    assert.equal(attempts.at(-1).status, "sent");
    assert.equal((await db.select().from(schema.pushNotificationTokens)).length, 2);
  });
  await test("push provider rejection is logged and optional strict mode rejects", async () => {
    await db.delete(schema.pushNotificationTokens);
    await db.insert(schema.pushNotificationTokens).values({ cleanerId: a.id, token: JSON.stringify({ endpoint: "https://rejected.invalid", keys: {} }) });
    assert.equal(await actualPush.sendPushToCleaner(a.id, { title: "Fixture", body: "Fixture" }), 0);
    assert.equal(attempts.at(-1).status, "failed");
    await assert.rejects(actualPush.sendPushToCleaner(a.id, { title: "Fixture", body: "Fixture" }, {}, { throwOnFailure: true }), /Provider rejected/);
  });
  if (savedPublic === undefined) delete process.env.VAPID_PUBLIC_KEY; else process.env.VAPID_PUBLIC_KEY = savedPublic;
  if (savedPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY; else process.env.VAPID_PRIVATE_KEY = savedPrivate;
  let emailMode = "missing"; const providerEmails = [];
  const savedAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://notification.example.invalid";
  const actualEmail = loadUi("lib/services/email.service.ts", {
    ...channelMocks,
    "@/lib/resend": { EMAIL_FROM: "fixture@example.invalid", getEmailUnavailableMessage: () => "Unconfigured", getResend: () => emailMode === "missing" ? null : { emails: { send: async input => {
      providerEmails.push(input);
      if (emailMode === "throw") throw Error("Email offline");
      return { error: emailMode === "rejected" ? { message: "Provider rejected email" } : null };
    } } } },
    "../emails/TransactionalEmail": props => props,
    "../emails/CustomerPortalEmail": () => ({}),
    "../emails/ResumeSetupEmail": () => ({}),
    "@/lib/constants/contact": require("../lib/constants/contact.ts"),
    "@/lib/constants/service-type": require("../lib/constants/service-type.ts"),
  });
  await test("email distinguishes unconfigured, rejected, thrown and accepted sends", async () => {
    for (const [mode, status] of [["missing", "skipped"], ["rejected", "failed"], ["throw", "failed"], ["ok", "sent"]]) {
      emailMode = mode;
      const result = await actualEmail.sendTransactionalEmail("fixture@example.invalid", "Fixture", { heading: "Fixture", bodyLines: ["Fixture"] });
      assert.equal(result.success, mode === "ok"); assert.equal(attempts.at(-1).status, status); assert.equal(attempts.at(-1).channel, "email");
    }
  });
  await test("booking, completion, assignment and admin emails retain valid portal destinations", async () => {
    await actualEmail.sendBookingConfirmationEmail({ to: "fixture@example.invalid", propertyAddress: "Synthetic", firstCleanDate: "Oct 30", amount: "$100" });
    assert.equal(providerEmails.at(-1).react.ctaUrl, "https://notification.example.invalid/customer/dashboard");
    await actualEmail.sendJobCompletionEmail({ to: "fixture@example.invalid", propertyAddress: "Synthetic" });
    assert.equal(providerEmails.at(-1).react.ctaUrl, "https://notification.example.invalid/customer/dashboard");
    await actualEmail.sendCleanerAssignmentEmail({ to: "fixture@example.invalid", propertyAddress: "Synthetic", jobDate: "Oct 30" });
    assert.equal(providerEmails.at(-1).react.ctaUrl, "https://notification.example.invalid/cleaner/jobs");
    await actualEmail.sendAdminAlertEmail({ to: "fixture@example.invalid", subject: "Fixture", message: "Fixture", url: `/admin/job-oversight/${j.id}` });
    assert.equal(providerEmails.at(-1).react.ctaUrl, `https://notification.example.invalid/admin/job-oversight/${j.id}`);
  });
  await test("residential confirmation uses the chosen date and does not include access credentials", () => {
    const content = actualEmail.buildResidentialBookingConfirmationEmail({ to: "fixture@example.invalid", propertyAddress: "Synthetic", cleanDate: "2026-10-30", arrivalWindowLabel: "9–11 AM", amount: "$100", petsAllowed: false, petFeeApplied: false, entryMethod: "keypad", entryInstructions: "SECRET-DOOR-CODE" });
    assert.ok(JSON.stringify(content).includes("Friday, October 30, 2026")); assert.ok(!JSON.stringify(content).includes("SECRET-DOOR-CODE"));
  });
  if (savedAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = savedAppUrl;
  const handlers = {}, shown = [], opened = []; let windows = [], focused = 0;
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/sw.js"), "utf8"), { URL, self: {
    location: { origin: "https://notification.example.invalid" }, addEventListener: (name, handler) => { handlers[name] = handler; },
    registration: { showNotification: async (title, options) => shown.push({ title, ...options }) },
    clients: { matchAll: async () => windows, openWindow: async url => opened.push(url) },
  } });
  async function pushEvent(data) { let pending; handlers.push({ data, waitUntil: p => { pending = p; } }); await pending; }
  async function clickEvent(url) { let pending; handlers.notificationclick({ notification: { data: { url }, close() {} }, waitUntil: p => { pending = p; } }); await pending; }
  await test("service worker handles empty/malformed payloads and uses an existing icon", async () => {
    await pushEvent({ json: () => null }); assert.equal(shown.at(-1).title, "CleanNami");
    await pushEvent({ json: () => { throw Error("Bad JSON"); }, text: () => "Plain text" }); assert.equal(shown.at(-1).body, "Plain text");
    assert.ok(fs.existsSync(path.join(root, "public", shown.at(-1).icon))); assert.ok(fs.existsSync(path.join(root, "public", shown.at(-1).badge)));
  });
  await test("push clicks focus exact destinations and never focus a substring match", async () => {
    windows = [{ url: "https://notification.example.invalid/cleaner/jobs/old", focus: async () => { focused++; } }];
    await clickEvent("/cleaner/jobs"); assert.equal(focused, 0); assert.equal(opened.at(-1), "https://notification.example.invalid/cleaner/jobs");
    windows = [{ url: "https://notification.example.invalid/cleaner/jobs", focus: async () => { focused++; } }];
    const o = opened.length; await clickEvent("/cleaner/jobs"); assert.equal(focused, 1); assert.equal(opened.length, o);
    await clickEvent("/"); assert.equal(focused, 1); assert.equal(opened.at(-1), "https://notification.example.invalid/");
  });
  await test("push payloads cannot open external or script destinations", async () => {
    for (const url of ["https://evil.invalid/", "//evil.invalid/", "javascript:alert(1)", "http://["]) {
      await clickEvent(url); assert.equal(opened.at(-1), "https://notification.example.invalid/");
    }
    await pushEvent({ json: () => ({ title: "Fixture", url: "/cleaner/availability" }) }); assert.equal(shown.at(-1).data.url, "https://notification.example.invalid/cleaner/availability");
  });
  console.log(`${results.length}/${results.length} notification checks passed. Local PostgreSQL and controlled Auth/delivery/UI adapters; no external sends.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pg.close());
