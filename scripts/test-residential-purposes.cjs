// Reuse the real PGlite/issued-contract regression harness; block hosted I/O.
const path = require("node:path"), assert = require("node:assert/strict");
if (process.env.PHASE3A_OFFLINE_BOOTSTRAP === "1") {
  global.fetch = async () => { throw Error("Network prohibited"); };
  for (const name of ["node:http", "node:https"]) {
    const transport = require(name);
    transport.request = transport.get = () => { throw Error("Network prohibited"); };
  }
  require("node:net").Socket.prototype.connect = function() { throw Error("Network prohibited"); };
  const Module = require("node:module"), load = Module._load;
  Module._load = function(name, ...args) {
    if (name === "dotenv" || name === "postgres") throw Error("Hosted/env import prohibited: " + name);
    return load.call(this, name, ...args);
  };
}
exports.verify = async function(ctx) {
  const { db, pg, schema, seed, contracts, test, replace, root, uuid } = ctx;
  const { eq } = require("drizzle-orm");
  const pricing = require(path.join(root, "lib/pricing/residential.ts"));
  const sales = require(path.join(root, "lib/pricing/residential-sales.ts"));
  const { readResidentialSnapshot } = require(path.join(root, "lib/pricing/residential-v2/contracts.ts"));
  const { getJobDisplay } = require(path.join(root, "lib/constants/service-type.ts"));
  const { residentialCustomerScope } = require(path.join(root, "lib/customer/residential-scope.ts"));
  const { createChecklistSnapshot } = require(path.join(root, "lib/cleaner/checklist-snapshot.ts"));
  const { getArrivalInstant } = require(path.join(root, "lib/scheduling/residential-notice.ts"));
  const { V2_CONFIG_HASH } = require(path.join(root, "lib/pricing/residential-v2/rules.ts"));
  const base = { bedrooms: 1, bathrooms: 1, sqft: 750, cleaningLevel: "deep", petsAllowed: false, hotTub: "none", inUnitLaundryLoads: 0 };
  const quote = (purpose, changes = {}) => sales.evaluateResidentialSale({ ...base, ...(purpose ? { purpose } : {}), ...changes });
  await test("ordinary V1/V2 identities and frozen terms retain historical shape", async () => {
    const v1 = pricing.evaluateResidentialPrice(base), v2 = quote();
    assert.ok(v1.ok && v2.ok);
    assert.equal(v1.terms.inputIdentity, JSON.stringify(["residential-v1", 1, 1, 750, "deep", false]));
    assert.equal(v2.terms.inputIdentity, JSON.stringify(["residential-v2", V2_CONFIG_HASH, 1, 1, 750, "deep", false, "none", 0]));
    const frozen = pricing.buildResidentialJobStaffing(v2.terms, v2.terms.amountCents).addonsSnapshot;
    const before = JSON.stringify(frozen);
    quote("move_in"); quote("move_out"); readResidentialSnapshot(frozen);
    assert.equal(JSON.stringify(frozen), before);
    assert.equal("purpose" in JSON.parse(JSON.stringify(v2.terms.input)), false);
  });
  for (const purpose of ["move_in", "move_out"]) {
    await test(`${purpose} reuses Deep price, time, staffing, checklist and pay inputs`, async () => {
      for (const extras of [{}, { petsAllowed: true, hotTub: "basic", inUnitLaundryLoads: 1 }]) {
        const deep = quote(undefined, extras), move = quote(purpose, extras);
        assert.equal(deep.ok, move.ok);
        // Existing add-on review gates stay closed; compare their analysis terms too.
        const deepTerms = deep.ok ? deep.terms : pricing.buildResidentialV2AnalysisTerms({ ...base, ...extras });
        const moveTerms = move.ok ? move.terms : pricing.buildResidentialV2AnalysisTerms({ ...base, ...extras, purpose });
        for (const key of ["amountCents", "expectedHoursPerCleaner", "operationalHours", "teamSize", "priceDetails"])
          assert.deepEqual(moveTerms[key], deepTerms[key]);
        const a = pricing.buildResidentialJobStaffing(deepTerms, deepTerms.amountCents);
        const b = pricing.buildResidentialJobStaffing(moveTerms, moveTerms.amountCents);
        assert.deepEqual(a.staffing, b.staffing);
        const property = { serviceType: "residential_one_time", bedCount: 1, bathCount: "1", sqFt: 750, cleaningLevel: "deep", useDefaultChecklist: true };
        assert.deepEqual(createChecklistSnapshot({ ...property, residentialPricing: a.addonsSnapshot.residentialPricing }, []).items,
          createChecklistSnapshot({ ...property, residentialPricing: b.addonsSnapshot.residentialPricing }, []).items);
        assert.equal(readResidentialSnapshot(b.addonsSnapshot).terms.input.purpose, purpose);
        assert.notEqual(deepTerms.inputIdentity, moveTerms.inputIdentity);
        if (move.ok) assert.equal(pricing.toPublicResidentialQuote(moveTerms).purpose, purpose);
      }
    });
  }
  await test("invalid purposes, Standard move scope and historical V1 move reinterpretation fail", async () => {
    assert.equal(quote("move_in", { cleaningLevel: "standard" }).ok, false);
    assert.equal(quote("invalid").ok, false);
    assert.equal(pricing.evaluateResidentialPrice({ ...base, purpose: "move_in" }).ok, false);
    assert.equal(quote("move_in", { sqft: 4000 }).ok, quote(undefined, { sqft: 4000 }).ok);
    const move = quote("move_in"); assert.ok(move.ok);
    const frozen = pricing.buildResidentialJobStaffing(move.terms, move.terms.amountCents).addonsSnapshot;
    frozen.residentialPricing.input.purpose = "move_out";
    assert.throws(() => readResidentialSnapshot(frozen), /Corrupt/);
  });
  await test("shared customer/admin/cleaner labels use frozen purpose and preserve manual job labels", async () => {
    for (const purpose of ["move_in", "move_out"]) {
      const move = quote(purpose); assert.ok(move.ok);
      const addonsSnapshot = pricing.buildResidentialJobStaffing(move.terms, move.terms.amountCents).addonsSnapshot;
      const label = purpose === "move_in" ? "Move-In Clean" : "Move-Out Clean";
      assert.ok(getJobDisplay({ serviceType: "residential_one_time", addonsSnapshot }).label.includes(label));
      assert.ok(residentialCustomerScope(addonsSnapshot).includes(`${label} (Deep scope).`));
      assert.equal(getJobDisplay({ serviceType: "residential_one_time", addonsSnapshot, jobLabel: "reclean" }).label, "Reclean/Correction");
      assert.equal(getJobDisplay({ serviceType: "vacation_rental_subscription", purpose }).label, "Vacation Rental Turnover");
    }
  });
  const deliveries = [], management = [], intentMap = new Map(), keys = new Map();
  // The shared harness builds explicit indexes; public upsert also needs these
  // inline column uniqueness declarations from customers.schema.ts.
  await pg.exec("CREATE UNIQUE INDEX phase3a_customer_email ON customers(email); CREATE UNIQUE INDEX phase3a_customer_stripe ON customers(stripe_customer_id);");
  const provider = {
    customers: { list: async () => ({ data: [] }), create: async () => ({ id: `cus_${uuid()}` }), retrieve: async id => ({ id }), update: async id => ({ id }) },
    paymentMethods: { list: async () => ({ data: [{ id: "pm_synthetic" }] }) },
    paymentIntents: {
      create: async (input, options) => {
        if (keys.has(options.idempotencyKey)) return keys.get(options.idempotencyKey);
        const intent = { ...input, id: `pi_${uuid()}`, client_secret: "synthetic_secret", status: "succeeded", amount_received: input.amount,
          latest_charge: { amount: input.amount, currency: "usd", amount_refunded: 0, refunded: false, paid: true, captured: true } };
        intentMap.set(intent.id, intent); keys.set(options.idempotencyKey, intent); return intent;
      },
      retrieve: async id => { assert.ok(intentMap.has(id)); return intentMap.get(id); },
    },
    refunds: { list: async () => ({ data: [], has_more: false }) },
  };
  replace("db/index.ts", { db, schema, getDbOrNull: () => db });
  replace("lib/stripe/get-stripe.ts", { getStripe: () => provider });
  replace("lib/services/google-maps/geocoding.ts", { geocodeAddressResult: async () => ({ status: "ok", coordinates: { latitude: 28, longitude: -81 } }) });
  replace("lib/google-maps/serviceArea/index.ts", { isPointInServiceArea: () => true });
  replace("lib/services/email.service.ts", { sendResidentialBookingConfirmationEmail: async input => { deliveries.push(input); return { success: true }; } });
  replace("lib/queries/admin-notifications.ts", { notifyAdmins: async input => { management.push(input); return 1; } });
  replace("lib/services/auth/customer-account.service.ts", { inviteCustomerToPortalAfterPayment: async () => ({ success: true, emailSent: false }) });
  replace("lib/services/payment/void-charge.ts", { voidCharge: async () => { throw Error("Unexpected refund in purpose test"); } });
  const publicBooking = require(path.join(root, "lib/services/residential-booking.service.ts"));
  const portal = require(path.join(root, "lib/services/one-off.service.ts"));
  function form(purpose, changes = {}) {
    const priced = quote(purpose); assert.ok(priced.ok);
    const email = `${uuid()}@example.invalid`;
    return { ...base, purpose, pricingVersion: "residential-v2", name: "Synthetic Customer", email, emailConfirm: email, phoneNumber: "2025550123",
      address: "Synthetic property address", isAddressInServiceArea: true, cleanDate: "2030-11-04", arrivalWindow: pricing.toPublicResidentialQuote(priced.terms).arrivalWindowKeys[0], ...changes };
  }
  await test("both move purposes keep the 48-hour arrival-instant gate through DST", async () => {
    for (const purpose of ["move_in", "move_out"]) for (const cleanDate of ["2027-03-14", "2027-11-07"]) {
      const input = form(purpose, { cleanDate }), arrival = getArrivalInstant(cleanDate, input.arrivalWindow);
      const exact = new Date(+arrival - 48 * 3600000);
      assert.equal((await publicBooking.evaluateResidentialBooking(input, exact)).ok, true);
      const refused = await publicBooking.evaluateResidentialBooking(input, new Date(+exact + 1));
      assert.equal(refused.ok, false); assert.equal(refused.reason, "notice");
      const recovered = await publicBooking.evaluateResidentialBooking(input, new Date(+arrival - 3600000), false,
        { version: "residential-v2", configHash: V2_CONFIG_HASH });
      assert.equal(recovered.ok, true); assert.equal(recovered.residentialTerms.input.purpose, purpose);
    }
  });
  await test("shared public/portal selector emits Deep plus purpose and clears purpose for ordinary levels", async () => {
    const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), React = require("react");
    const file = path.join(root, "components/customers/cta-booking-button/residential/ResidentialLevelChoice.tsx");
    const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const mod = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${js}\n})`)(name => {
      if (name === "react/jsx-runtime") return require(name);
      if (name === "../RadioCard") return { RadioCard: () => null };
      if (name.startsWith("@/")) return require(path.join(root, name.slice(2)));
      throw Error("Uncontrolled UI dependency: " + name);
    }, mod, mod.exports);
    const changes = [], tree = mod.exports.ResidentialLevelChoice({ value: "deep", purpose: "move_in", pricingVersion: "residential-v2", onChange: (...v) => changes.push(v) });
    const choices = React.Children.toArray(tree.props.children[1].props.children);
    assert.equal(choices.filter(c => c.props.checked).length, 1);
    assert.equal(choices.find(c => c.props.checked).props.value, "move_in");
    choices.find(c => c.props.value === "move_out").props.onChange();
    assert.deepEqual(changes.at(-1), ["deep", "move_out"]);
    choices.find(c => c.props.value === "standard").props.onChange();
    assert.deepEqual(changes.at(-1), ["standard"]);
  });
  for (const purpose of ["move_in", "move_out"]) {
    await test(`public ${purpose} payment/recovery/replay retains purpose and rejects changed purpose before issuing`, async () => {
      const input = form(purpose), token = uuid();
      const created = await publicBooking.createResidentialPaymentIntent({ formData: input, sessionToken: token });
      assert.ok(created.ok, JSON.stringify(created));
      const intent = [...intentMap.values()].at(-1);
      assert.equal(intent.metadata.residential_purpose, purpose);
      const mismatch = await publicBooking.completeResidentialBooking({ ...input, purpose: purpose === "move_in" ? "move_out" : "move_in" }, intent.id);
      assert.equal(mismatch.success, false);
      const completed = await publicBooking.completeResidentialBooking(input, intent.id);
      assert.ok(completed.success, JSON.stringify(completed));
      const saved = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, completed.data.job.id) });
      assert.equal(saved.addonsSnapshot.residentialPricing.input.purpose, purpose);
      assert.equal(saved.paymentStatus, "captured");
      assert.ok(await contracts.getExecutionContract(saved.id));
      assert.equal(deliveries.at(-1).purpose, purpose);
      const replay = await publicBooking.completeResidentialBooking(input, intent.id);
      assert.ok(replay.success); assert.equal(replay.data.job.id, saved.id);
      const locked = await publicBooking.createResidentialPaymentIntent({ formData: { ...input, purpose: purpose === "move_in" ? "move_out" : "move_in" }, sessionToken: token });
      assert.equal(locked.ok, false);
    });
  }
  await test("portal move quote is owner-scoped; booking/replay pins purpose and guards changed same-price scope", async () => {
    const f = await seed();
    await db.update(schema.properties).set({ serviceType: "residential_one_time", bedCount: 1, bathCount: "1", sqFt: 750 }).where(eq(schema.properties.id, f.property.id));
    await db.update(schema.customers).set({ stripeCustomerId: "cus_synthetic" }).where(eq(schema.customers.id, f.property.customerId));
    for (const [purpose, date] of [["move_in", "2030-11-05"], ["move_out", "2030-11-06"]]) {
      const input = { propertyId: f.property.id, date, cleaningLevel: "deep", purpose, hotTub: "none", inUnitLaundryLoads: 0, pricingVersion: "residential-v2" };
      const q = await portal.quoteResidentialOneOff(f.property.customerId, input); assert.equal(q.refused, false); assert.equal(q.purpose, purpose);
      assert.equal((await portal.quoteResidentialOneOff(uuid(), input)).refused, true);
      const booking = { ...input, quoteIdentity: q.inputIdentity, arrivalWindow: q.arrivalWindowKeys[0] };
      const created = await portal.bookOneOffClean(f.property.customerId, booking); assert.ok(created.success, JSON.stringify(created));
      const saved = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, created.jobId) });
      assert.equal(saved.addonsSnapshot.residentialPricing.input.purpose, purpose);
      const replay = await portal.bookOneOffClean(f.property.customerId, booking); assert.ok(replay.success); assert.equal(replay.jobId, created.jobId);
      assert.equal((await portal.bookOneOffClean(f.property.customerId, { ...booking, purpose: purpose === "move_in" ? "move_out" : "move_in" })).success, false);
    }
  });
  await test("cleaner list/detail DTOs retain purpose for web badges without exposing the pricing snapshot", async () => {
    const f = await seed(), start = new Date(Date.now() + 3 * 86400000);
    const { formatInTimeZone } = require("date-fns-tz");
    await db.update(schema.properties).set({ serviceType: "residential_one_time", bedCount: 1, bathCount: "1", sqFt: 750 }).where(eq(schema.properties.id, f.property.id));
    await db.update(schema.cleaners).set({ accountStatus: "active", eligibleForAssignments: true, residentialQualified: true }).where(eq(schema.cleaners.id, f.cleaner.id));
    await db.insert(schema.availabilityDays).values({ cleanerId: f.cleaner.id, date: formatInTimeZone(start, "America/New_York", "yyyy-MM-dd"), isAvailable: true, onCallEligible: false, openPoolEligible: false, actorId: "synthetic" });
    const move = quote("move_out"); assert.ok(move.ok);
    const staffing = pricing.buildResidentialJobStaffing(move.terms, move.terms.amountCents);
    const snapshot = createChecklistSnapshot({ ...f.property, serviceType: "residential_one_time", bedCount: 1, bathCount: "1", cleaningLevel: "deep", residentialPricing: staffing.addonsSnapshot.residentialPricing }, []);
    const [job] = await contracts.insertIssuedJobs(db, [{ propertyId: f.property.id, serviceType: "residential_one_time", jobSource: "manual", calendarEventUid: uuid(), status: "unassigned", checkInTime: start, checkOutTime: new Date(+start + 6 * 3600000), expectedHours: staffing.expectedHours, addonsSnapshot: staffing.addonsSnapshot, checklistSnapshot: snapshot }]);
    await db.transaction(async tx => {
      await tx.insert(schema.jobsToCleaners).values({ jobId: job.id, cleanerId: f.cleaner.id, role: "primary" });
      await tx.update(schema.jobs).set({ status: "assigned" }).where(eq(schema.jobs.id, job.id));
    });
    const list = await require(path.join(root, "lib/queries/cleaner-jobs.ts")).getCleanerUpcomingJobs(f.cleaner.id);
    const item = list.find(j => j.jobId === job.id); assert.ok(item); assert.equal(item.purpose, "move_out");
    assert.match(getJobDisplay(item).label, /Move-Out Clean/); assert.equal("addonsSnapshot" in item, false);
    replace("lib/storage/signed-url.ts", { EVIDENCE_BUCKET: "synthetic-evidence", CHECKLISTS_BUCKET: "synthetic-checklists", createSignedUrls: async (_bucket, paths) => paths.map(() => "https://preview.example.invalid/synthetic") });
    const detail = await require(path.join(root, "lib/queries/cleaner-job-detail.ts")).getCleanerJobDetail(f.cleaner.id, job.id);
    assert.equal(detail.purpose, "move_out"); assert.match(getJobDisplay(detail).label, /Move-Out Clean/);
    assert.equal("addonsSnapshot" in detail, false);
  });
  for (const variant of ['older_success_newest_failed','older_pending_newest_failed','under_collected']) await test(`portal refuses ${variant} payment before issuing a job`,async()=>{
    const f=await seed();
    await db.update(schema.properties).set({serviceType:'residential_one_time',bedCount:1,bathCount:'1',sqFt:750}).where(eq(schema.properties.id,f.property.id));
    await db.update(schema.customers).set({stripeCustomerId:'cus_'+uuid()}).where(eq(schema.customers.id,f.property.customerId));
    const base={propertyId:f.property.id,date:'2030-11-12',cleaningLevel:'deep',purpose:'move_out',hotTub:'none',inUnitLaundryLoads:0,pricingVersion:'residential-v2'};
    const selected=await portal.quoteResidentialOneOff(f.property.customerId,base),create=provider.paymentIntents.create,list=provider.refunds.list;
    provider.paymentIntents.create=async(...args)=>{const intent=await create(...args);if(variant==='under_collected')intent.amount_received=intent.amount-1;if(variant==='older_success_newest_failed')intent.latest_charge.amount_refunded=100;return intent;};
    provider.refunds.list=async({payment_intent,limit=100})=>{
      const rows=variant==='under_collected'?[]:[{id:'re_failed',payment_intent,status:'failed',amount:100,currency:'usd'},{id:'re_older',payment_intent,status:variant==='older_pending_newest_failed'?'pending':'succeeded',amount:100,currency:'usd'}];
      return {data:rows.slice(0,limit),has_more:rows.length>limit};
    };
    try {
      const result=await portal.bookOneOffClean(f.property.customerId,{...base,quoteIdentity:selected.inputIdentity,arrivalWindow:selected.arrivalWindowKeys[0]});
      assert.equal(result.success,false);
      assert.equal((await db.select().from(schema.jobs).where(eq(schema.jobs.propertyId,f.property.id))).length,0);
    } finally {provider.paymentIntents.create=create;provider.refunds.list=list;}
  });
  if (process.argv.includes('--condition-review')) await require('./test-condition-review.cjs').verify(ctx, { publicBooking, portal, form, provider, intentMap, deliveries, management });
};
if (require.main === module) {
  const env = { ...process.env, PHASE3A_OFFLINE_BOOTSTRAP: "1" };
  for (const key of Object.keys(env)) if (/database|postgres|supabase|stripe|resend|twilio|vapid/i.test(key)) delete env[key];
  const run = require("node:child_process").spawnSync(process.execPath, ["--require", __filename, path.join(__dirname, "test-job-execution.cjs"), "--with-schedule-upgrade", "--phase2c", "--residential-purposes"], { env, stdio: "inherit", windowsHide: true });
  process.exitCode = run.status ?? 1;
}
