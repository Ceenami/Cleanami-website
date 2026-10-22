// In-process PostgreSQL regression suite. No network, Auth, Storage or Stripe integration claim.
// Never loads a root env file and never constructs a postgres.js network client.
process.env.TSX_TSCONFIG_PATH = require("node:path").join(
  __dirname,
  "../tsconfig.json",
);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.co";
process.env.DATABASE_URL =
  "postgres://isolated:isolated@127.0.0.1:1/no_network";
process.env.JOB_EXECUTION_SCHEMA_READY = "true";
process.env.JOB_EXECUTION_ENROLLMENT = "true";
require("tsx/cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const { drizzle } = require("drizzle-orm/pglite");
const {
  PgTable,
  PgDialect,
  getTableConfig,
  isPgEnum,
} = require("drizzle-orm/pg-core");
const { is, SQL, eq } = require("drizzle-orm");
const root = path.resolve(__dirname, "..");
function replace(file, exports) {
  const key = require.resolve(path.join(root, file));
  require.cache[key] = { id: key, filename: key, loaded: true, exports };
}
// server-only's default Node export throws; route tests load server modules deliberately.
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  return originalLoad.call(this, name, ...args);
};
const schema = require("../db/schema.ts");
const pg = new PGlite();
const db = drizzle(pg, { schema });
replace("db/index.ts", { db, schema });
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
let media = new Map(),
  previewFails = false,
  providers = 0;
