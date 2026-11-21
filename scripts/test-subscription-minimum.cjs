// Synthetic PostgreSQL and controlled provider adapters; never load root env.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
for (const key of Object.keys(process.env)) if (/database|postgres|supabase|stripe|resend|twilio|vapid|subscription_minimum|subscription_term|admin_sms/i.test(key)) delete process.env[key];
process.env.TSX_TSCONFIG_PATH = path.join(root, 'tsconfig.json');
require('tsx/cjs');
const Module = require('node:module'), originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'server-only') return {};
  if (['dotenv', 'postgres'].includes(name)) throw Error('Uncontrolled environment/database import: ' + name);
  return originalLoad.call(this, name, ...args);
};
global.fetch = async () => { throw Error('Network prohibited'); };
for (const name of ['node:http','node:https']) { const network = require(name); network.request = network.get = () => { throw Error('Network prohibited'); }; }
require('node:net').Socket.prototype.connect = function() { throw Error('Network prohibited'); };
const { PGlite } = require('@electric-sql/pglite'), { drizzle } = require('drizzle-orm/pglite');
const { PgTable, PgDialect, getTableConfig, isPgEnum } = require('drizzle-orm/pg-core');
const { is, SQL, eq } = require('drizzle-orm');
const schema = require('../db/schema.ts'), pg = new PGlite(), db = drizzle(pg, { schema });
function replace(file, exports) { const name = require.resolve(path.join(root,file)); require.cache[name] = { id:name,filename:name,loaded:true,exports }; }
replace('db/index.ts', { db, getDbOrNull: () => db, schema });
const intents = new Map(), requests = [], charges = [], refundRows = [], keys = new Map();
let price = 200, loseIntentResponse = false;
const stripe = { customers: { list: async () => ({data:[]}), create: async () => ({id:'cus_'+crypto.randomUUID()}),retrieve:async id=>({id}),update:async id=>({id}) },
  paymentIntents: { create: async (input, options) => {
    requests.push(input);
    if(keys.has(options.idempotencyKey)) return intents.get(keys.get(options.idempotencyKey));
    const id = 'pi_' + crypto.randomUUID(); keys.set(options.idempotencyKey,id);
    const pi = { ...input,id,client_secret:'synthetic_secret',status:'succeeded',amount_received:input.amount };
    pi.latest_charge = { id:'ch_'+id,payment_intent:id,currency:'usd',amount:input.amount,amount_refunded:0,refunded:false,paid:true,captured:true,created:Math.floor(Date.now()/1000) };
    intents.set(id,pi); charges.push(id);
    if(loseIntentResponse){loseIntentResponse=false;throw Error('Synthetic lost intent response');}
    return pi;
  }, retrieve: async id => { assert.ok(intents.has(id));return intents.get(id); },cancel:async id=>{intents.get(id).status='canceled';return intents.get(id);} },
  charges: { retrieve: async id => [...intents.values()].find(pi=>pi.latest_charge.id===id)?.latest_charge },
  refunds: { list: async input => ({ data:refundRows.filter(refund=>refund.payment_intent===input.payment_intent),has_more:false }) } };
