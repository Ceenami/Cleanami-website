// Actual pricing/checkout/cron source and Drizzle SQL against in-process PostgreSQL.
// No env files, hosted database, Auth, Stripe, email or other network calls.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const tree = process.argv.includes("--phase2c") ? path.join(root, "output/phase2c") : root;
process.env.TZ = "UTC";
process.env.TSX_TSCONFIG_PATH = path.join(tree, "tsconfig.json");
process.env.DATABASE_URL = "";
require("tsx/cjs");
const ts = require("typescript"), { PGlite } = require("@electric-sql/pglite");
const { drizzle } = require("drizzle-orm/pglite"), orm = require("drizzle-orm");
const { getTableConfig, PgDialect } = require("drizzle-orm/pg-core");
const schema = require(path.join(tree, "db/schema.ts"));
const pg = new PGlite(), db = drizzle(pg, { schema });
let migrationHistoryPreserved = false;
const pure = (file) => require(path.join(tree, file));
const normalize = pure("lib/validations/bookng-modal/serialize-signup-form.ts");
const staffing = pure("lib/pricing/apply-job-staffing.ts");
const charge = pure("lib/pricing/rental-charge.ts");
const refusal = pure("lib/pricing/rental-quote-refusal.ts");
const promo = pure("lib/pricing/promo-code.ts");
const pay = pure("lib/pricing/cleaner-pay.ts");
let now = Date.parse("2030-01-28T12:00Z");
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
function emptyImports(file) {
  return Object.fromEntries([...fs.readFileSync(path.join(tree, file), "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map(m => [m[1], {}]));
}
function load(file, mocks, append = "") {
  const source = fs.readFileSync(path.join(tree, file), "utf8") + append;
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const requireMock = name => {
    if (name === "server-only") return {};
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw Error("Uncontrolled dependency: " + name);
  };
  vm.runInNewContext(`(function(require,module,exports){${js}\n})`, { process: { env: {} }, console: { log() {}, warn() {}, error() {} }, Date: Clock, Error, JSON, Map, Set, Number, String, Boolean, Math, Buffer })(requireMock, module, module.exports);
  return module.exports;
}
const freeze = load("lib/services/payment/freeze-rental-charge.ts", { "@/db/schemas": schema, "drizzle-orm": orm, "@/lib/pricing/rental-charge": charge }).freezeRentalCharge;
const verifyPayment = load("lib/services/payment/verify-settled-payment.ts", {});
const authorization = load("lib/services/payment/rental-authorization.ts", { "./verify-settled-payment": verifyPayment });
function rules() {
  return {
    basePricingRules: Array.from({ length: 5 }, (_, i) => ({ bedrooms: i + 1, ...Object.fromEntries(Array.from({ length: 5 }, (_, j) => [`price${j + 1}BathCents`, (55 + 30 * (i + 1) + 20 * (j + 1)) * 100])) })),
    sqftSurchargeRules: [[0,999,0],[1000,1499,2500],[1500,1999,5000],[2000,2499,7500],[2500,2999,10000],[3000,999999,0]].map(([rangeStart,rangeEnd,surchargeCents]) => ({ rangeStart,rangeEnd,surchargeCents,isCustomQuote:rangeStart === 3000 })),
    laundryPricingRules: [{ serviceType: "In-Unit", customerRevenueBaseCents: 0, customerRevenuePerLoadCents: 900 },{ serviceType: "Off-Site", customerRevenueBaseCents: 2000, customerRevenuePerLoadCents: 900 }],
    hotTubPricingRules: [{ serviceType: "Basic", customerRevenueCents: 2000 },{ serviceType: "Full_Drain", customerRevenueCents: 5000 }],
  };
}
function pricing(config = rules()) {
  return load("lib/services/pricing.service.ts", {
    "@/db": { db: { query: Object.fromEntries(Object.entries(config).map(([k,v]) => [k,{ findMany: async () => v }])) }, sequentialQueries: async (...fns) => { const out=[]; for (const fn of fns) out.push(await fn()); return out; } },
    "@/lib/validations/bookng-modal/serialize-signup-form": normalize,
    "@/lib/pricing/base-price": pure("lib/pricing/base-price.ts"),
    "@/lib/pricing/subscription-discount": pure("lib/pricing/subscription-discount.ts"),
    "@/lib/validations/laundry-loads": pure("lib/validations/laundry-loads.ts"),
    "@/lib/pricing/staffing-logic": pure("lib/pricing/staffing-logic.ts"),
  });
}
async function makeSchema() {
  const dialect = new PgDialect(), enums = new Map();
  const tables = [schema.customers,schema.properties,schema.subscriptions,schema.jobs,schema.cleaners,schema.evidencePackets,schema.jobsToCleaners,schema.cancelledJobs].map(getTableConfig);
  await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  for (const t of tables) for (const c of t.columns) if (c.enum?.enumName) enums.set(c.enum.enumName,c.enum.enumValues);
  for (const [name,values] of enums) await pg.exec(`CREATE TYPE "${name}" AS ENUM (${values.map(v => `'${v}'`).join(",")})`);
  for (const t of tables) {
    // Start from the real pre-0054 layout so the migration must add the column.
    const columns = t.columns.filter(c => t.name !== "jobs" || c.name !== "rental_charge").map(c => {
      let def = "";
      if (c.default !== undefined) {
        const v = c.default;
        def = " DEFAULT " + (orm.is(v,orm.SQL) ? dialect.sqlToQuery(v).sql : typeof v === "string" ? `'${v.replaceAll("'","''")}'` : typeof v === "object" ? `'${JSON.stringify(v)}'` : JSON.stringify(v));
      }
      return `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${def}`;
    });
    await pg.exec(`CREATE TABLE "${t.name}" (${columns.join(",")})`);
  }
  await pg.exec("INSERT INTO public.jobs(calendar_event_uid) VALUES ('existing-before-0054')");
  const before=(await pg.query("SELECT to_jsonb(j) AS value FROM public.jobs j")).rows[0].value;
  for (const file of ["0052_prospective_job_execution.sql","0053_property_schedule_revisions.sql","0054_rental_charge_receipts.sql","0054_rental_charge_receipts.sql"])
    await pg.exec(fs.readFileSync(path.join(root,"db/supabase/migrations",file),"utf8"));
  const after=(await pg.query("SELECT to_jsonb(j) - 'rental_charge' AS value FROM public.jobs j")).rows[0].value;
  assert.deepEqual(after,before);migrationHistoryPreserved=true;
}
async function seed(options = {}) {
  const [customer] = await db.insert(schema.customers).values({ name: "Synthetic owner", email: crypto.randomUUID()+"@example.invalid", skipPayment: options.skip ?? false, stripeCustomerId: "cus_fixture" }).returning();
  const [property] = await db.insert(schema.properties).values({ customerId: customer.id, address: "Synthetic home", bedCount: 3, bathCount: "2", sqFt: 1500, laundryType: "none", laundryLoads: null, hasHotTub: false, hotTubServiceLevel: false, hotTubDrain: false, petsAllowed: false, ...options.property }).returning();
  const [subscription] = await db.insert(schema.subscriptions).values({ customerId: customer.id, propertyId: property.id, durationMonths: options.months ?? 1, status: "active", startDate: "2030-01-01", endDate: "2031-01-01" }).returning();
  const issued = staffing.buildJobStaffingUpdate({ property, checkInTime: new Date("2030-01-29T14:00Z"), subscriptionStart: new Date("2030-01-01T14:00Z") }).addonsSnapshot;
  const job = await db.transaction(async tx => {
    const [created] = await tx.insert(schema.jobs).values({ subscriptionId: subscription.id, propertyId: property.id, calendarEventUid: crypto.randomUUID(), checkInTime: new Date("2030-01-29T14:00Z"), checkOutTime: new Date("2030-01-29T21:00Z"), status: "unassigned", addonsSnapshot: Object.hasOwn(options,"snapshot") ? options.snapshot : issued }).returning();
    if (options.enrolled) await tx.execute(orm.sql`insert into public.job_execution_contracts(job_id,protocol,terms) values(${created.id}, 'pre2c-hotfix-v1', '{"protocol":"pre2c-hotfix-v1"}'::jsonb)`);
    return created;
  });
  return { customer,property,subscription,job };
}
const stored = id => db.query.jobs.findFirst({ where: orm.eq(schema.jobs.id,id) });
function route(config = rules(), options = {}) {
  const attempts = [], intents = new Map(), redemptions = [], emails = [];
  const committedCharges = new Map();
  let failures = options.failAfterProvider ?? 0;
  let percent = options.promoPercent ?? 0;
  const calc = pricing(config);
  const fakeStripe = {
    paymentMethods: { list: async () => ({ data: [{ id: "pm_fixture" }] }) },
    paymentIntents: { create: async (input,opts) => {
      // Prove the quote is already committed, including the periodic fee.
      // Read receipts before entering the locked authorization transaction;
      // querying the single-session fixture here would deadlock that lock.
      assert.equal(committedCharges.get(input.metadata.jobId)?.chargeAmountCents,input.amount);
      attempts.push({ input: JSON.parse(JSON.stringify(input)), key: opts.idempotencyKey });
      const previous = intents.get(opts.idempotencyKey);
      if (previous) assert.equal(previous.input,JSON.stringify(input),"retry changed provider parameters");
      else intents.set(opts.idempotencyKey,{ input: JSON.stringify(input), id: "pi_"+crypto.randomUUID().replaceAll("-","") });
      if (failures-- > 0) throw Error("Synthetic connection loss after provider accepted request");
      return { id: intents.get(opts.idempotencyKey).id, amount: input.amount,
        currency: input.currency, status: "requires_capture" };
    } },
  };
  const file = "app/api/cron/pre-authorize/route.ts";
  const api = load(file, { ...emptyImports(file),
    "next/server": { NextResponse: { json: (body,init = {}) => ({ status: init.status ?? 200, json: async () => body }) } },
    "@/db": { db }, "@/db/schemas": schema, "drizzle-orm": orm,
    "@/lib/services/pricing.service": calc,
    "@/lib/pricing/rental-quote-refusal": refusal,
    "@/lib/pricing/rental-charge": charge,
    "@/lib/services/payment/freeze-rental-charge": { freezeRentalCharge: async (...args) => {
      const result = await freeze(...args);
      if (result) committedCharges.set(args[1],result);
      return result;
    } },
    "@/lib/services/payment/rental-authorization": authorization,
    "@/lib/stripe/get-stripe": { getStripe: () => fakeStripe },
    "@/lib/services/cancellation-detection/cancellationDetection.service": { CancellationDetectionService: class { async detectCancellationsForAllSubscriptions() { return { success: true,totalJobsCancelled: 0,totalSubscriptions: 0 }; } } },
    "@/lib/auth/cron-auth": { assertCronAuth: () => null },
    "@/lib/billing/customer-billing": { SKIPPED_PAYMENT_INTENT_ID: "skipped" },
    "@/lib/jobs/job-notes": pure("lib/jobs/job-notes.ts"),
    "@/lib/services/email.service": { sendPaymentFailedEmail: async v => emails.push(v) },
    "@/lib/services/promo-code.service": {
      resolvePromoCodeById: async (_id,amount) => ({ evaluation: promo.evaluatePromoCode(amount,{ code: "TEST",discountType: "percent",discountValue: percent,active: true,maxRedemptions: null,redemptionCount: 0,startsAt: null,expiresAt: null }) }),
      recordPromoRedemption: async v => redemptions.push(v),
    },
  });
  return { run: async (expectedCount = 1) => {
    for (const job of await db.query.jobs.findMany())
      if (job.rentalCharge) committedCharges.set(job.id,job.rentalCharge);
    const response=await api.POST({});const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));
    assert.equal(body.processedCount ?? 0,expectedCount,JSON.stringify(body));
    return body;
  }, attempts,intents,redemptions,emails,changePromo: value => { percent=value; } };
}
const due = { hasHotTub: true,hotTubServiceLevel: true,hotTubDrain: true,hotTubDrainCadence: "4_weeks" };
function customerPromos(options={}) {
  const file="lib/services/customer-promo.service.ts",codeId=crypto.randomUUID();
  const module=load(file,{...emptyImports(file),"@/db":{db},"@/db/schemas":schema,"drizzle-orm":orm,
    "@/lib/services/pricing.service":pricing(),"@/lib/pricing/rental-charge":charge,"@/lib/pricing/rental-quote-refusal":refusal,
    "@/lib/db/errors":pure("lib/db/errors.ts"),
    "@/lib/services/promo-code.service":{resolvePromoCodeForAmount:async(_raw,amount)=>{
      if(options.duringResolve)await options.duringResolve();
      return {promoCodeId:codeId,evaluation:promo.evaluatePromoCode(amount,{code:"TEST",discountType:"percent",discountValue:10,active:true,maxRedemptions:null,redemptionCount:0,startsAt:null,expiresAt:null})};
    }},
  });
  return {module,codeId};
}
let passed=0,failed=0;
async function test(name,fn) {
  await pg.exec("TRUNCATE jobs, subscriptions, properties, customers, cancelled_jobs CASCADE");
  try { await fn(); passed++; console.log("PASS "+name); }
  catch (e) { failed++; console.error("FAIL "+name+"\n"+e.stack); }
}
async function run() {
  await makeSchema();
  await test("0054 adds the nullable column without backfilling or changing history",async()=>{
    assert.equal(migrationHistoryPreserved,true);
    const columns=(await pg.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs' AND column_name='rental_charge'")).rows;
    assert.equal(columns[0].data_type,"jsonb");assert.equal(columns[0].is_nullable,"YES");
  });
  await test("string false hot-tub flags cannot opt into a fee", async () => {
    const api = load("app/api/pricing/route.ts", { "next/server": { NextResponse: { json: body => body } }, "@/lib/services/pricing.service": pricing(), "@/lib/validations/bookng-modal/serialize-signup-form": normalize });
    for (const value of [false,"false","FALSE","0","off",undefined]) {
      const q = await api.POST({ json: async () => ({ bedrooms: 1,bathrooms: 1,sqft: 500,laundryService: "none",hasHotTub: value,hotTubService: value,hotTubDrain: value }) });
      assert.equal(q.totalPerClean,105); assert.equal(q.periodicCharges.length,0);
    }
    for (const value of [true,"true","TRUE","1","on"]) assert.equal(normalize.normalizeSignupFormDataForPricing({hasHotTub:value}).hasHotTub,true);
  });
  await test("first-clean and extra-clean quotes refuse unsupported staffing", async () => {
    const calc = pricing();
    const file="lib/services/create-payment-intent.service.ts";
    const signup = load(file,{ ...emptyImports(file),"@/lib/services/pricing.service":calc,"@/lib/validations/bookng-modal/serialize-signup-form":normalize,"@/lib/pricing/rental-quote-refusal":refusal,"@/lib/pricing/first-clean-discount":{ getFirstCleanDiscountPercent:async()=>0,applyFirstCleanDiscount:v=>v } });
    const extraFile="lib/services/one-off.service.ts";
    const extra=load(extraFile,{...emptyImports(extraFile),"@/lib/services/pricing.service":calc,"@/lib/pricing/rental-quote-refusal":refusal},"\nexport {priceOneOffCents};");
    for(const [bedrooms,bathrooms,sqft] of [[5,5,900],[1,5,900],[6,1,1500],[3,2,3000]]) {
      assert.equal((await new calc.PricingService().calculatePrice({bedrooms,bathrooms,sqft,laundryService:"none"})).isCustomQuote,true);
      assert.equal((await signup.quoteFirstCleanChargeCents({bedrooms,bathrooms,sqft,laundryService:"none"})).ok,false);
      assert.equal((await extra.priceOneOffCents({serviceType:"vacation_rental_subscription",bedCount:bedrooms,bathCount:String(bathrooms),sqFt:sqft,laundryType:"none",laundryLoads:null,hasHotTub:false,hotTubServiceLevel:false,hotTubDrain:false,petsAllowed:false})).ok,false);
    }
  });
  for (const [name,property] of [["custom pricing",{sqFt:3000}],["custom staffing",{bedCount:5,bathCount:"5",sqFt:900}],["missing loads",{laundryType:"off_site",laundryLoads:null}],["unsupported laundry",{laundryType:"unknown"}]])
    await test("recurring refuses "+name+" before contacting provider",async()=>{
      const f=await seed({property}),r=route();await r.run();
      assert.equal(r.attempts.length,0);assert.equal((await stored(f.job.id)).paymentStatus,"failed");assert.equal(r.emails.length,0);
    });
  await test("empty pricing rules refuse a positive pet-only partial total",async()=>{
    await seed({property:{petsAllowed:true}});const config=rules();config.basePricingRules=[];
    const r=route(config);await r.run();assert.equal(r.attempts.length,0);assert.equal(r.emails.length,0);
  });
  for(const [name,options,amount] of [
    ["ordinary",{},23500],
    ["due drain",{property:due},30500],
    ["term discount excludes periodic fee",{property:due,months:6},26675],
    ["agreed override plus due fee",{property:{...due,priceOverrideCents:12345}},17345],
    ["non-due visit",{property:due,snapshot:{laundryType:"none",hotTubServiceLevel:"basic",hotTubDrainCadence:"4_weeks",teamSize:1}},25500],
    ["frozen no-service visit ignores later opt-in",{property:due,snapshot:{laundryType:"none",hotTubServiceLevel:"none",teamSize:1}},23500],
  ]) await test(name+" amount reconciles and is frozen before provider call",async()=>{
    const f=await seed(options),r=route();await r.run();assert.equal(r.attempts[0]?.input.amount,amount);
    const job=await stored(f.job.id),q=job.rentalCharge;
    assert.equal(q.amountCents,amount);assert.equal(q.perCleanCents+q.drainCents,amount);assert.equal(job.addonsSnapshot.teamSize,1);
  });
  await test("later property opt-out cannot remove issued drain service",async()=>{
    const f=await seed({property:due});await db.update(schema.properties).set({hasHotTub:false,hotTubServiceLevel:false,hotTubDrain:false,hotTubDrainCadence:null}).where(orm.eq(schema.properties.id,f.property.id));
    const r=route();await r.run();assert.equal(r.attempts[0]?.input.amount,30500);
  });
  await test("promo applies once to the full scheduled visit",async()=>{
    const f=await seed({property:due,months:6});await db.update(schema.jobs).set({promoCodeId:crypto.randomUUID()}).where(orm.eq(schema.jobs.id,f.job.id));
    const r=route(rules(),{promoPercent:10});await r.run();assert.equal(r.attempts[0]?.input.amount,24007);
    assert.equal(r.redemptions[0].originalAmountCents,26675);assert.equal(r.redemptions[0].discountAmountCents,2668);
    assert.equal((await stored(f.job.id)).rentalCharge.drainCents,5000);
  });
  await test("customer promo preview includes the same due fee as authorization",async()=>{
    const f=await seed({property:due}),p=customerPromos();
    const preview=await p.module.applyPromoCodeToJob(f.job.id,f.customer.id,"TEST");
    assert.equal(preview.estimatedDiscountCents,3050);assert.equal(preview.estimatedFinalAmountCents,27450);
    const r=route(rules(),{promoPercent:10});await r.run();assert.equal(r.attempts[0].input.amount,preview.estimatedFinalAmountCents);
    await assert.rejects(()=>p.module.removePromoCodeFromJob(f.job.id,f.customer.id),e=>e.status===400);
  });
  await test("frozen but not yet authorized quotes close promo edits",async()=>{
    const f=await seed({property:due}),p=customerPromos();
    await p.module.applyPromoCodeToJob(f.job.id,f.customer.id,"TEST");
    const price=await new(pricing().PricingService)().calculatePrice(charge.rentalJobPricingInput(f.property,1,f.job.addonsSnapshot));
    const q=charge.buildRentalCharge(price,f.job.addonsSnapshot,false);
    q.promo={promoCodeId:p.codeId,code:"TEST",discountAmountCents:3050};q.chargeAmountCents=27450;
    await freeze(db,f.job.id,q);
    await assert.rejects(()=>p.module.removePromoCodeFromJob(f.job.id,f.customer.id),e=>e.status===400);
    await assert.rejects(()=>p.module.applyPromoCodeToJob(f.job.id,f.customer.id,"OTHER"),e=>e.status===400);
    assert.equal((await stored(f.job.id)).promoCodeId,p.codeId);
  });
  await test("promo update loses safely when authorization freezes during resolution",async()=>{
    const f=await seed({property:due});
    const price=await new(pricing().PricingService)().calculatePrice(charge.rentalJobPricingInput(f.property,1,f.job.addonsSnapshot));
    const q=charge.buildRentalCharge(price,f.job.addonsSnapshot,false);
    const p=customerPromos({duringResolve:async()=>freeze(db,f.job.id,q)});
    await assert.rejects(()=>p.module.applyPromoCodeToJob(f.job.id,f.customer.id,"TEST"),e=>e.status===409);
    const job=await stored(f.job.id);assert.equal(job.promoCodeId,null);assert.equal(job.rentalCharge.chargeAmountCents,30500);
  });
  await test("freezing refuses a candidate priced before a newer promo edit",async()=>{
    const f=await seed();const price=await new(pricing().PricingService)().calculatePrice({bedrooms:3,bathrooms:2,sqft:1500,laundryService:"none"});const q=charge.buildRentalCharge(price,f.job.addonsSnapshot,false);
    await db.update(schema.jobs).set({promoCodeId:crypto.randomUUID()}).where(orm.eq(schema.jobs.id,f.job.id));
    await assert.rejects(()=>freeze(db,f.job.id,q),e=>e instanceof charge.RentalPricingError);
    assert.equal((await stored(f.job.id)).rentalCharge,null);
  });
  await test("owner/VIP skip keeps the valuation and never calls provider",async()=>{
    const f=await seed({property:due,skip:true}),r=route();await r.run();const job=await stored(f.job.id);
    assert.equal(r.attempts.length,0);assert.equal(job.paymentIntentId,"skipped");assert.equal(job.rentalCharge.amountCents,30500);assert.equal(job.rentalCharge.chargeAmountCents,0);
  });
  await test("missing configured drain fee refuses instead of undercharging",async()=>{
    await seed({property:due});const config=rules();config.hotTubPricingRules=config.hotTubPricingRules.filter(r=>r.serviceType!=="Full_Drain");
    const r=route(config);await r.run();assert.equal(r.attempts.length,0);assert.equal(r.emails.length,0);
  });
  await test("missing issued drain plan refuses instead of guessing",async()=>{
    await seed({property:due,snapshot:null});const r=route();await r.run();assert.equal(r.attempts.length,0);assert.equal(r.emails.length,0);
  });
  await test("retry preserves amount and promo after ambiguous provider result",async()=>{
    const f=await seed({property:due});await db.update(schema.jobs).set({promoCodeId:crypto.randomUUID()}).where(orm.eq(schema.jobs.id,f.job.id));
    const r=route(rules(),{promoPercent:10,failAfterProvider:1});await r.run();
    const first=await stored(f.job.id),frozen=first.rentalCharge;assert.equal(first.paymentStatus,"failed");
    await db.update(schema.properties).set({priceOverrideCents:99999,hotTubDrain:false}).where(orm.eq(schema.properties.id,f.property.id));
    r.changePromo(50);
    // Same operator retry used for a failed authorization; original contract survives.
    await db.update(schema.jobs).set({paymentStatus:null}).where(orm.eq(schema.jobs.id,f.job.id));
    await r.run();const final=await stored(f.job.id);
    assert.equal(r.attempts.length,2);assert.equal(r.intents.size,1);assert.equal(r.attempts[1].input.amount,27450);
    assert.deepEqual(final.rentalCharge,frozen);assert.equal(final.paymentStatus,"authorized");
    await r.run(0);assert.equal(r.attempts.length,2,"authorized job was processed again");
  });
  await test("row-locked quote keeps winner and unrelated snapshot fields",async()=>{
    const f=await seed(),price=await new(pricing().PricingService)().calculatePrice({bedrooms:3,bathrooms:2,sqft:1500,laundryService:"none"});
    const a=charge.buildRentalCharge(price,f.job.addonsSnapshot,false),b={...a,perCleanCents:30000,amountCents:30000,chargeAmountCents:30000};
    assert.deepEqual(await freeze(db,f.job.id,a),a);assert.deepEqual(await freeze(db,f.job.id,b),a);
    const job=await stored(f.job.id);assert.equal(job.addonsSnapshot.baseCleaningHours,f.job.addonsSnapshot.baseCleaningHours);
    await db.update(schema.jobs).set({status:"canceled"}).where(orm.eq(schema.jobs.id,f.job.id));assert.equal(await freeze(db,f.job.id,a),null);
  });
  await test("0052/0053 enrolled job freezes billing without changing issued inputs",async()=>{
    const f=await seed({property:due,enrolled:true}),before=await stored(f.job.id),r=route();await r.run();
    const final=await stored(f.job.id);assert.equal(r.attempts[0]?.input.amount,30500);
    assert.deepEqual(final.addonsSnapshot,before.addonsSnapshot);
    assert.equal(final.checkInTime.toISOString(),before.checkInTime.toISOString());
    await assert.rejects(db.update(schema.jobs).set({addonsSnapshot:{laundryType:"off_site"}}).where(orm.eq(schema.jobs.id,f.job.id)),e=>(e.cause?.message??e.message).includes("frozen"));
    await assert.rejects(db.update(schema.jobs).set({rentalCharge:null}).where(orm.eq(schema.jobs.id,f.job.id)),e=>(e.cause?.message??e.message).includes("immutable"));
  });
  await test("receipt guard rejects untrusted role even with workflow flag",async()=>{
    const f=await seed();await pg.exec("GRANT SELECT,UPDATE ON public.jobs TO authenticated");
    const price=await new(pricing().PricingService)().calculatePrice({bedrooms:3,bathrooms:2,sqft:1500,laundryService:"none"});const q=charge.buildRentalCharge(price,f.job.addonsSnapshot,false);
    await assert.rejects(db.transaction(async tx=>{
      await tx.execute(orm.sql`set local role authenticated`);
      await tx.execute(orm.sql`select set_config('cleannami.rental_charge_freeze','v1',true)`);
      await tx.update(schema.jobs).set({rentalCharge:q}).where(orm.eq(schema.jobs.id,f.job.id));
    }),e=>(e.cause?.message??e.message).includes("server billing workflow"));
    assert.equal((await stored(f.job.id)).rentalCharge,null);
  });
  await test("migration reapply preserves recorded charges and existing job values",async()=>{
    const f=await seed({property:due}),r=route();await r.run();const before=await stored(f.job.id);
    await pg.exec(fs.readFileSync(path.join(root,"db/supabase/migrations/0054_rental_charge_receipts.sql"),"utf8"));
    assert.deepEqual(await stored(f.job.id),before);
  });
  await test("legacy calendar archive retains the frozen billing receipt",async()=>{
    const f=await seed({property:due}),r=route();await r.run();const original=await stored(f.job.id);
    const file="lib/services/cancellation-detection/cancellationDetection.service.ts";
    const module=load(file,{...emptyImports(file),"@/db":{schema},"@/db/schemas":schema,"drizzle-orm":orm,"@/lib/services/job-execution-contract":{getExecutionContract:async()=>null}});
    const service=new module.CancellationDetectionService(db);
    await service._processSingleCancellation(original);
    assert.equal(await stored(f.job.id),undefined);
    const archived=await db.query.cancelledJobs.findFirst({where:orm.eq(schema.cancelledJobs.originalJobId,f.job.id)});
    assert.deepEqual(archived.addonsSnapshot.rentalCharge,original.rentalCharge);
    assert.equal(archived.addonsSnapshot.hotTubServiceLevel,"deep_clean");
  });
  await test("corrupt frozen charge fails closed",async()=>{
    const f=await seed(),r=route();
    // A privileged broken writer can satisfy the SQL version marker without
    // valid economics; the application must still refuse the receipt.
    await db.transaction(async tx=>{await tx.execute(orm.sql`select set_config('cleannami.rental_charge_freeze','v1',true)`);await tx.update(schema.jobs).set({rentalCharge:{version:"rental-charge-v1"}}).where(orm.eq(schema.jobs.id,f.job.id));});
    await r.run();
    assert.equal(r.attempts.length,0);assert.equal(r.emails.length,0);assert.equal((await stored(f.job.id)).paymentStatus,"failed");
    assert.throws(()=>charge.readRentalCharge({version:"unknown"}));
    assert.equal(charge.readRentalCharge(null),null);
  });
  await test("legacy null snapshot freezes without inventing add-on values",async()=>{
    const f=await seed({snapshot:null}),r=route();await r.run();const job=await stored(f.job.id);
    assert.equal(r.attempts[0]?.input.amount,23500);assert.equal(job.addonsSnapshot,null);assert.equal(job.rentalCharge.amountCents,23500);
  });
  await test("completed captured history is untouched",async()=>{
    const f=await seed({property:due});await db.update(schema.jobs).set({status:"completed",paymentStatus:"captured",paymentIntentId:"pi_historical"}).where(orm.eq(schema.jobs.id,f.job.id));
    const before=await stored(f.job.id),r=route();await r.run(0);assert.equal(r.attempts.length,0);assert.deepEqual(await stored(f.job.id),before);
  });
  // Phase2C records skipped assignment runs in its audit tables; the isolated
  // zero-database adapter is specific to the earlier main-only assignment path.
  if(tree===root && !fs.existsSync(path.join(tree,"db/schemas/phase2c.schema.ts"))) await test("automatic assignment skips manual staffing before database access",async()=>{
    const file="lib/services/assignment/assignment-engine.service.ts";
    const module=load(file,{...emptyImports(file)});
    for(const addonsSnapshot of [{requiresManualStaffing:true},{teamSize:null}]) {
      const result=await module.assignJob({id:crypto.randomUUID(),propertyId:crypto.randomUUID(),checkInTime:new Date("2030-01-29T14:00Z"),addonsSnapshot});
      assert.equal(result.status,"skipped");assert.equal(result.reason,"manual_staffing_required");
    }
  });
  await test("individual pay rounds half-up and retains lateness/bonus rules",async()=>{
    const input={expectedHours:1.37,hourlyRateCents:2150,role:"primary",urgentBonus:true};
    assert.equal(pay.computeCleanerPay(input).total.toFixed(2),"39.46");
    assert.equal(pay.computeCleanerPay({...input,arrivalDelayMinutes:30}).total.toFixed(2),"24.46");
    assert.equal(pay.computeCleanerPay({...input,arrivalDelayMinutes:60}).total.toFixed(2),"10.00");
    assert.equal(pay.computeCleanerPay({...input,role:"laundry_lead",laundryLoads:3}).total.toFixed(2),"54.46");
    assert.equal(pay.computeCleanerPay({...input,hourlyRateCents:1700,urgentBonus:false}).total.toFixed(2),"23.29");
    const {hourlyPayCents}=pure("lib/pricing/hourly-pay-cents.ts");
    assert.equal(hourlyPayCents(0.005,100),1);assert.equal(hourlyPayCents(1e-7,100),0);
    assert.throws(()=>hourlyPayCents(NaN,1700));assert.throws(()=>hourlyPayCents(-1,1700));
  });
  if (process.argv.includes("--money-fixes")) await require("./test-payment-reconciliation.cjs").verify({
    db,pg,schema,orm,load,emptyImports,pure,seed,stored,pricing,rules,freeze,charge,refusal,pay,promo,
    authorization,verifyPayment,route,test,root,tree,Clock,setNow:v=>{now=Date.parse(v)},
  });
  console.log(JSON.stringify({tree:tree===root?"main":"phase2c",passed,failed,boundary:"Actual service/route source and Drizzle SQL against single-session PGlite. Only providers/Auth/delivery controlled. No network or live business writes."}));
  await pg.close();if(failed)process.exitCode=1;
}
run().catch(async e=>{console.error(e.stack);await pg.close();process.exitCode=1;});