replace("lib/supabase/server.ts", {
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async (p) => ({
          data: { token: "synthetic-token", path: p },
        }),
        download: async (p) => ({
          data: media.has(p) ? new Blob([media.get(p)]) : null,
          error: media.has(p) ? null : { message: "missing" },
        }),
      }),
    },
  }),
});
replace("lib/storage/signed-url.ts", {
  EVIDENCE_BUCKET: "evidence-photos",
  CHECKLISTS_BUCKET: "checklists",
  createSignedUrl: async (p) =>
    previewFails ? null : `https://preview.invalid/${p}`,
});
replace("lib/services/payment/reserve.ts", {
  computeReserveRate: async () => 0.02,
});
replace("lib/stripe/get-stripe.ts", {
  getStripe: () => ({
    paymentIntents: {
      retrieve: async () => {
        providers++;
        return {
          status: "succeeded", amount_received: 10000,
          latest_charge: { amount: 10000, amount_refunded: 10000 },
        };
      },
      capture: async () => {
        throw Error("Unexpected capture");
      },
    },
  }),
});
replace("lib/services/payment/execution-notices.ts", { sendExecutionNotice: async () => undefined });
const contracts = require("../lib/services/job-execution-contract.ts");
const service = require("../lib/services/job-execution.ts");
const settlement = require("../lib/services/payment/execution-settlement.ts");
const cancellation = require("../lib/services/payment/execution-cancellation.ts");
const policy = require("../lib/jobs/execution-policy.ts");
const { computeCleanerPay } = require("../lib/pricing/cleaner-pay.ts");
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
const uuid = () => crypto.randomUUID();
async function seed() {
  const [user] = await db
    .insert(schema.users)
    .values({
      supabaseUserId: uuid(),
      email: `${uuid()}@example.invalid`,
      role: "cleaner",
    })
    .returning();
  const [cleaner] = await db
    .insert(schema.cleaners)
    .values({
      userId: user.id,
      fullName: "Synthetic Cleaner",
      phone: "5550000000",
      email: `${uuid()}@example.invalid`,
      onCallStatus: "available",
    })
    .returning();
  const [customer] = await db
    .insert(schema.customers)
    .values({
      name: "Synthetic Owner",
      email: `${uuid()}@example.invalid`,
      phone: "5550000001",
    })
    .returning();
  const [property] = await db
    .insert(schema.properties)
    .values({
      customerId: customer.id,
      address: "Synthetic test property",
      bedCount: 0,
      bathCount: "0",
      laundryType: "none",
      hasHotTub: false,
      defaultCheckOutTime: "10:00:00",
      defaultCheckInTime: "16:00:00",
      useDefaultChecklist: true,
    })
    .returning();
  return { cleaner, property };
}
async function make(f, extra = {}) {
  const [job] = await contracts.insertIssuedJobs(db, [
    {
      propertyId: f.property.id,
      checkInTime: new Date(Date.now() - 60000),
      checkOutTime: new Date(Date.now() + 5 * 3600000),
      calendarEventUid: uuid(),
      status: "assigned",
      expectedHours: "3",
      jobSource: "manual",
      addonsSnapshot: { laundryType: "none" },
      ...extra,
    },
  ]);
  await db
    .insert(schema.jobsToCleaners)
    .values({ jobId: job.id, cleanerId: f.cleaner.id, role: "primary" });
  return job;
}
async function row(table, field, value) {
  return (await db.select().from(table).where(eq(field, value)))[0];
}
async function run() {
  // Structural fixture generated from the origin schema, without customer rows or network extensions.
  const dialect = new PgDialect();
  const enums = new Map(),
    tables = new Map();
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
  const f = await seed();
  const [legacy] = await db
    .insert(schema.jobs)
    .values({
      propertyId: f.property.id,
      calendarEventUid: "old-existing",
      status: "completed",
      checkInTime: new Date("2026-01-01T14:00Z"),
      checkOutTime: new Date("2026-01-01T21:00Z"),
    })
    .returning();
  await db.insert(schema.evidencePackets).values({
    jobId: legacy.id,
    finalEvidenceSubmittedAt: new Date("2026-01-01T21:00Z"),
    photoUrls: ["old/private.jpg"],
    isChecklistComplete: true,
    status: "complete",
  });
  const before = JSON.stringify(
    await pg.query("SELECT row_to_json(j) as row FROM jobs j ORDER BY id"),
  );
  const oldEvidence = JSON.stringify(
    await pg.query(
      "SELECT row_to_json(e) as row FROM evidence_packets e ORDER BY id",
    ),
  );
  const sql = fs.readFileSync(
    path.join(
      root,
      "db/supabase/migrations/0052_prospective_job_execution.sql",
    ),
    "utf8",
  );
  await test("migration applies and reapplies without rewriting existing rows", async () => {
    await pg.exec(sql);
    await pg.exec(sql);
    if (process.argv.includes("--with-schedule-upgrade")) {
      const scheduleSql = fs.readFileSync(path.join(root, "db/supabase/migrations/0053_property_schedule_revisions.sql"), "utf8");
      await pg.exec(scheduleSql);
      await pg.exec(scheduleSql);
    }
    assert.equal(
      JSON.stringify(
        await pg.query("SELECT row_to_json(j) as row FROM jobs j ORDER BY id"),
      ),
      before,
    );
    assert.equal(
      JSON.stringify(
        await pg.query(
          "SELECT row_to_json(e) as row FROM evidence_packets e ORDER BY id",
        ),
      ),
      oldEvidence,
    );
  });
  await test("new private tables have no anonymous or authenticated privileges", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await pg.query(
        `SELECT has_table_privilege('${role}','public.job_execution_contracts','SELECT,INSERT,UPDATE,DELETE') AS allowed`,
      );
      assert.equal(r.rows[0].allowed, false);
    }
  });
  await test("existing calendar conflict returns no new row and never enrolls", async () => {
    assert.equal(
      (
        await contracts.insertIssuedJobs(db, [
          { calendarEventUid: "old-existing" },
        ])
      ).length,
      0,
    );
    assert.equal(await contracts.getExecutionContract(legacy.id), null);
  });
  await test("enrollment off leaves a genuine new job legacy", async () => {
    process.env.JOB_EXECUTION_ENROLLMENT = "false";
    const j = await make(f);
    assert.equal(await contracts.getExecutionContract(j.id), null);
    process.env.JOB_EXECUTION_ENROLLMENT = "true";
  });
  await test("nested booking transaction enrolls its new row atomically", async () => {
    const nested = await db.transaction((tx) =>
      contracts.insertIssuedJobs(tx, [
        {
          propertyId: f.property.id,
          checkInTime: new Date(),
          checkOutTime: new Date(Date.now() + 6 * 3600000),
          expectedHours: "2",
          calendarEventUid: uuid(),
          jobSource: "public_residential_booking",
        },
      ]),
    );
    assert.equal(
      (await contracts.getExecutionContract(nested[0].id)).source,
      "public_residential_booking",
    );
  });
  const job = await make(f);
  await test("only a new INSERT receives issued schedule and checklist", async () => {
    const c = await contracts.getExecutionContract(job.id);
    assert.equal(c.protocol, policy.EXECUTION_PROTOCOL);
    assert.equal(c.plannedStart, job.checkInTime.toISOString());
    assert.ok(c.checklist.length > 0);
  });
  await test("old IDs cannot be enrolled later by direct SQL", async () => {
    await assert.rejects(
      () =>
        pg.query(
          "INSERT INTO job_execution_contracts(job_id,protocol,terms) VALUES ($1,$2,$3)",
          [
            legacy.id,
            policy.EXECUTION_PROTOCOL,
            { protocol: policy.EXECUTION_PROTOCOL },
          ],
        ),
      /newly inserted/,
    );
  });
  await test("issued schedule cannot change through another writer", async () => {
    await assert.rejects(
      () =>
        db
          .update(schema.jobs)
          .set({ checkOutTime: new Date() })
          .where(eq(schema.jobs.id, job.id)),
      /Failed query/,
    );
  });
  await test("backup cannot start a working visit", async () => {
    const [u] = await db
      .insert(schema.users)
      .values({
        supabaseUserId: uuid(),
        email: `${uuid()}@example.invalid`,
        role: "cleaner",
      })
      .returning();
    const [c] = await db
      .insert(schema.cleaners)
      .values({
        userId: u.id,
        fullName: "Backup",
        email: `${uuid()}@example.invalid`,
      })
      .returning();
    await db
      .insert(schema.jobsToCleaners)
      .values({ jobId: job.id, cleanerId: c.id, role: "backup" });
    await assert.rejects(
      () => service.recordExecutionVisit(job.id, c.id, "arrival", null),
      /working assignment/,
    );
  });
  await test("first arrival is write-once and produces one reliability event", async () => {
    await service.recordExecutionVisit(job.id, f.cleaner.id, "arrival", null);
    const first = await row(
      schema.evidencePackets,
      schema.evidencePackets.jobId,
      job.id,
    );
    await service.recordExecutionVisit(job.id, f.cleaner.id, "arrival", null);
    const second = await row(
      schema.evidencePackets,
      schema.evidencePackets.jobId,
      job.id,
    );
    assert.equal(+first.gpsCheckInTimestamp, +second.gpsCheckInTimestamp);
    assert.equal(
      (
        await db
          .select()
          .from(schema.reliabilityEvents)
          .where(eq(schema.reliabilityEvents.jobId, job.id))
      ).length,
      1,
    );
  });
  await test("an unrelated writer cannot reopen an active issued visit", async () => {
    await assert.rejects(
      () =>
        db
          .update(schema.jobs)
          .set({ status: "assigned" })
          .where(eq(schema.jobs.id, job.id)),
      /Failed query/,
    );
  });
  await test("another active visit is refused without changing either job", async () => {
    const next = await make(f);
    await assert.rejects(
      () =>
        service.recordExecutionVisit(next.id, f.cleaner.id, "arrival", null),
      /other active visit/,
    );
    assert.equal(
      (await row(schema.jobs, schema.jobs.id, next.id)).status,
      "assigned",
    );
  });
  await test("settlement refuses unfinished evidence before provider contact", async () => {
    const r = await settlement.settleExecutionJob(job.id);
    assert.equal(r.ok, false);
    assert.equal(providers, 0);
  });
  const jpeg = await require("sharp")({
    create: { width: 64, height: 64, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  const reserveInput = (room = "living") => ({
    uploadId: uuid(),
    roomKey: room,
    capturedAt: new Date().toISOString(),
    byteSize: jpeg.length,
    mime: "image/jpeg",
    sha256: crypto.createHash("sha256").update(jpeg).digest("hex"),
  });
  let input = reserveInput(),
    reservation;
  await test("upload reservation is idempotent and rejects changed claims", async () => {
    reservation = await service.reserveExecutionUpload(
      job.id,
      f.cleaner.id,
      input,
    );
    assert.equal(
      (await service.reserveExecutionUpload(job.id, f.cleaner.id, input)).path,
      reservation.path,
    );
    await assert.rejects(
      () =>
        service.reserveExecutionUpload(job.id, f.cleaner.id, {
          ...input,
          roomKey: "kitchen",
        }),
      /different evidence/,
    );
  });
  await test("untransferred bytes cannot be acknowledged", async () => {
    await assert.rejects(
      () =>
        service.acknowledgeExecutionUpload(
          job.id,
          f.cleaner.id,
          input.uploadId,
        ),
      /not reached/,
    );
  });
  await test("verified photo survives a lost response and failed preview signing", async () => {
    media.set(reservation.path, jpeg);
    previewFails = true;
    const a = await service.acknowledgeExecutionUpload(
      job.id,
      f.cleaner.id,
      input.uploadId,
    );
    assert.equal(a.url, null);
    await service.acknowledgeExecutionUpload(
      job.id,
      f.cleaner.id,
      input.uploadId,
    );
    const state = await service.getExecutionEvidence(job.id, f.cleaner.id);
    assert.equal(state.roomPhotos.living.length, 1);
    previewFails = false;
  });
  await test("draft can be partial and stale revisions conflict", async () => {
    await service.saveExecutionDraft(job.id, f.cleaner.id, {
      revision: 0,
      items: [],
      notes: "partial",
    });
    await assert.rejects(
      () =>
        service.saveExecutionDraft(job.id, f.cleaner.id, {
          revision: 0,
          items: [],
          notes: "overwrites",
        }),
      /another device/,
    );
  });
  const issued = await contracts.getExecutionContract(job.id);
  await test("cannot finalize before physical departure", async () => {
    await assert.rejects(
      () =>
        service.saveExecutionDraft(
          job.id,
          f.cleaner.id,
          {
            revision: 1,
            items: issued.checklist.map((i) => ({ ...i, completed: true })),
            notes: "done",
          },
          true,
        ),
      /departure/,
    );
  });
  // Capture every remaining room before departing; transfer can finish later.
  const pending = [];
  for (const room of issued.rooms)
    if (room.minPhotos && room.roomKey !== "living") {
      const i = reserveInput(room.roomKey);
      const r = await service.reserveExecutionUpload(job.id, f.cleaner.id, i);
      pending.push({ i, r });
    }
  await test("departure preserves planned deadline and clears on-job only when no sibling visit", async () => {
    const before = await row(schema.jobs, schema.jobs.id, job.id);
    await service.recordExecutionVisit(job.id, f.cleaner.id, "departure", null);
    await service.recordExecutionVisit(job.id, f.cleaner.id, "departure", null);
    const after = await row(schema.jobs, schema.jobs.id, job.id);
    assert.equal(+before.checkOutTime, +after.checkOutTime);
    assert.equal(after.status, "completed_pending_evidence");
    assert.equal(
      (await row(schema.cleaners, schema.cleaners.id, f.cleaner.id))
        .onCallStatus,
      "available",
    );
  });
  await test("after-departure capture is refused, prior captured uploads are accepted", async () => {
    await assert.rejects(
      () =>
        service.reserveExecutionUpload(job.id, f.cleaner.id, reserveInput()),
      /capture time/,
    );
    for (const { i, r } of pending) {
      media.set(r.path, jpeg);
      await service.acknowledgeExecutionUpload(
        job.id,
        f.cleaner.id,
        i.uploadId,
      );
    }
  });
  const selected = { ...reserveInput(), source: "gallery", capturedAt: null };
  await test("selected images after departure are verified without inventing a capture time", async () => {
    const r = await service.reserveExecutionUpload(job.id, f.cleaner.id, selected);
    media.set(r.path, jpeg);
    await service.acknowledgeExecutionUpload(job.id, f.cleaner.id, selected.uploadId);
    await service.acknowledgeExecutionUpload(job.id, f.cleaner.id, selected.uploadId);
    const saved = await row(schema.evidenceUploadManifest, schema.evidenceUploadManifest.uploadId, selected.uploadId);
    assert.equal(saved.source, "gallery"); assert.equal(saved.capturedAt, null); assert.equal(saved.state, "verified");
    const form = await service.getExecutionEvidence(job.id, f.cleaner.id);
    assert.equal(form.photos.find(p => p.uploadId === selected.uploadId).source, "gallery");
    assert.equal(form.isSubmitted, false);
  });
  await test("photo source cannot change on retry and imports cannot claim a shutter timestamp", async () => {
    await assert.rejects(() => service.reserveExecutionUpload(job.id, f.cleaner.id, { ...selected, source: "camera", capturedAt: input.capturedAt }), /different evidence/);
    await assert.rejects(() => service.reserveExecutionUpload(job.id, f.cleaner.id, { ...selected, uploadId: uuid(), capturedAt: input.capturedAt }), /capture time unknown/);
    await assert.rejects(() => service.reserveExecutionUpload(job.id, f.cleaner.id, { ...selected, uploadId: uuid(), source: "camera" }), /require a capture time/);
  });
  await test("gallery still requires arrival and cannot bypass assignment authorization", async () => {
    const g = await seed(), j = await make(g);
    await assert.rejects(() => service.reserveExecutionUpload(j.id, g.cleaner.id, { ...selected, uploadId: uuid() }), /not open/);
    await assert.rejects(() => service.reserveExecutionUpload(job.id, g.cleaner.id, { ...selected, uploadId: uuid() }), /assignment/);
  });
  const final = {
    revision: 1,
    items: issued.checklist.map((i) => ({ ...i, completed: true })),
    notes: "done",
  };
  await test("finalization is immutable and identical retries succeed", async () => {
    const a = await service.saveExecutionDraft(
      job.id,
      f.cleaner.id,
      final,
      true,
    );
    const b = await service.saveExecutionDraft(
      job.id,
      f.cleaner.id,
      final,
      true,
    );
    assert.equal(a.finalEvidenceSubmittedAt, b.finalEvidenceSubmittedAt);
    await assert.rejects(
      () =>
        service.saveExecutionDraft(
          job.id,
          f.cleaner.id,
          { ...final, notes: "changed" },
          true,
        ),
      /cannot be changed/,
    );
  });
  await test("late object acknowledgements cannot join final evidence", async () => {
    await assert.rejects(
      () =>
        service.acknowledgeExecutionUpload(
          job.id,
          f.cleaner.id,
          input.uploadId,
        ),
      /not open/,
    );
  });
  await test("issued evidence cannot be moved to or adopted from a legacy job", async () => {
    await assert.rejects(() => pg.query('UPDATE evidence_packets SET job_id=$1 WHERE job_id=$2', [legacy.id, job.id]), /job identity is immutable/);
    await assert.rejects(() => pg.query('UPDATE evidence_packets SET job_id=$1 WHERE job_id=$2', [job.id, legacy.id]), /job identity is immutable/);
  });
  await test("SQL refuses completion when payment status is null", async () => {
    await assert.rejects(() => pg.query("UPDATE jobs SET status='completed', payment_status=NULL WHERE id=$1", [job.id]), /Settlement required/);
  });
  await test("settlement creates one payout and repeated settlement is a no-op", async () => {
    const a = await settlement.settleExecutionJob(job.id);
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal((await settlement.settleExecutionJob(job.id)).ok, true);
    assert.equal(
      (
        await db
          .select()
          .from(schema.payouts)
          .where(eq(schema.payouts.jobId, job.id))
      ).length,
      1,
    );
  });
  await test("started or settled job cannot cancel before provider access", async () => {
    const count = providers;
    await assert.rejects(
      () => cancellation.cancelExecutionJob(job.id, "admin"),
      /separately reviewed/,
    );
    assert.equal(providers, count);
  });
  await test("new unstarted manual cancellation is atomic, retryable and cannot reopen", async () => {
    const j = await make(f);
    const result = await cancellation.cancelExecutionJob(j.id, "admin");
    assert.equal(result.lateCancel, true);
    assert.equal(
      (await row(schema.jobs, schema.jobs.id, j.id)).status,
      "canceled",
    );
    assert.equal(
      (await cancellation.cancelExecutionJob(j.id, "admin")).message,
      "Cancellation already completed",
    );
    assert.equal(
      (
        await db
          .select()
          .from(schema.payouts)
          .where(eq(schema.payouts.jobId, j.id))
      ).length,
      1,
    );
    await assert.rejects(
      () => service.recordExecutionVisit(j.id, f.cleaner.id, "arrival", null),
      /assignment|Canceled/,
    );
  });
  await test("a refunded late-cancellation charge cannot create cleaner pay", async () => {
    const j = await make(f, { paymentIntentId: "pi_synthetic_refunded" });
    await assert.rejects(
      () => cancellation.cancelExecutionJob(j.id, "admin"),
      /refunded or missing charge/,
    );
    assert.equal((await row(schema.jobs, schema.jobs.id, j.id)).status, "canceled");
    assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId, j.id))).length, 0);
    assert.equal((await row(schema.jobs, schema.jobs.id, j.id)).paymentStatus, null);
  });
  await test("capture mismatches, foreign jobs and removed objects never count", async () => {
    const g = await seed(),
      j = await make(g);
    await service.recordExecutionVisit(j.id, g.cleaner.id, "arrival", null);
    const i = reserveInput();
    const r = await service.reserveExecutionUpload(j.id, g.cleaner.id, i);
    media.set(r.path, Buffer.from("not an image"));
    await assert.rejects(
      () => service.acknowledgeExecutionUpload(j.id, g.cleaner.id, i.uploadId),
      /size|differs|decoded/,
    );
    await assert.rejects(
      () =>
        service.acknowledgeExecutionUpload(job.id, f.cleaner.id, i.uploadId),
      /not found/,
    );
    await service.removeExecutionUpload(j.id, g.cleaner.id, i.uploadId);
    media.set(r.path, jpeg);
    await assert.rejects(
      () => service.acknowledgeExecutionUpload(j.id, g.cleaner.id, i.uploadId),
      /removed/,
    );
    assert.equal(
      (await service.getExecutionEvidence(j.id, g.cleaner.id)).photos.length,
      0,
    );
  });
  await test("legacy submitted job and packet remain byte-for-byte unchanged", async () => {
    assert.deepEqual(await row(schema.jobs, schema.jobs.id, legacy.id), legacy);
    assert.equal(
      (
        await row(
          schema.evidencePackets,
          schema.evidencePackets.jobId,
          legacy.id,
        )
      ).photoUrls[0],
      "old/private.jpg",
    );
  });
  await test("DST gaps and folds refuse guessing; ordinary dates resolve", async () => {
    assert.throws(
      () => policy.easternInstant("2027-03-14", "02:30"),
      /does not exist/,
    );
    assert.throws(
      () => policy.easternInstant("2026-11-01", "01:30"),
      /Ambiguous/,
    );
    assert.equal(
      policy.easternInstant("2026-11-01", "10:00").toISOString(),
      "2026-11-01T15:00:00.000Z",
    );
  });
  await test("current late-pay formula retains grace and 30/60-minute boundaries", async () => {
    const base = { expectedHours: 3, hourlyRateCents: 1700, role: "primary" };
    for (const [delay, total] of [
      [0, 51],
      [9, 51],
      [10, 51],
      [11, 51],
      [30, 36],
      [59, 26],
      [60, 0],
    ])
      assert.equal(
        computeCleanerPay({ ...base, arrivalDelayMinutes: delay }).total,
        total,
      );
  });
  console.log(
    `${passed} PostgreSQL/service regressions passed. Hosted Auth/Storage/provider/device gates remain separate.`,
  );
}
run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pg.close());
