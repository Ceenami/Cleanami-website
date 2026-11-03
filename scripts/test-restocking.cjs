// Actual application queries on isolated in-process PostgreSQL. No network/production DB.
const path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
process.env.TSX_TSCONFIG_PATH = path.join(__dirname, "../tsconfig.json");
process.env.DATABASE_URL =
  "postgres://isolated:isolated@127.0.0.1:1/no_network";
require("tsx/cjs");
const Module = require("node:module"),
  originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  return originalLoad.call(this, name, ...args);
};
const { PGlite } = require("@electric-sql/pglite"),
  { drizzle } = require("drizzle-orm/pglite");
const {
  PgTable,
  PgDialect,
  getTableConfig,
  isPgEnum,
} = require("drizzle-orm/pg-core");
const { is, SQL, eq } = require("drizzle-orm");
const schema = require("../db/schema.ts"),
  pg = new PGlite();
let queryCount = 0,
  allowed = true;
const db = drizzle(pg, {
  schema,
  logger: {
    logQuery() {
      queryCount++;
    },
  },
});
const replace = (file, exports) => {
  const id = require.resolve(path.join(__dirname, "..", file));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
replace("db/index.ts", {
  db,
  sequentialQueries: async (...fns) => {
    const results = [];
    for (const fn of fns) results.push(await fn());
    return results;
  },
});
replace("lib/admin-auth.ts", {
  getAdminAuth: async () => ({ isAdmin: allowed }),
});
const adminId = crypto.randomUUID(),
  authId = crypto.randomUUID();
replace("lib/auth/server-roles.ts", {
  getAppUserIdForSupabaseUser: async () => adminId,
});
replace("lib/services/admin-job-operations.ts", {
  loadAdminJobOperations: async () => new Map(),
});
const pushEvents = [];
let pushFails = false,
  sessionCleanerId = null;
replace("lib/services/push.service.ts", {
  sendPushToCleaner: async (...args) => {
    if (pushFails) throw Error("Synthetic push failure");
    pushEvents.push(args);
    return 1;
  },
});
replace("lib/cleaner-auth.ts", {
  getCleanerAuth: async () => ({
    cleanerId: sessionCleanerId,
    error: sessionCleanerId ? null : "Unauthorized",
  }),
  cleanerAuthErrorStatus: () => 401,
});
const dal = require("../lib/queries/admin-restocking.ts");
const writer = require("../lib/queries/restock-requests.ts");
const notifications = require("../lib/queries/user-notifications.ts");
const destinations = require("../lib/notifications/destination.ts");
const jobQueries = require("../lib/queries/jobs.ts");
const api = require("../app/api/admin/restocking/route.ts");
const mutation = require("../app/api/restock-requests/[id]/route.ts");
const cleanerRequestsApi = require("../app/api/cleaner/restock-requests/route.ts");
const cleanerNotifications = require("../lib/queries/cleaner-notifications.ts");
const { NextRequest } = require("next/server");
const id = () => crypto.randomUUID();
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
async function setup() {
  const dialect = new PgDialect(),
    enums = new Map(),
    tables = new Map();
  for (const value of Object.values(schema)) {
    if (isPgEnum(value)) enums.set(value.enumName, value.enumValues);
    if (is(value, PgTable)) {
      const table = getTableConfig(value);
      tables.set(table.name, table);
      for (const c of table.columns)
        if (c.enum?.enumName) enums.set(c.enum.enumName, c.enum.enumValues);
    }
  }
  for (const [name, values] of enums)
    await pg.exec(
      `CREATE TYPE "${name}" AS ENUM (${values.map((v) => `'${v}'`).join(",")})`,
    );
  for (const table of tables.values()) {
    const columns = table.columns.map((c) => {
      let def = "";
      if (c.default !== undefined) {
        const v = c.default;
        def =
          " DEFAULT " +
          (is(v, SQL)
            ? dialect.sqlToQuery(v).sql
            : typeof v === "string"
              ? `'${v.replaceAll("'", "''")}'`
              : typeof v === "object"
                ? `'${JSON.stringify(v)}'`
                : JSON.stringify(v));
      }
      return `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${def}`;
    });
    await pg.exec(`CREATE TABLE "${table.name}" (${columns.join(",")})`);
  }
}
async function property(address) {
  return (
    await db
      .insert(schema.properties)
      .values({
        customerId: id(),
        address,
        bedCount: 1,
        bathCount: "1",
        laundryType: "none",
      })
      .returning()
  )[0];
}
async function job(p) {
  return (
    await db
      .insert(schema.jobs)
      .values({
        propertyId: p.id,
        calendarEventUid: id(),
        checkInTime: new Date("2026-11-01T15:00:00Z"),
        status: "completed",
      })
      .returning()
  )[0];
}
async function request(p, j, extra = {}) {
  return (
    await db
      .insert(schema.restockRequests)
      .values({
        propertyId: p.id,
        jobId: j?.id ?? null,
        item: "Water",
        quantity: 7,
        ...extra,
      })
      .returning()
  )[0];
}
const get = (params) =>
  api.GET(
    new NextRequest(
      "https://app.invalid/api/admin/restocking?" + new URLSearchParams(params),
    ),
  );
const move = (r, status) =>
  mutation.PATCH(
    new NextRequest("https://app.invalid/api/restock-requests/" + r.id, {
      method: "PATCH",
      body: JSON.stringify({ status }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: r.id }) },
  );

(async () => {
  await setup();
  const p = await property("1510 Synthetic Street"),
    p2 = await property("Other Property"),
    j = await job(p),
    old = await job(p);
  await db.insert(schema.users).values({
    id: adminId,
    supabaseUserId: authId,
    email: "admin@example.invalid",
    role: "admin",
  });
  for (let n = 0; n < 5; n++)
    await request(p, j, { urgency: n < 3 ? "urgent" : "normal" });
  for (let n = 0; n < 3; n++) await request(p, old);
  for (let n = 0; n < 4; n++) await request(p, null);
  await request(p2, await job(p2));
  await test("13 requests count as 12/1 properties, 3 urgent, not 91 quantities", async () => {
    const r = await dal.getAdminRestockSummary();
    assert.deepEqual(r.totals, {
      openCount: 13,
      propertyCount: 2,
      urgentCount: 3,
      totalCount: 13,
    });
    assert.deepEqual(
      r.properties.map((p) => p.openCount),
      [12, 1],
    );
  });
  await test("job scope shows only its five reports; completed job does not close requests", async () => {
    const r = await dal.getAdminRestockDetails({ jobId: j.id });
    assert.equal(r.openCount, 5);
    assert.equal(r.requests.length, 5);
    assert.ok(r.requests.every((r) => r.jobId === j.id));
  });
  await test("job list counts are opt-in, admin-only and not multiplied by joins", async () => {
    const admin = await jobQueries.getJobsWithDetails({
      includeRestockCounts: true,
    });
    assert.equal(admin.data.find((row) => row.id === j.id).openRestockCount, 5);
    const ordinary = await jobQueries.getJobsWithDetails({});
    assert.ok(ordinary.data.every((row) => !("openRestockCount" in row)));
    const owner = await jobQueries.getJobsWithDetails({
      customerId: p.customerId,
      includeRestockCounts: true,
    });
    assert.ok(owner.data.every((row) => !("openRestockCount" in row)));
    const calendar = await jobQueries.getJobsForCalendar({
      startDate: new Date("2026-11-01"),
      endDate: new Date("2026-11-02"),
    });
    assert.equal(
      Object.values(calendar)
        .flat()
        .find((row) => row.id === j.id).openRestockCount,
      5,
    );
  });
  await test("null jobs and repeated item reports are retained", async () => {
    const r = await dal.getAdminRestockDetails({ propertyId: p.id });
    assert.equal(r.requests.filter((r) => r.jobId === null).length, 4);
    assert.equal(r.requests.length, 12);
  });
  await test("anonymous/customer/cleaner denials occur before data reads", async () => {
    allowed = false;
    const before = queryCount;
    for (const fn of [
      () => dal.getAdminRestockSummary(),
      () => dal.getAdminRestockDetails({ propertyId: p.id }),
      () => dal.getAdminRestockProperty(p.id),
      () => dal.getAdminRestockCounts({ propertyId: p.id }),
    ])
      await assert.rejects(fn, (e) => e.status === 401);
    assert.equal((await get({ propertyId: p.id })).status, 401);
    assert.equal(queryCount, before);
    allowed = true;
  });
  await test("shared slug SSR pages deny before fetching any request or property data", async () => {
    const summaryPage =
      require("../app/(dashboard)/[slug]/restocking/page.tsx").default;
    const detailPage =
      require("../app/(dashboard)/[slug]/restocking/[propertyId]/page.tsx").default;
    allowed = false;
    const before = queryCount;
    await assert.rejects(
      () => summaryPage({ params: Promise.resolve({ slug: "customer" }) }),
      (e) => String(e.digest).startsWith("NEXT_REDIRECT"),
    );
    await assert.rejects(
      () =>
        detailPage({
          params: Promise.resolve({ slug: "admin", propertyId: p.id }),
          searchParams: Promise.resolve({}),
        }),
      (e) => String(e.digest).startsWith("NEXT_REDIRECT"),
    );
    assert.equal(queryCount, before);
    allowed = true;
  });
  await test("malformed identifiers, conflicting scopes and unbounded pages rejected", async () => {
    for (const q of [
      { propertyId: "bad" },
      { jobId: j.id, propertyId: p.id },
      { page: "0" },
      { page: "501" },
      { includeResolved: "yes" },
      { query: "x".repeat(121) },
      { propertyId: p.id, cursor: "bad" },
    ])
      assert.equal((await get(q)).status, 400);
  });
  await test("status changes stay open through ordered and decrease only on fulfillment", async () => {
    const r = (await dal.getAdminRestockDetails({ jobId: j.id })).requests[0];
    for (const status of ["approved", "ordered"]) {
      assert.equal((await move(r, status)).status, 200);
      assert.equal(
        (await dal.getAdminRestockCounts({ jobId: j.id })).openCount,
        5,
      );
    }
    assert.equal((await move(r, "fulfilled")).status, 200);
    assert.equal(
      (await dal.getAdminRestockCounts({ jobId: j.id })).openCount,
      4,
    );
    const before = (
      await db
        .select()
        .from(schema.restockRequests)
        .where(eq(schema.restockRequests.id, r.id))
    )[0];
    assert.ok(before.resolvedAt);
    assert.equal(before.resolvedByUserId, adminId);
    assert.equal((await move(r, "fulfilled")).status, 200);
    assert.equal(
      (
        await db
          .select()
          .from(schema.restockRequests)
          .where(eq(schema.restockRequests.id, r.id))
      )[0].resolvedAt.toISOString(),
      before.resolvedAt.toISOString(),
    );
    assert.equal((await move(r, "approved")).status, 409);
  });
  await test("declined -> reopen clears resolution and restores counts", async () => {
    const r = (await dal.getAdminRestockDetails({ jobId: j.id })).requests[0];
    await move(r, "declined");
    assert.equal(
      (await dal.getAdminRestockCounts({ jobId: j.id })).openCount,
      3,
    );
    await move(r, "requested");
    const [row] = await db
      .select()
      .from(schema.restockRequests)
      .where(eq(schema.restockRequests.id, r.id));
    assert.equal(row.resolvedAt, null);
    assert.equal(row.resolvedByUserId, null);
    assert.equal(
      (await dal.getAdminRestockCounts({ jobId: j.id })).openCount,
      4,
    );
  });
  await test("counts DTO contains no notes or request payload", async () => {
    const r = await get({ propertyId: p.id, countsOnly: "1" });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(await r.json()).sort(), [
      "openCount",
      "totalCount",
    ]);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  });
  await test("fulfilled requests remain addressable from focused alert regardless of filter", async () => {
    const [closed] = await db
      .select()
      .from(schema.restockRequests)
      .where(eq(schema.restockRequests.status, "fulfilled"));
    const r = await dal.getAdminRestockDetails({
      propertyId: p.id,
      requestId: closed.id,
    });
    assert.equal(r.focusedRequest.id, closed.id);
    assert.ok(!r.requests.some((r) => r.id === closed.id));
    assert.equal(
      (
        await dal.getAdminRestockDetails({
          propertyId: p2.id,
          requestId: closed.id,
        })
      ).focusedRequest,
      null,
    );
  });
  await test("all-resolved properties hidden by default and searchable in history", async () => {
    const resolved = await property("History-only Property");
    await request(resolved, null, { status: "fulfilled" });
    assert.equal(
      (await dal.getAdminRestockSummary({ query: "History-only" })).properties
        .length,
      0,
    );
    assert.equal(
      (
        await dal.getAdminRestockSummary({
          query: "History-only",
          includeResolved: true,
        })
      ).properties[0].openCount,
      0,
    );
    assert.equal(
      (await dal.getAdminRestockSummary({ query: "%" })).properties.length,
      0,
    );
  });
  await test("keyset pagination preserves microseconds and ties without missing/duplicated rows", async () => {
    const paged = await property("Pagination Property");
    for (let n = 0; n < 45; n++) {
      const r = await request(paged, null);
      await pg.query(
        "update restock_requests set created_at=$1::timestamptz where id=$2",
        [
          `2026-11-01T15:00:00.${String(100001 + (n % 4)).padStart(6, "0")}Z`,
          r.id,
        ],
      );
    }
    const ids = [];
    let cursor;
    do {
      const r = await dal.getAdminRestockDetails({
        propertyId: paged.id,
        cursor,
      });
      ids.push(...r.requests.map((r) => r.id));
      cursor = r.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(ids.length, 45);
    assert.equal(new Set(ids).size, 45);
  });
  await test("property summaries have deterministic pagination with tied activity", async () => {
    for (let n = 0; n < 23; n++) {
      const prop = await property("Page " + n);
      await request(prop, null, {
        createdAt: new Date("2026-11-01T15:00:00Z"),
      });
    }
    const a = await dal.getAdminRestockSummary({ query: "Page " }),
      b = await dal.getAdminRestockSummary({ query: "Page ", page: 2 });
    assert.equal(a.properties.length, 20);
    assert.equal(a.hasMore, true);
    assert.equal(b.properties.length, 3);
    assert.equal(
      new Set([...a.properties, ...b.properties].map((p) => p.propertyId)).size,
      23,
    );
  });
  await test("legacy notification resolves property via job without mutating history", async () => {
    const [alert] = await db
      .insert(schema.notifications)
      .values({
        userId: adminId,
        type: "urgent_job",
        title: "Restock request",
        message: "synthetic",
        jobId: j.id,
        metadata: { source: "restock_request" },
      })
      .returning();
    const r = await notifications.getUserNotificationsBySupabaseId(authId);
    assert.equal(
      r.notifications.find((n) => n.id === alert.id).url,
      "/admin/restocking/" + p.id,
    );
    assert.deepEqual(
      (
        await db
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.id, alert.id))
      )[0].metadata,
      { source: "restock_request" },
    );
    assert.equal(
      destinations.adminNotificationUrl({
        type: "urgent_job",
        metadata: { source: "restock_request" },
      }),
      "/admin/restocking",
    );
  });
  await test("new cleaner request persists before targeted admin alert; no workflow states changed", async () => {
    const cleaner = (
      await db
        .insert(schema.cleaners)
        .values({
          email: "cleaner@example.invalid",
          fullName: "Synthetic Cleaner",
        })
        .returning()
    )[0];
    const result = await writer.createRestockRequestForJob({
      cleanerId: cleaner.id,
      jobId: j.id,
      item: "Firewood",
      quantity: 7,
      urgency: "normal",
    });
    assert.equal(result.success, true);
    const [alert] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.jobId, j.id))
      .orderBy(require("drizzle-orm").desc(schema.notifications.createdAt));
    assert.equal(alert.metadata.requestId, result.id);
    assert.equal(alert.metadata.propertyId, p.id);
    assert.equal(
      alert.metadata.url,
      `/admin/restocking/${p.id}?requestId=${result.id}`,
    );
    assert.equal(
      (
        await db
          .select({ status: schema.jobs.status })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, j.id))
      )[0].status,
      "completed",
    );
  });
  await test("safe notification destinations reject hostile IDs and preserve unrelated fallbacks", async () => {
    assert.equal(
      destinations.adminNotificationUrl({
        type: "urgent_job",
        metadata: {
          source: "restock_request",
          propertyId: "https://evil.invalid",
        },
      }),
      "/admin/restocking",
    );
    assert.equal(
      destinations.adminNotificationUrl({ type: "swap_requested" }),
      "/admin/job-oversight?view=swaps",
    );
    assert.equal(
      destinations.adminNotificationUrl({ type: "urgent_job", jobId: j.id }),
      "/admin/job-oversight/" + j.id,
    );
  });
  const [originUser] = await db
    .insert(schema.users)
    .values({
      supabaseUserId: id(),
      email: "origin@example.invalid",
      role: "cleaner",
    })
    .returning();
  const [otherUser] = await db
    .insert(schema.users)
    .values({
      supabaseUserId: id(),
      email: "other@example.invalid",
      role: "cleaner",
    })
    .returning();
  const [origin] = await db
    .insert(schema.cleaners)
    .values({
      userId: originUser.id,
      email: originUser.email,
      fullName: "Submitting Cleaner",
    })
    .returning();
  const [otherCleaner] = await db
    .insert(schema.cleaners)
    .values({
      userId: otherUser.id,
      email: otherUser.email,
      fullName: "Other Cleaner",
    })
    .returning();
  const statusRows = async (requestId) =>
    (await db.select().from(schema.notifications)).filter(
      (n) =>
        n.metadata?.source === "restock_status" &&
        n.metadata.requestId === requestId,
    );
  await test("all admin statuses notify only the original submitting cleaner, with working targets", async () => {
    const r = await request(p, j, { cleanerId: origin.id });
    for (const status of ["approved", "ordered", "fulfilled"]) {
      const response = await move(r, status);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).notificationStatus, "recorded");
    }
    const rows = await statusRows(r.id);
    assert.equal(rows.length, 3);
    for (const n of rows) {
      assert.equal(n.userId, originUser.id);
      assert.equal(n.metadata.url, `/cleaner/restocking?requestId=${r.id}`);
      assert.ok(n.message.includes("7 × Water"));
      assert.ok(!n.isRead);
    }
    assert.equal(
      pushEvents.slice(-3).every((e) => e[0] === origin.id),
      true,
    );
    const inbox = await cleanerNotifications.getCleanerNotifications(origin.id);
    assert.equal(inbox.unreadCount, 3);
    assert.ok(
      inbox.notifications.every(
        (n) => n.url === `/cleaner/restocking?requestId=${r.id}`,
      ),
    );
    assert.equal(
      (await cleanerNotifications.getCleanerNotifications(otherCleaner.id))
        .unreadCount,
      0,
    );
    await move(r, "fulfilled");
    assert.equal((await statusRows(r.id)).length, 3);
  });
  await test("decline/reopen and missing source jobs still notify; internal notes never enter messages", async () => {
    const r = await request(p, null, {
      cleanerId: origin.id,
      adminNotes: "PRIVATE OFFICE NOTE",
    });
    await move(r, "declined");
    await move(r, "requested");
    const rows = await statusRows(r.id);
    assert.equal(rows.length, 2);
    assert.ok(rows.some((n) => n.title.includes("reopened")));
    assert.ok(
      rows.every(
        (n) => n.jobId === null && !n.message.includes("PRIVATE OFFICE NOTE"),
      ),
    );
    await writer.updateRestockRequestStatus({
      id: r.id,
      status: "requested",
      adminNotes: "Changed private note",
    });
    assert.equal((await statusRows(r.id)).length, 2);
  });
  await test("inbox failure rolls status back; retry produces exactly one cleaner alert", async () => {
    const r = await request(p, j, { cleanerId: origin.id });
    await pg.exec(
      `CREATE FUNCTION fixture_fail_restock_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.metadata->>'source'='restock_status' THEN RAISE EXCEPTION 'Synthetic inbox unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_notice_failure BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fixture_fail_restock_notice();`,
    );
    const response = await move(r, "approved");
    assert.equal(response.status, 500);
    assert.equal(
      (
        await db
          .select()
          .from(schema.restockRequests)
          .where(eq(schema.restockRequests.id, r.id))
      )[0].status,
      "requested",
    );
    assert.equal((await statusRows(r.id)).length, 0);
    await pg.exec(
      "DROP TRIGGER fixture_notice_failure ON notifications; DROP FUNCTION fixture_fail_restock_notice();",
    );
    assert.equal((await move(r, "approved")).status, 200);
    assert.equal((await statusRows(r.id)).length, 1);
  });
  await test("external push failure preserves committed status/inbox; unchanged retries do not duplicate", async () => {
    const r = await request(p, j, { cleanerId: origin.id });
    pushFails = true;
    assert.equal((await move(r, "approved")).status, 200);
    assert.equal((await statusRows(r.id)).length, 1);
    pushFails = false;
    await move(r, "approved");
    assert.equal((await statusRows(r.id)).length, 1);
  });
  await test("unlinked/deleted cleaner is explicit and does not notify another assignee", async () => {
    const r = await request(p, j);
    const before = (await db.select().from(schema.notifications)).length;
    const response = await move(r, "approved");
    assert.equal((await response.json()).notificationStatus, "unavailable");
    assert.equal((await db.select().from(schema.notifications)).length, before);
  });
  await test("cleaner request API stays recipient-scoped and strips internal office notes", async () => {
    sessionCleanerId = origin.id;
    const response = await cleanerRequestsApi.GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const rows = (await response.json()).requests;
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => !("adminNotes" in r) && !("cleanerId" in r)));
    sessionCleanerId = otherCleaner.id;
    assert.equal(
      (await (await cleanerRequestsApi.GET()).json()).requests.length,
      0,
    );
    sessionCleanerId = null;
    const before = queryCount;
    assert.equal((await cleanerRequestsApi.GET()).status, 401);
    assert.equal(queryCount, before);
  });
  await test("actual cleaner submissions alert every admin with property/request IDs and unread links", async () => {
    const [superAdmin] = await db
      .insert(schema.users)
      .values({
        supabaseUserId: id(),
        email: "super@example.invalid",
        role: "super_admin",
      })
      .returning();
    const result = await writer.createRestockRequestForJob({
      cleanerId: origin.id,
      jobId: j.id,
      item: "Supply notification test",
      quantity: 2,
      urgency: "urgent",
    });
    assert.equal(result.adminNotificationRecorded, true);
    const rows = (await db.select().from(schema.notifications)).filter(
      (n) => n.metadata?.requestId === result.id,
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(
      new Set(rows.map((n) => n.userId)),
      new Set([adminId, superAdmin.id]),
    );
    assert.ok(
      rows.every(
        (n) =>
          !n.isRead &&
          n.metadata.url === `/admin/restocking/${p.id}?requestId=${result.id}`,
      ),
    );
  });
  await test("failed admin alert preserves the cleaner request and reports unconfirmed notification", async () => {
    await pg.exec(
      `CREATE FUNCTION fixture_fail_admin_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.metadata->>'source'='restock_request' THEN RAISE EXCEPTION 'Synthetic admin inbox unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_admin_notice_failure BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fixture_fail_admin_notice();`,
    );
    const result = await writer.createRestockRequestForJob({
      cleanerId: origin.id,
      jobId: j.id,
      item: "Retained despite alert failure",
      quantity: 1,
      urgency: "normal",
    });
    assert.equal(result.success, true);
    assert.equal(result.adminNotificationRecorded, false);
    assert.equal(
      (
        await db
          .select()
          .from(schema.restockRequests)
          .where(eq(schema.restockRequests.id, result.id))
      ).length,
      1,
    );
    await pg.exec(
      "DROP TRIGGER fixture_admin_notice_failure ON notifications; DROP FUNCTION fixture_fail_admin_notice();",
    );
  });
  await test("cleaner restock targets reject hostile IDs, and mark-read stays in the recipient inbox", async () => {
    assert.equal(
      destinations.cleanerNotificationUrl({
        type: "urgent_job",
        metadata: {
          source: "restock_status",
          requestId: "javascript:alert(1)",
          url: "/admin/restocking",
        },
      }),
      "/cleaner/restocking",
    );
    await cleanerNotifications.markAllNotificationsRead(otherCleaner.id);
    assert.ok(
      (await cleanerNotifications.getCleanerNotifications(origin.id))
        .unreadCount > 0,
    );
    await cleanerNotifications.markAllNotificationsRead(origin.id);
    assert.equal(
      (await cleanerNotifications.getCleanerNotifications(origin.id))
        .unreadCount,
      0,
    );
  });
  console.log(JSON.stringify({ passed, failed: 0, isolatedPostgres: true }));
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pg.close());
