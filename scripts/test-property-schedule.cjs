// In-process PostgreSQL fixtures; external services are replaced below.
process.env.TSX_TSCONFIG_PATH = require("node:path").join(
  __dirname,
  "../tsconfig.json",
);
process.env.DATABASE_URL =
  "postgres://isolated:isolated@127.0.0.1:1/no_network";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.co";
delete process.env.JOB_EXECUTION_SCHEMA_READY;
delete process.env.JOB_EXECUTION_ENROLLMENT;
delete process.env.PROPERTY_SCHEDULE_UPDATES_READY;
require("tsx/cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite"),
  { drizzle } = require("drizzle-orm/pglite");
const {
  PgTable,
  PgDialect,
  getTableConfig,
  isPgEnum,
} = require("drizzle-orm/pg-core");
const { is, SQL, eq, and } = require("drizzle-orm");
const Module = require("node:module"),
  originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  return originalLoad.call(this, name, ...args);
};
const root = path.resolve(__dirname, "..");
function replace(file, exports) {
  const key = require.resolve(path.join(root, file));
  require.cache[key] = { id: key, filename: key, loaded: true, exports };
}
const schema = require("../db/schema.ts"),
  pg = new PGlite(),
  db = drizzle(pg, { schema });
replace("db/index.ts", { db, schema });
let pushCount = 0,
  pushFails = false,
  admin = true;
replace("lib/services/push.service.ts", {
  sendPushToCleaner: async () => {
    if (pushFails) throw Error("Synthetic push failure");
    pushCount++;
    return 1;
  },
});
replace("lib/admin-auth.ts", {
  getAdminAuth: async () => ({
    isAdmin: admin,
    userId: "synthetic-admin",
    error: "Unauthorized",
  }),
});
replace("lib/services/google-maps/service-area-guard.ts", {
  assertAddressInServiceArea: async () => {
    throw Error("Unexpected geocoding");
  },
  serviceAreaErrorCode: () => null,
});
replace("lib/services/gps/geofence.ts", {
  evaluateGeofence: async () => ({
    verdict: "inside",
    withinGeofence: true,
    distanceMiles: 0,
    reason: "within_radius",
  }),
  evaluateArrival: (scheduled, actual) => ({
    delayMinutes: Math.round((actual - scheduled) / 60000),
    onTime: Math.round((actual - scheduled) / 60000) <= 10,
  }),
});
let feed = "",
  feedUnavailable = false;
global.fetch = async (url) => {
  assert.equal(url, "https://calendar.example.invalid/fixture.ics");
  if (feedUnavailable) throw Error("Synthetic offline feed");
  return new Response(feed, { headers: { "content-type": "text/calendar" } });
};
const service = require("../lib/services/property-schedule.ts"),
  contracts = require("../lib/services/job-execution-contract.ts");
const { updateProperty } = require("../lib/queries/properties.ts");
const recovery = require("../app/api/properties/[id]/schedule/route.ts");
const propertyApi = require("../app/api/properties/[id]/route.ts");
const policy = require("../lib/jobs/execution-policy.ts"),
  pure = require("../lib/jobs/property-schedule.ts");