replace('lib/stripe/get-stripe.ts', { getStripe: () => stripe });
replace('lib/services/pricing.service.ts', { PricingService: class { async calculatePrice() { return {totalPerClean:price,discountRate:0,discountAmount:0}; } } });
replace('lib/pricing/first-clean-discount.ts', { getFirstCleanDiscountPercent:async()=>0,applyFirstCleanDiscount:amount=>amount });
replace('lib/services/google-maps/geocoding.ts', { geocodeAddressResult:async()=>({status:'ok',coordinates:{latitude:28,longitude:-81}}) });
replace('lib/google-maps/serviceArea/index.ts', { isPointInServiceArea:()=>true });
replace('lib/services/promo-code.service.ts', { recordPromoRedemptionByCode:async()=>{} });
replace('lib/services/iCal/ical.service.ts', { ICalService: class { async syncCalendar() {} } });
replace('lib/services/auth/customer-account.service.ts', { inviteCustomerToPortalAfterPayment:async()=>({success:true,emailSent:false}) });
replace('lib/services/email.service.ts', { sendBookingConfirmationEmail:async()=>{},sendCancellationEmail:async()=>{} });
replace('lib/supabase/server.ts', { createAdminClient:()=>{throw Error('Unexpected Storage/Auth access');} });
const minimum = require('../lib/subscriptions/minimum.ts'), rules = require('../lib/cancellation/rules.ts');
const service = require('../lib/services/subscription-minimum.service.ts');
const checkout = require('../lib/services/create-payment-intent.service.ts');
const onboarding = require('../lib/services/complete-onboarding.service.ts');
let passed = 0;
async function test(name,run) { await run(); passed++; console.log('PASS '+name); }
async function setup() {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  const dialect = new PgDialect(), tables = new Map(), enums = new Map();
  for (const value of Object.values(schema)) {
    if (isPgEnum(value)) enums.set(value.enumName,value.enumValues);
    if (is(value,PgTable)) { const table = getTableConfig(value); tables.set(table.name,table); for(const column of table.columns) if(column.enum?.enumName) enums.set(column.enum.enumName,column.enum.enumValues); }
  }
  for (const [name,values] of enums) await pg.exec(`CREATE TYPE "${name}" AS ENUM (${values.map(value=>`'${value}'`).join(',')})`);
  for (const table of tables.values()) {
    if (['subscription_minimums','rental_checkout_attempts','payout_transfer_attempts','stripe_webhook_claims'].includes(table.name)) continue; // Actual migrations below.
    const columns = table.columns.map(column=>{
      const value=column.default;
      const def=value===undefined?'':' DEFAULT '+(is(value,SQL)?dialect.sqlToQuery(value).sql:typeof value==='string'?`'${value.replaceAll("'","''")}'`:typeof value==='object'?`'${JSON.stringify(value)}'`:JSON.stringify(value));
      return `"${column.name}" ${column.getSQLType()}${column.primary?' PRIMARY KEY':''}${column.notNull?' NOT NULL':''}${column.isUnique?' UNIQUE':''}${def}`;
    });
    for(const pk of table.primaryKeys) columns.push(`PRIMARY KEY (${pk.columns.map(c=>`"${c.name}"`).join(',')})`);
    await pg.exec(`CREATE TABLE "${table.name}" (${columns.join(',')})`);
  }
  await pg.exec(fs.readFileSync(path.join(root,'db/supabase/migrations/0066_money_recovery.sql'),'utf8'));
  await pg.exec('CREATE UNIQUE INDEX processed_stripe_events_event_id_key ON processed_stripe_events(event_id); CREATE UNIQUE INDEX payouts_job_cleaner_key ON payouts(job_id,cleaner_id);');
  process.env.MONEY_RECOVERY_SCHEMA_READY='true';
  process.env.PAYOUT_TRANSFER_ROLLOUT_AT='2020-01-01T00:00:00Z';
}
function form() {
  const email=crypto.randomUUID()+'@example.invalid';
  return {name:'Synthetic Owner',email,emailConfirm:email,phoneNumber:'2025550123',address:'Synthetic test property',isAddressInServiceArea:true,
    sqft:1000,bedrooms:2,bathrooms:1,useDefaultChecklist:true,laundryService:'none',hasHotTub:false,hotTubService:false,hotTubDrain:false,
    subscriptionMonths:1,defaultCheckInTime:'16:00:00',defaultCheckOutTime:'10:00:00',iCalUrl:'https://calendar.example.invalid/synthetic.ics',firstCleanDate:new Date(Date.now()+14*86400000)};
}
async function paid(input=form()) {
  const result=await checkout.createPaymentIntentForSignup(input); assert.ok(result.clientSecret,JSON.stringify(result));
  return {input,pi:intents.get(charges.at(-1)),result};
}
async function complete(payment) { const result=await onboarding.completeOnboardingForPayment(payment.input,payment.pi.id); assert.equal(result.success,true,JSON.stringify(result)); return result.data.subscription.id; }
async function sub(id) { return (await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id,id)))[0]; }
async function run() {
  await setup();
  await test('30 service-day boundaries handle month ends, leap years and DST independently of host timezone',()=>{
    for (const timezone of ['UTC','America/New_York','Asia/Kolkata']) {
      process.env.TZ=timezone;
      for(const [start,end] of [['2027-01-31','2027-03-02T05:00:00.000Z'],['2028-01-31','2028-03-01T05:00:00.000Z'],['2027-03-01','2027-03-31T04:00:00.000Z'],['2026-10-15','2026-11-14T05:00:00.000Z']]) {
        const value=minimum.thirtyDayMinimum(start); assert.equal(value.endsAt,end);
        assert.equal(rules.canCancelSubscription({startDate:start,status:'active',cancellationMinimum:value},new Date(Date.parse(end)-1)).allowed,false);
        assert.equal(rules.canCancelSubscription({startDate:start,status:'active',cancellationMinimum:value},new Date(end)).allowed,true);
      }
    }
    process.env.TZ='UTC'; assert.throws(()=>minimum.thirtyDayMinimum('2027-02-30'),/Invalid/);
    assert.throws(()=>minimum.withinSubscriptionMinimum({policy:'unknown',endsAt:'2027-01-01'}),/Invalid/);
  });
  let oldId, currentId;
  await test('disabled rollout works without the new table and accepted legacy payments stay legacy after enrollment',async()=>{
    const old=await paid(); assert.equal(old.pi.metadata.subscription_minimum_policy,undefined);
    oldId=await complete(old);
    assert.equal((await service.withSubscriptionMinimums([await sub(oldId)]))[0].cancellationMinimum.policy,minimum.LEGACY_MONTH_MINIMUM);
  });
  await test('actual migration reapplies privately with no historical enrollment',async()=>{
    const sql=fs.readFileSync(path.join(root,'db/supabase/migrations/0063_subscription_minimum_contracts.sql'),'utf8');await pg.exec(sql);await pg.exec(sql);
    assert.equal((await db.select().from(schema.subscriptionMinimums)).length,0);
    assert.equal((await pg.query("select relrowsecurity v from pg_class where oid='subscription_minimums'::regclass")).rows[0].v,true);
    for(const role of ['anon','authenticated']) assert.equal((await pg.query(`select has_table_privilege('${role}','subscription_minimums','SELECT,INSERT,UPDATE,DELETE') v`)).rows[0].v,false);
    process.env.SUBSCRIPTION_MINIMUM_SCHEMA_READY='true';process.env.SUBSCRIPTION_MINIMUM_ENROLLMENT='true';
  });
  await test('enrollment is pinned on the actual payment and recovery persists it after enrollment is disabled',async()=>{
    const payment=await paid({...form(),subscription_minimum_policy:'attacker_policy'});
    assert.equal(payment.pi.metadata.subscription_minimum_policy,minimum.THIRTY_DAY_MINIMUM);assert.equal(payment.result.minimumCommitmentPolicy,minimum.THIRTY_DAY_MINIMUM);
    delete process.env.SUBSCRIPTION_MINIMUM_ENROLLMENT;
    currentId=await complete(payment);const current=await sub(currentId);
    const [saved]=await db.select().from(schema.subscriptionMinimums).where(eq(schema.subscriptionMinimums.subscriptionId,currentId));
    assert.equal(saved.paymentIntentId,payment.pi.id);assert.equal(saved.startDate,current.startDate);assert.equal(saved.endsAt.toISOString(),minimum.thirtyDayMinimum(current.startDate).endsAt);
    assert.equal(await complete(payment),currentId);assert.equal((await db.select().from(schema.subscriptionMinimums)).length,1);
  });
  await test('legacy payment accepted before the flag change is not upgraded during setup',async()=>{
    const payment=await paid();process.env.SUBSCRIPTION_MINIMUM_ENROLLMENT='true';const id=await complete(payment);
    assert.equal((await db.select().from(schema.subscriptionMinimums).where(eq(schema.subscriptionMinimums.subscriptionId,id))).length,0);
  });
  await test('a missing readiness flag cannot silently downgrade accepted new terms; setup rolls back and can recover',async()=>{
    const payment=await paid();delete process.env.SUBSCRIPTION_MINIMUM_SCHEMA_READY;
    const failed=await onboarding.completeOnboardingForPayment(payment.input,payment.pi.id);assert.equal(failed.success,false);assert.match(failed.error,/schema is not ready/);
    assert.equal((await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.firstCleanPaymentId,payment.pi.id))).length,0);
    process.env.SUBSCRIPTION_MINIMUM_SCHEMA_READY='true';await complete(payment);
  });
  await test('immutable DB contracts reject altered provenance, duplicate payment and wrong minimum boundary',async()=>{
    await assert.rejects(()=>db.update(schema.subscriptionMinimums).set({policy:minimum.LEGACY_MONTH_MINIMUM}).where(eq(schema.subscriptionMinimums.subscriptionId,currentId)));
    const old=await sub(oldId),current=await sub(currentId);
    await assert.rejects(()=>service.recordSubscriptionMinimum(db,{...old,firstCleanPaymentId:current.firstCleanPaymentId},minimum.THIRTY_DAY_MINIMUM));
    await assert.rejects(()=>db.insert(schema.subscriptionMinimums).values({subscriptionId:old.id,policy:minimum.THIRTY_DAY_MINIMUM,startDate:old.startDate,endsAt:new Date(),paymentIntentId:old.firstCleanPaymentId}));
    await assert.rejects(()=>service.recordSubscriptionMinimum(db,old,'future_unknown_policy'),/Unsupported/);
  });
  await test('scoped listing returns the recorded rule and customer cancellation enforces it before any job/payment work',async()=>{
    const current=await sub(currentId),queries=require('../lib/queries/subscriptions.ts');
    const result=await queries.getSubscriptionsWithDetails({customerId:current.customerId});assert.equal(result.data.length,1);assert.equal(result.data[0].cancellationMinimum.policy,minimum.THIRTY_DAY_MINIMUM);
    const cancellation=require('../lib/services/customer-cancellation.service.ts'),before=charges.length;
    await assert.rejects(()=>cancellation.cancelSubscriptionForCustomer(currentId,current.customerId),/30-day minimum/);
    await assert.rejects(()=>cancellation.cancelSubscriptionForCustomer(currentId,crypto.randomUUID()),/Forbidden/);
    assert.equal(charges.length,before);assert.equal((await sub(currentId)).status,'active');
  });
  await test('the subscription minimum does not alter individual-job cancellation/late-fee eligibility',()=>{
    const assignments=[{role:'primary'}],job={status:'assigned',checkInTime:new Date(Date.now()+30*60000)};
    const subscription={status:'active',startDate:'2026-01-01'};
    assert.deepEqual(rules.canCancelJob({...subscription,cancellationMinimum:minimum.thirtyDayMinimum('2099-01-01')},job,assignments),rules.canCancelJob(subscription,job,assignments));
  });
  await test('term-end purchase policy pins before payment and recovers after new enrollment stops; old purchases remain unmarked',async()=>{
    await pg.exec('DROP TABLE subscription_term_contracts');
    await pg.exec(fs.readFileSync(path.join(root,'db/supabase/migrations/0065_subscription_term_end_contracts.sql'),'utf8'));
    const term=require('../lib/services/subscription-term.service.ts');
    Object.assign(process.env,{SUBSCRIPTION_TERM_SCHEMA_READY:'true',SUBSCRIPTION_TERM_ENROLLMENT:'true',SUBSCRIPTION_MINIMUM_ENROLLMENT:'true'});
    const payment=await paid();assert.equal(payment.pi.metadata.subscription_term_end_policy,term.STOP_AT_TERM_END);
    assert.equal(payment.result.termEndPolicy,term.STOP_AT_TERM_END);delete process.env.SUBSCRIPTION_TERM_ENROLLMENT;
    const id=await complete(payment);assert.equal((await term.readSubscriptionTerm(id)).paymentIntentId,payment.pi.id);
    const old=await paid();process.env.SUBSCRIPTION_TERM_ENROLLMENT='true';const oldId=await complete(old);assert.equal(await term.readSubscriptionTerm(oldId),null);
  });
  await test('accepted term setup fails atomically without readiness and recovers the same payment once readiness returns',async()=>{
    const payment=await paid();delete process.env.SUBSCRIPTION_TERM_SCHEMA_READY;
    const failed=await onboarding.completeOnboardingForPayment(payment.input,payment.pi.id);assert.equal(failed.success,false);assert.match(failed.error,/Accepted subscription term/);
    assert.equal((await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.firstCleanPaymentId,payment.pi.id))).length,0);
    process.env.SUBSCRIPTION_TERM_SCHEMA_READY='true';assert.equal(await complete(payment),await complete(payment));
  });
  for (const refundState of ['succeeded','pending','partial']) await test(`signup refuses ${refundState} refund before creating a prepaid subscription`,async()=>{
    const payment=await paid(),amount=refundState==='partial'?payment.pi.amount/2:payment.pi.amount;
    if(refundState!=='pending'){payment.pi.latest_charge.amount_refunded=amount;payment.pi.latest_charge.refunded=refundState!=='partial';}
    refundRows.push({id:'re_'+crypto.randomUUID(),payment_intent:payment.pi.id,charge:payment.pi.latest_charge.id,currency:'usd',amount,status:refundState==='partial'?'succeeded':refundState});
    const result=await onboarding.completeOnboardingForPayment(payment.input,payment.pi.id);
    assert.equal(result.success,false);assert.match(result.error,/review|refund/);
    assert.equal((await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.firstCleanPaymentId,payment.pi.id))).length,0);
  });
  await test('signup refuses incomplete collected funds despite a succeeded status',async()=>{
    const payment=await paid();payment.pi.amount_received=payment.pi.amount-1;
    assert.equal((await onboarding.completeOnboardingForPayment(payment.input,payment.pi.id)).success,false);
    assert.equal((await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.firstCleanPaymentId,payment.pi.id))).length,0);
  });
  console.log(`${passed} subscription-minimum/term checks passed; synthetic PostgreSQL, blocked network, controlled providers. No credit or fee lifecycle enabled.`);
}
module.exports={setup,pg,db,schema,stripe,intents,requests,charges,refundRows,keys,form,paid,complete,sub,replace,
  setPrice:value=>{price=value;},loseNextIntent:()=>{loseIntentResponse=true;}};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>pg.close());