const { evaluateCheckInWindow } = require("../lib/cleaner/check-in-window.ts");
const uuid = () => crypto.randomUUID();
const at = (day, time) => policy.easternInstant(day, time);
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
async function row(table, key, id) {
  return (await db.select().from(table).where(eq(key, id)))[0];
}
function ics(events) {
  return (
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" +
    events
      .map(
        ([uid, start, end, explicit]) =>
          `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART${explicit ? ":" : ";VALUE=DATE:"}${start}\r\nDTEND${explicit ? ":" : ";VALUE=DATE:"}${end}\r\nEND:VEVENT\r\n`,
      )
      .join("") +
    "END:VCALENDAR\r\n"
  );
}
async function seed(times = {}) {
  const [owner] = await db
    .insert(schema.customers)
    .values({ name: "Synthetic Owner", email: `${uuid()}@example.invalid` })
    .returning();
  const [property] = await db
    .insert(schema.properties)
    .values({
      customerId: owner.id,
      address: "Synthetic property",
      bedCount: 1,
      bathCount: "1",
      laundryType: "none",
      hasHotTub: false,
      useDefaultChecklist: true,
      iCalUrl: "https://calendar.example.invalid/fixture.ics",
      defaultCheckInTime: "16:00:00",
      defaultCheckOutTime: "09:00:00",
      ...times,
    })
    .returning();
  const [user] = await db
    .insert(schema.users)
    .values({
      supabaseUserId: uuid(),
      role: "cleaner",
      email: `${uuid()}@example.invalid`,
    })
    .returning();
  const [cleaner] = await db
    .insert(schema.cleaners)
    .values({
      fullName: "Synthetic Cleaner",
      userId: user.id,
      email: user.email,
    })
    .returning();
  return { property, cleaner, user };
}
async function job(f, extra = {}, issued = false) {
  const values = {
    propertyId: f.property.id,
    calendarEventUid: `fixture_${uuid()}`,
    status: "unassigned",
    serviceType: "vacation_rental_subscription",
    jobSource: "manual",
    checkInTime: at("2030-10-23", "09:00"),
    checkOutTime: at("2030-10-23", "16:00"),
    expectedHours: "2",
    addonsSnapshot: { laundryType: "none" },
    ...extra,
  };
  return issued
    ? (await contracts.insertIssuedJobs(db, [values]))[0]
    : (await db.insert(schema.jobs).values(values).returning())[0];
}
async function assign(f, j, role = "primary") {
  await db
    .insert(schema.jobsToCleaners)
    .values({ jobId: j.id, cleanerId: f.cleaner.id, role });
  await db
    .update(schema.jobs)
    .set({ status: "assigned" })
    .where(eq(schema.jobs.id, j.id));
}
async function setup() {
  const dialect = new PgDialect(),
    tables = new Map(),
    enums = new Map();
  for (const value of Object.values(schema)) {
    if (isPgEnum(value)) enums.set(value.enumName, value.enumValues);
    if (is(value, PgTable)) {
      const t = getTableConfig(value);
      tables.set(t.name, t);
      for (const c of t.columns)
        if (c.enum?.enumName) enums.set(c.enum.enumName, c.enum.enumValues);
    }
  }
  await pg.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  for (const [name, values] of enums)
    await pg.exec(
      `CREATE TYPE "${name}" AS ENUM (${values.map((v) => `'${v}'`).join(",")});`,
    );
  for (const t of tables.values()) {
    if (
      [
        "job_execution_contracts",
        "job_evidence_drafts",
        "evidence_upload_manifest",
        "job_operation_audit",
        "job_schedule_revisions",
        "job_schedule_notices",
      ].includes(t.name)
    )
      continue;
    const columns = t.columns.map((c) => {
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
    await pg.exec(`CREATE TABLE "${t.name}" (${columns.join(",")});`);
    for (const idx of t.indexes.filter((i) => i.config.unique)) {
      const cfg = idx.config;
      await pg.exec(
        `CREATE UNIQUE INDEX "${cfg.name}" ON "${t.name}" (${cfg.columns.map((c) => `"${c.name}"`).join(",")})${cfg.where ? " WHERE " + dialect.sqlToQuery(cfg.where).sql : ""}`,
      );
    }
  }
  await pg.exec(
    fs.readFileSync(
      path.join(
        root,
        "db/supabase/migrations/0052_prospective_job_execution.sql",
      ),
      "utf8",
    ),
  );
}
async function run() {
  await setup();
  const original = await seed(),
    old = await job(original, {
      status: "completed",
      checkInTime: at("2025-10-23", "09:00"),
      checkOutTime: at("2025-10-23", "16:00"),
    });
  await db.insert(schema.evidencePackets).values({
    jobId: old.id,
    finalEvidenceSubmittedAt: at("2025-10-23", "16:00"),
    photoUrls: ["private/historical.jpg"],
    status: "complete",
  });
  const historyBefore = JSON.stringify(
    (await pg.query("SELECT row_to_json(j) row FROM jobs j ORDER BY id")).rows,
  );
  const evidenceBefore = JSON.stringify(
    (
      await pg.query(
        "SELECT row_to_json(e) row FROM evidence_packets e ORDER BY id",
      )
    ).rows,
  );
  await test("0053 applies twice without backfill or historical rewrites", async () => {
    const migration = fs.readFileSync(
      path.join(
        root,
        "db/supabase/migrations/0053_property_schedule_revisions.sql",
      ),
      "utf8",
    );
    await pg.exec(migration);
    await pg.exec(migration);
    assert.equal(
      JSON.stringify(
        (await pg.query("SELECT row_to_json(j) row FROM jobs j ORDER BY id"))
          .rows,
      ),
      historyBefore,
    );
    assert.equal(
      JSON.stringify(
        (
          await pg.query(
            "SELECT row_to_json(e) row FROM evidence_packets e ORDER BY id",
          )
        ).rows,
      ),
      evidenceBefore,
    );
  });
  await test("audit table has RLS and no client-role grants", async () => {
    for (const table of ["job_schedule_revisions", "job_schedule_notices"])
      for (const role of ["anon", "authenticated"])
        assert.equal(
          (
            await pg.query(
              `SELECT has_table_privilege('${role}','public.${table}','SELECT,INSERT,UPDATE,DELETE') allowed`,
            )
          ).rows[0].allowed,
          false,
        );
    assert.equal(
      (
        await pg.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid='public.job_schedule_revisions'::regclass",
        )
      ).rows[0].relrowsecurity,
      true,
    );
  });
  await test("property save moves inherited manual and extra rental bookings together", async () => {
    const f = await seed(),
      a = await job(f),
      b = await job(f, {
        jobSource: "customer_one_off",
        checkInTime: at("2030-10-24", "09:00"),
        checkOutTime: at("2030-10-24", "16:00"),
      });
    const result = await updateProperty(f.property.id, {
      defaultCheckOutTime: "10:00:00",
    });
    assert.equal(result.updatedBookings, 2);
    assert.equal(
      +(await row(schema.jobs, schema.jobs.id, a.id)).checkInTime,
      +at("2030-10-23", "10:00"),
    );
    assert.equal(
      +(await row(schema.jobs, schema.jobs.id, b.id)).checkInTime,
      +at("2030-10-24", "10:00"),
    );
  });
  await test("issued schedule revises without altering original contract, key or pricing", async () => {
    const f = await seed(),
      j = await job(f, {}, true);
    await assign(f, j);
    const initial = await row(
      schema.jobExecutionContracts,
      schema.jobExecutionContracts.jobId,
      j.id,
    );
    const result = await updateProperty(
      f.property.id,
      { defaultCheckOutTime: "10:00:00", defaultCheckInTime: "17:00:00" },
      { actor: "synthetic-admin" },
    );
    assert.equal(result.updatedBookings, 1);
    assert.deepEqual(
      await row(
        schema.jobExecutionContracts,
        schema.jobExecutionContracts.jobId,
        j.id,
      ),
      initial,
    );
    const effective = await contracts.getExecutionContract(j.id),
      current = await row(schema.jobs, schema.jobs.id, j.id);
    assert.equal(
      effective.plannedStart,
      at("2030-10-23", "10:00").toISOString(),
    );
    assert.equal(
      effective.plannedDeadline,
      at("2030-10-23", "17:00").toISOString(),
    );
    assert.equal(current.calendarEventUid, j.calendarEventUid);
    assert.deepEqual(current.addonsSnapshot, j.addonsSnapshot);
    assert.equal(current.expectedHours, j.expectedHours);
    assert.equal(
      (
        await db
          .select()
          .from(schema.jobScheduleRevisions)
          .where(eq(schema.jobScheduleRevisions.jobId, j.id))
      ).length,
      1,
    );
    const notices = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.jobId, j.id));
    assert.equal(notices.length, 1);
    assert.equal(notices[0].metadata.source, "property_schedule");
    await service.sendPendingScheduleNotices();
    await service.sendPendingScheduleNotices();
    assert.equal(pushCount, 1);
    await assert.rejects(
      db
        .update(schema.jobs)
        .set({ checkInTime: at("2030-10-23", "11:00") })
        .where(eq(schema.jobs.id, j.id)),
    );
    await assert.rejects(
      db
        .update(schema.jobScheduleRevisions)
        .set({ actor: "changed" })
        .where(eq(schema.jobScheduleRevisions.jobId, j.id)),
    );
    await assert.rejects(
      db
        .update(schema.jobs)
        .set({ addonsSnapshot: { laundryType: "changed" } })
        .where(eq(schema.jobs.id, j.id)),
    );
    const noOp = await updateProperty(f.property.id, {
      defaultCheckOutTime: "10:00:00",
      defaultCheckInTime: "17:00:00",
    });
    assert.equal(noOp.updatedBookings, undefined);
  });
  await test("started jobs, submitted evidence and chosen residential windows are preserved", async () => {
    const f = await seed(),
      a = await job(f, { status: "in-progress" }),
      b = await job(f, { serviceType: "residential_one_time" }),
      c = await job(f);
    await db
      .insert(schema.evidencePackets)
      .values({ jobId: c.id, gpsCheckInTimestamp: new Date() });
    await updateProperty(f.property.id, { defaultCheckOutTime: "10:00:00" });
    for (const j of [a, b, c])
      assert.equal(
        +(await row(schema.jobs, schema.jobs.id, j.id)).checkInTime,
        +j.checkInTime,
      );
  });
  await test("historical custom times and subsequent explicit overrides are preserved", async () => {
    const f = await seed(),
      a = await job(f, { checkInTime: at("2030-10-23", "11:00") }),
      b = await job(f);
    await db
      .update(schema.jobs)
      .set({ checkInTime: at("2030-10-23", "10:00") })
      .where(eq(schema.jobs.id, b.id));
    await db
      .update(schema.jobs)
      .set({ checkInTime: at("2030-10-23", "09:00") })
      .where(eq(schema.jobs.id, b.id));
    const result = await updateProperty(f.property.id, {
      defaultCheckOutTime: "10:00:00",
    });
    assert.equal(result.updatedBookings, 0);
    assert.equal(
      +(await row(schema.jobs, schema.jobs.id, a.id)).checkInTime,
      +a.checkInTime,
    );
    assert.equal(
      +(await row(schema.jobs, schema.jobs.id, b.id)).checkInTime,
      +b.checkInTime,
    );
  });
  await test("short window rolls back property, jobs, audit and notices", async () => {
    const f = await seed(),
      j = await job(f, { expectedHours: "6" });
    await assert.rejects(
      updateProperty(f.property.id, { defaultCheckOutTime: "12:00:00" }),
      /enough cleaning time/,
    );
    assert.equal(
      (await row(schema.properties, schema.properties.id, f.property.id))
        .defaultCheckOutTime,
      "09:00:00",
    );
    assert.equal(
      +(await row(schema.jobs, schema.jobs.id, j.id)).checkInTime,
      +j.checkInTime,
    );
    assert.equal(
      (
        await db
          .select()
          .from(schema.jobScheduleRevisions)
          .where(eq(schema.jobScheduleRevisions.jobId, j.id))
      ).length,
      0,
    );
  });
  await test("assigned-cleaner overlap blocks the entire property edit", async () => {
    const f = await seed(),
      target = await job(f);
    await assign(f, target);
    const other = await seed();
    const sibling = await job(other, {
      checkInTime: at("2030-10-23", "11:00"),
      checkOutTime: at("2030-10-23", "16:00"),
    });
    await db
      .insert(schema.jobsToCleaners)
      .values({ jobId: sibling.id, cleanerId: f.cleaner.id, role: "primary" });
    await assert.rejects(
      updateProperty(f.property.id, { defaultCheckOutTime: "10:00:00" }),
      /overlap/,
    );
    assert.equal(
      (await row(schema.properties, schema.properties.id, f.property.id))
        .defaultCheckOutTime,
      "09:00:00",
    );
  });
  await test("a later assignment cannot overlap an accepted schedule revision", async () => {
    const f = await seed(),
      target = await job(f);
    await assign(f, target);
    await updateProperty(f.property.id, { defaultCheckOutTime: "10:00:00" });
    const other = await seed(),
      sibling = await job(other, {
        checkInTime: at("2030-10-23", "11:00"),
        checkOutTime: at("2030-10-23", "16:00"),
      });
    await assert.rejects(
      db.insert(schema.jobsToCleaners).values({
        jobId: sibling.id,
        cleanerId: f.cleaner.id,
        role: "primary",
      }),
    );
    await db
      .insert(schema.jobsToCleaners)
      .values({ jobId: sibling.id, cleanerId: f.cleaner.id, role: "backup" });
  });
  await test("calendar DATE jobs update using stable compatibility IDs and next-guest cutoff", async () => {
    const f = await seed();
    feed = ics([
      ["stay", "20301020", "20301023"],
      ["next", "20301023T190000Z", "20301025T130000Z", true],
    ]);
    const key = `stay_${at("2030-10-23", "09:00").toISOString()}`;
    const j = await job(f, {
      jobSource: "ical",
      calendarEventUid: key,
      checkOutTime: at("2030-10-23", "15:00"),
    });
    await updateProperty(f.property.id, {
      defaultCheckOutTime: "10:00:00",
      defaultCheckInTime: "18:00:00",
    });
    const after = await row(schema.jobs, schema.jobs.id, j.id);
    assert.equal(after.calendarEventUid, key);
    assert.equal(+after.checkInTime, +at("2030-10-23", "10:00"));
    assert.equal(+after.checkOutTime, +at("2030-10-23", "15:00"));
  });
  await test("explicit checkout clock in the calendar is preserved", async () => {
    const f = await seed();
    feed = ics([["explicit", "20301020T160000Z", "20301023T150000Z", true]]);
    const j = await job(f, {
      jobSource: "ical",
      calendarEventUid: "explicit_2030-10-23T15:00:00.000Z",
      checkInTime: at("2030-10-23", "11:00"),
    });
    const result = await updateProperty(f.property.id, {
      defaultCheckOutTime: "10:00:00",
    });
    assert.equal(result.updatedBookings, 0);
    assert.equal(
      +(await row(schema.jobs, schema.jobs.id, j.id)).checkInTime,
      +j.checkInTime,
    );
  });
  await test("already-stale calendar jobs have read-only exact preview and token-bound apply", async () => {
    const f = await seed({ defaultCheckOutTime: "10:00:00" });
    feed = ics([["stale", "20301020", "20301023"]]);
    const j = await job(f, {
      jobSource: "ical",
      calendarEventUid: `stale_${at("2030-10-23", "09:00").toISOString()}`,
    });
    const params = { params: Promise.resolve({ id: f.property.id }) };
    const call = (body) =>
      recovery.POST(
        new Request("https://app.example.invalid/api", {
          method: "POST",
          body: JSON.stringify(body),
        }),
        params,
      );
    const preview = await (await call({ action: "preview" })).json();
    assert.equal(preview.changes.length, 1);
    assert.equal(
      +(await row(schema.jobs, schema.jobs.id, j.id)).checkInTime,
      +j.checkInTime,
    );
    assert.equal(
      (await call({ action: "apply", token: "0".repeat(64) })).status,
      409,
    );
    const applied = await (
      await call({ action: "apply", token: preview.token })
    ).json();
    assert.equal(applied.updatedBookings, 1);
    assert.equal(
      (await call({ action: "apply", token: preview.token })).status,
      409,
    );
    assert.equal(
      (await (await call({ action: "preview" })).json()).changes.length,
      0,
    );
  });
  await test("offline and missing calendar events reject without partial writes", async () => {
    const f = await seed(),
      j = await job(f, { jobSource: "ical", calendarEventUid: "missing" });
    feedUnavailable = true;
    await assert.rejects(
      updateProperty(f.property.id, { defaultCheckOutTime: "10:00:00" }),
      /calendar could not be verified/,
    );
    feedUnavailable = false;
    feed = ics([]);
    await assert.rejects(
      updateProperty(f.property.id, { defaultCheckOutTime: "10:00:00" }),
      /could not be verified/,
    );
    assert.equal(
      +(await row(schema.jobs, schema.jobs.id, j.id)).checkInTime,
      +j.checkInTime,
    );
  });
  await test("a booking start after preview invalidates the whole pending save", async () => {
    const f = await seed(),
      j = await job(f),
      after = { ...f.property, defaultCheckOutTime: "10:00:00" };
    const prepared = await service.preparePropertySchedule(f.property, after);
    await db
      .update(schema.jobs)
      .set({ status: "in-progress" })
      .where(eq(schema.jobs.id, j.id));
    await assert.rejects(
      service.savePropertySchedule({
        property: f.property,
        prepared,
        patch: { defaultCheckOutTime: "10:00:00" },
        actor: "synthetic",
      }),
      /booking changed/,
    );
    assert.equal(
      (await row(schema.properties, schema.properties.id, f.property.id))
        .defaultCheckOutTime,
      "09:00:00",
    );
  });
  await test("concurrent property edits and stale calendar inserts are refused", async () => {
    const f = await seed();
    await job(f);
    const prepared = await service.preparePropertySchedule(f.property, {
      defaultCheckOutTime: "10:00:00",
    });
    await updateProperty(f.property.id, { defaultCheckOutTime: "11:00:00" });
    await assert.rejects(
      service.savePropertySchedule({
        property: f.property,
        prepared,
        patch: { defaultCheckOutTime: "10:00:00" },
        actor: "synthetic",
      }),
      /property changed/,
    );
    await assert.rejects(
      contracts.insertIssuedJobs(
        db,
        [
          {
            propertyId: f.property.id,
            calendarEventUid: uuid(),
            checkInTime: at("2030-10-25", "09:00"),
            checkOutTime: at("2030-10-25", "16:00"),
          },
        ],
        f.property,
      ),
      /Property times changed/,
    );
  });
  await test("arrival gate follows the booking, including preserved overrides", async () => {
    const scheduled = at("2030-10-23", "11:00");
    const result = evaluateCheckInWindow({
      scheduledCheckIn: scheduled,
      propertyCheckOutTime: "10:00:00",
      now: at("2030-10-23", "10:30"),
    });
    assert.equal(result.isEarly, true);
    assert.equal(+result.opensAt, +scheduled);
  });
  await test("old reminder receipts retain their original schedule on reschedule", async () => {
    const f = await seed(),
      j = await job(f);
    await assign(f, j);
    await db.insert(schema.notifications).values({
      userId: f.user.id,
      jobId: j.id,
      type: "job_reminder",
      title: "old",
      message: "old",
      metadata: { source: "notify" },
    });
    await updateProperty(f.property.id, { defaultCheckOutTime: "10:00:00" });
    const [receipt] = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.jobId, j.id),
          eq(schema.notifications.type, "job_reminder"),
        ),
      );
    assert.equal(receipt.metadata.scheduleStart, j.checkInTime.toISOString());
    assert.equal(receipt.message, "old");
  });
  await test("admin API enforces roles and strict input without readiness settings", async () => {
    const f = await seed(),
      params = { params: Promise.resolve({ id: f.property.id }) };
    admin = false;
    assert.equal(
      (
        await recovery.POST(
          new Request("https://app.example.invalid/api", {
            method: "POST",
            body: '{"action":"preview"}',
          }),
          params,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await propertyApi.PATCH(
          new Request("https://app.example.invalid/api", {
            method: "PATCH",
            body: '{"defaultCheckOutTime":"10:00"}',
          }),
          params,
        )
      ).status,
      401,
    );
    admin = true;
    assert.equal(
      (
        await recovery.POST(
          new Request("https://app.example.invalid/api", {
            method: "POST",
            body: '{"action":"apply","token":"bad"}',
          }),
          params,
        )
      ).status,
      400,
    );
    await updateProperty(f.property.id, { sqFt: 1000 });
    const response = await propertyApi.PATCH(
      new Request("https://app.example.invalid/api", {
        method: "PATCH",
        body: '{"defaultCheckOutTime":"10:00"}',
      }),
      params,
    );
    assert.equal(response.status, 200);
    assert.equal(
      (await row(schema.properties, schema.properties.id, f.property.id))
        .defaultCheckOutTime,
      "10:00:00",
    );
  });
  await test("obsolete execution settings cannot disable schedules, issued readers or notices", async () => {
    process.env.JOB_EXECUTION_SCHEMA_READY = "false";
    process.env.PROPERTY_SCHEDULE_UPDATES_READY = "false";
    process.env.JOB_EXECUTION_ENROLLMENT = "false";
    try {
      const f = await seed();
      const j = await job(f, {}, true);
      await assign(f, j);
      const result = await updateProperty(f.property.id, {
        defaultCheckOutTime: "10:00:00",
      });
      assert.equal(result.updatedBookings, 1);
      assert.equal(
        (await contracts.getExecutionContract(j.id)).plannedStart,
        at("2030-10-23", "10:00").toISOString(),
      );
      const previousPushes = pushCount;
      await service.sendPendingScheduleNotices();
      assert.ok(pushCount > previousPushes);
      const notice = await row(
        schema.jobScheduleNotices,
        schema.jobScheduleNotices.cleanerId,
        f.cleaner.id,
      );
      assert.ok(notice.sentAt);
    } finally {
      delete process.env.JOB_EXECUTION_SCHEMA_READY;
      delete process.env.PROPERTY_SCHEDULE_UPDATES_READY;
      delete process.env.JOB_EXECUTION_ENROLLMENT;
    }
  });
  await test("DST gaps/folds and invalid proposed dates are refused by the actual planner", async () => {
    for (const [day, clock] of [
      ["2027-03-14", "02:30"],
      ["2026-11-01", "01:30"],
    ]) {
      const candidate = {
        id: uuid(),
        status: "unassigned",
        serviceType: "vacation_rental_subscription",
        jobSource: "manual",
        calendarEventUid: uuid(),
        checkInTime: at(day, "09:00"),
        checkOutTime: at(day, "16:00"),
        expectedHours: "2",
        hasEvidence: false,
      };
      assert.throws(() =>
        pure.planPropertySchedules({
          before: {},
          after: { defaultCheckOutTime: clock },
          jobs: [candidate],
          calendar: new Map(),
          overrides: new Set(),
          now: new Date("2026-01-01T00:00Z"),
        }),
      );
    }
  });
  await test("calendar sync issues new jobs without environment gates and keeps rescheduled IDs", async () => {
    const f = await seed({ defaultCheckOutTime: "10:00:00" });
    feed = ics([["new-sync", "20301020", "20301023"]]);
    const [subscription] = await db
      .insert(schema.subscriptions)
      .values({
        propertyId: f.property.id,
        customerId: f.property.customerId,
        durationMonths: 1,
        status: "active",
        startDate: "2030-01-01",
        endDate: "2030-12-31",
      })
      .returning();
    const { ICalService } = require("../lib/services/iCal/ical.service.ts");
    const sync = new ICalService(db);
    await sync.syncCalendar({ subscriptionId: subscription.id });
    let rows = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.propertyId, f.property.id));
    assert.equal(rows.length, 1);
    assert.equal(+rows[0].checkInTime, +at("2030-10-23", "10:00"));
    assert.equal(
      (await contracts.getExecutionContract(rows[0].id)).plannedStart,
      at("2030-10-23", "10:00").toISOString(),
    );
    await updateProperty(f.property.id, { defaultCheckOutTime: "11:00:00" });
    await sync.syncCalendar({ subscriptionId: subscription.id });
    rows = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.propertyId, f.property.id));
    assert.equal(rows.length, 1);
    assert.equal(+rows[0].checkInTime, +at("2030-10-23", "11:00"));
    assert.equal(
      (await contracts.getExecutionContract(rows[0].id)).plannedStart,
      at("2030-10-23", "11:00").toISOString(),
    );
  });
  await test("legacy calendar cancellation still archives its job and retains schedule audit", async () => {
    const f = await seed();
    const [subscription] = await db
      .insert(schema.subscriptions)
      .values({
        propertyId: f.property.id,
        customerId: f.property.customerId,
        durationMonths: 1,
        status: "active",
        startDate: "2030-01-01",
        endDate: "2030-12-31",
      })
      .returning();
    const j = await job(f, { subscriptionId: subscription.id });
    await updateProperty(f.property.id, { defaultCheckOutTime: "10:00:00" });
    const {
      CancellationDetectionService,
    } = require("../lib/services/cancellation-detection/cancellationDetection.service.ts");
    await new CancellationDetectionService(db)._processSingleCancellation(
      await row(schema.jobs, schema.jobs.id, j.id),
    );
    assert.equal(await row(schema.jobs, schema.jobs.id, j.id), undefined);
    assert.equal(
      (
        await row(
          schema.jobScheduleRevisions,
          schema.jobScheduleRevisions.jobId,
          j.id,
        )
      ).source,
      "property_defaults",
    );
    assert.equal(
      +(
        await row(
          schema.cancelledJobs,
          schema.cancelledJobs.originalJobId,
          j.id,
        )
      ).checkInTime,
      +at("2030-10-23", "10:00"),
    );
  });
  await test("a failed push remains in the private queue and retry cannot read forged notification metadata", async () => {
    const f = await seed(),
      j = await job(f);
    await assign(f, j);
    await updateProperty(f.property.id, { defaultCheckOutTime: "10:00:00" });
    const [notice] = await db
      .select()
      .from(schema.jobScheduleNotices)
      .where(eq(schema.jobScheduleNotices.cleanerId, f.cleaner.id));
    assert.equal(notice.sentAt, null);
    await db
      .update(schema.notifications)
      .set({
        metadata: {
          source: "property_schedule",
          cleanerId: uuid(),
          pushPending: true,
          pushClaimedAt: "invalid",
        },
      })
      .where(eq(schema.notifications.userId, f.user.id));
    const prior = pushCount;
    pushFails = true;
    await service.sendPendingScheduleNotices();
    pushFails = false;
    assert.equal(
      (
        await row(
          schema.jobScheduleNotices,
          schema.jobScheduleNotices.id,
          notice.id,
        )
      ).sentAt,
      null,
    );
    await db
      .update(schema.jobScheduleNotices)
      .set({ claimedAt: new Date(Date.now() - 6 * 60000) })
      .where(eq(schema.jobScheduleNotices.id, notice.id));
    await service.sendPendingScheduleNotices();
    assert.ok(pushCount > prior);
    assert.ok(
      (
        await row(
          schema.jobScheduleNotices,
          schema.jobScheduleNotices.id,
          notice.id,
        )
      ).sentAt,
    );
  });
  await test("real issued arrival uses revised start and a subsequent home edit preserves the started visit", async () => {
    const NativeDate = global.Date;
    let clock = +at("2030-10-23", "08:00");
    global.Date = class extends NativeDate {
      constructor(...args) {
        if (args.length) super(...args);
        else super(clock);
      }
      static now() {
        return clock;
      }
    };
    try {
      const f = await seed(),
        j = await job(f, {}, true);
      await assign(f, j);
      await updateProperty(f.property.id, { defaultCheckOutTime: "10:00:00" });
      clock = +at("2030-10-23", "10:20");
      const {
        recordExecutionVisit,
      } = require("../lib/services/job-execution.ts");
      await recordExecutionVisit(j.id, f.cleaner.id, "arrival", null);
      const packet = await row(
        schema.evidencePackets,
        schema.evidencePackets.jobId,
        j.id,
      );
      assert.equal(packet.arrivalDelayMinutes, 20);
      await updateProperty(f.property.id, { defaultCheckOutTime: "11:00:00" });
      assert.equal(
        (await contracts.getExecutionContract(j.id)).plannedStart,
        at("2030-10-23", "10:00").toISOString(),
      );
      assert.equal(
        +(await row(schema.evidencePackets, schema.evidencePackets.jobId, j.id))
          .gpsCheckInTimestamp,
        +packet.gpsCheckInTimestamp,
      );
    } finally {
      global.Date = NativeDate;
    }
  });
  await test("the real reminder service sends once for the revised start despite an old reminder", async () => {
    replace("lib/services/notifications/notify.ts", {
      notifyCleaner: async (input) => {
        const cleaner = await row(
          schema.cleaners,
          schema.cleaners.id,
          input.cleanerId,
        );
        await db.insert(schema.notifications).values({
          userId: cleaner.userId,
          jobId: input.jobId,
          type: input.type,
          title: input.title,
          message: input.message,
          metadata: { ...input.metadata, source: "notify" },
        });
      },
    });
    const {
      sendUpcomingJobReminders,
    } = require("../lib/services/notifications/reminders.service.ts");
    const f = await seed(),
      j = await job(f, {
        checkInTime: at("2033-10-23", "09:00"),
        checkOutTime: at("2033-10-23", "16:00"),
      });
    await assign(f, j);
    await db.insert(schema.notifications).values({
      userId: f.user.id,
      jobId: j.id,
      type: "job_reminder",
      title: "old",
      message: "old",
      metadata: { source: "notify" },
    });
    await updateProperty(f.property.id, { defaultCheckOutTime: "10:00:00" });
    assert.equal(
      (await sendUpcomingJobReminders(at("2033-10-23", "09:30"))).reminded,
      1,
    );
    assert.equal(
      (await sendUpcomingJobReminders(at("2033-10-23", "09:30"))).reminded,
      0,
    );
  });
  await test("an impossible property window is rejected even without upcoming bookings", async () => {
    const f = await seed();
    await assert.rejects(
      updateProperty(f.property.id, { defaultCheckOutTime: "17:00:00" }),
      /later than guest check-out/,
    );
    assert.equal(
      (await row(schema.properties, schema.properties.id, f.property.id))
        .defaultCheckOutTime,
      "09:00:00",
    );
  });
  console.log(`${passed} property schedule cases passed.`);
}
run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pg.close());
