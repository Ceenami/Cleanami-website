// Real services + actual SQL0066 in in-process PostgreSQL. Harness blocks all
// network/env loading; Stripe, Auth and delivery adapters are controlled.
const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const h = require('./test-subscription-minimum.cjs');
const {db,pg,schema,stripe,form,paid,complete,intents,charges,replace} = h;
const {eq} = require('drizzle-orm');
const checkout = require('../lib/services/create-payment-intent.service.ts');
const onboarding = require('../lib/services/complete-onboarding.service.ts');
const payoutService = require('../lib/services/payment/payout-transfer.service.ts');
const dedupe = require('../lib/services/stripe/event-dedupe.ts');
let passed=0;
async function test(name,run){await run();passed++;console.log('PASS '+name);}
async function migration(){await pg.exec(fs.readFileSync(path.join(__dirname,'../db/supabase/migrations/0066_money_recovery.sql'),'utf8'));}
async function payoutFixture(options={}){
  const payment=await paid(),id=await complete(payment),subscription=await h.sub(id);
  const [cleaner]=await db.insert(schema.cleaners).values({fullName:'Synthetic Worker',email:crypto.randomUUID()+'@example.invalid',stripeAccountId:'acct_'+crypto.randomUUID()}).returning();
  const [job]=await db.insert(schema.jobs).values({propertyId:subscription.propertyId,subscriptionId:subscription.id,status:'completed',paymentIntentId:payment.pi.id,calendarEventUid:crypto.randomUUID()}).returning();
  const [payout]=await db.insert(schema.payouts).values({jobId:job.id,cleanerId:cleaner.id,amount:'100.00',...options}).returning();
  return {payout,job,cleaner,payment,subscription};
}
async function payout(id){return (await db.select().from(schema.payouts).where(eq(schema.payouts.id,id)))[0];}
function transferProvider({lost=false,mismatch=false}={}){
  const keys=new Map(),calls=[];
  return {keys,calls,transfers:{create:async(params,opts)=>{
    calls.push({params:structuredClone(params),key:opts.idempotencyKey});
    if(!keys.has(opts.idempotencyKey))keys.set(opts.idempotencyKey,{...params,id:'tr_'+crypto.randomUUID(),reversed:false,amount:params.amount+(mismatch?1:0)});
    if(lost){lost=false;throw Error('Synthetic response lost after transfer acceptance');}
    return keys.get(opts.idempotencyKey);
  },retrieve:async id=>{const value=[...keys.values()].find(t=>t.id===id);assert.ok(value);return value;}}};
}
const event=(id=crypto.randomUUID())=>({id:'evt_'+id,type:'charge.dispute.created',created:Math.floor(Date.now()/1000),data:{object:{id:'dp_fixture',status:'needs_response',amount:10000}}});
async function run(){
  await h.setup();
  await test('invalid payment request JSON returns400 before any provider request',async()=>{
    const route=require('../app/api/payment/create-intent/route.ts'),before=h.requests.length;
    for(const body of ['{','', 'null', '[]', '{}', '{"formData":null}']) {
      const response=await route.POST(new Request('https://test.invalid/api/payment/create-intent',{
        method:'POST',headers:{'Content-Type':'application/json'},body,
      }));
      assert.equal(response.status,400);
      assert.equal((await response.json()).error,'Invalid payment request.');
    }
    assert.equal(h.requests.length,before);
  });
  await test('fresh signup refuses unpersistable or invalid booking fields before payment creation',async()=>{
    const before=h.requests.length;
    for(const patch of [{bedrooms:1.5},{bathrooms:1.5},{sqft:1000.5},{subscriptionMonths:1.5},
      {emailConfirm:'different@example.invalid'},{defaultCheckInTime:'broken'},{iCalUrl:'broken'},
      {name:''},{email:{}},{address:[]}]) {
      const result=await checkout.createPaymentIntentForSignup({...form(),...patch});
      assert.equal(typeof result.error,'string',JSON.stringify(patch));
      assert.equal(result.clientSecret,undefined);
    }
    assert.equal(h.requests.length,before);
  });
  await test('SQL0066 reapplies, enables RLS, revokes public roles and enrolls no historical money',async()=>{
    await migration();
    for(const table of ['rental_checkout_attempts','payout_transfer_attempts','stripe_webhook_claims']){
      assert.equal((await pg.query(`select relrowsecurity v from pg_class where oid='${table}'::regclass`)).rows[0].v,true);
      for(const role of ['anon','authenticated'])assert.equal((await pg.query(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE') v`)).rows[0].v,false);
      assert.equal((await pg.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
    }
  });
  await test('identical signup retries return one payment even when its provider key would have expired',async()=>{
    const payment=await paid(),before=charges.length,now=Date.now;
    try{Date.now=()=>now()+30*3600000;const result=await checkout.createPaymentIntentForSignup(payment.input);assert.equal(result.clientSecret,payment.result.clientSecret);assert.equal(charges.length,before);}
    finally{Date.now=now;}
    assert.equal((await db.select().from(schema.rentalCheckoutAttempts)).length,1);
  });
  await test('lost signup create response retries the same persisted identity and immutable parameters',async()=>{
    const input=form(),before=charges.length;h.loseNextIntent();
    await assert.rejects(()=>checkout.createPaymentIntentForSignup(input),/lost intent/);
    h.setPrice(350);
    const recovered=await checkout.createPaymentIntentForSignup(input);assert.ok(recovered.clientSecret);assert.equal(recovered.amountInCents,20000);assert.equal(charges.length,before+1);
    h.setPrice(200);
  });
  await test('unknown unbound signup older than safe retry window refuses a second provider POST',async()=>{
    const input=form();h.loseNextIntent();await assert.rejects(()=>checkout.createPaymentIntentForSignup(input));const before=h.requests.length,now=Date.now;
    try{Date.now=()=>now()+25*3600000;await assert.rejects(()=>checkout.createPaymentIntentForSignup(input),/outcome needs review/);assert.equal(h.requests.length,before);}
    finally{Date.now=now;}
  });
  await test('paid signup completes at accepted price after live pricing changes',async()=>{
    const payment=await paid();h.setPrice(250);const id=await complete(payment);assert.equal((await h.sub(id)).firstCleanPaymentId,payment.pi.id);h.setPrice(200);
  });
  await test('paid recovery survives elapsed seven-day sale notice without changing the booked start',async()=>{
    const payment=await paid(),RealDate=Date,now=Date.now();
    global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now+10*86400000]));}static now(){return now+10*86400000;}};
    try{assert.equal(require('../lib/validations/bookng-modal/index.ts').signupFormSchema.safeParse(payment.input).success,false);const id=await complete(payment);assert.equal((await h.sub(id)).startDate,payment.input.firstCleanDate.toISOString().slice(0,10));}
    finally{global.Date=RealDate;}
  });
  await test('paid scope swapping cannot mint a larger property, different term or different first date',async()=>{
    const payment=await paid();
    for(const change of [{bedrooms:5},{subscriptionMonths:6},{petsAllowed:true},{firstCleanDate:new Date(Date.now()+21*86400000)}]){
      const result=await onboarding.completeOnboardingForPayment({...payment.input,...change},payment.pi.id);assert.equal(result.success,false);assert.match(result.error,/scope changed/);
    }
    assert.equal((await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.firstCleanPaymentId,payment.pi.id))).length,0);
    await complete(payment);
  });
  await test('changed unpaid checkout cancels its predecessor before issuing a new generation',async()=>{
    const payment=await paid();payment.pi.status='requires_payment_method';const before=charges.length;
    const result=await checkout.createPaymentIntentForSignup({...payment.input,bedrooms:3});assert.ok(result.clientSecret);assert.equal(payment.pi.status,'canceled');assert.equal(charges.length,before+1);
  });
  await test('changed paid or processing checkout cannot create another payment',async()=>{
    for(const status of ['succeeded','processing']){const payment=await paid();payment.pi.status=status;const before=charges.length;await assert.rejects(()=>checkout.createPaymentIntentForSignup({...payment.input,bedrooms:3}),/already started/);assert.equal(charges.length,before);}
  });
  await test('access codes stay out of snapshots and Stripe while persisting only on the property',async()=>{
    const payment=await paid({...form(),entryMethod:'lockbox',entryInstructions:'PRIVATE-DOOR-987',parkingInstructions:'PRIVATE-PARK-654'}),id=await complete(payment),subscription=await h.sub(id);
    const attempts=await db.select().from(schema.rentalCheckoutAttempts);assert.ok(!JSON.stringify(attempts).includes('PRIVATE-'));
    assert.ok(!JSON.stringify(h.requests).includes('PRIVATE-'));
    const [property]=await db.select().from(schema.properties).where(eq(schema.properties.id,subscription.propertyId));assert.equal(property.entryInstructions,'PRIVATE-DOOR-987');
  });
  await test('SQL prevents accepted scope, amount, provider identity and payout parameters from changing',async()=>{
    const payment=await paid(),attempt=(await db.select().from(schema.rentalCheckoutAttempts).where(eq(schema.rentalCheckoutAttempts.paymentIntentId,payment.pi.id)))[0];
    await assert.rejects(()=>db.update(schema.rentalCheckoutAttempts).set({terms:{...attempt.terms,form:{}}}).where(eq(schema.rentalCheckoutAttempts.id,attempt.id)),/Failed query/);
    await assert.rejects(()=>db.update(schema.rentalCheckoutAttempts).set({paymentIntentId:'pi_other'}).where(eq(schema.rentalCheckoutAttempts.id,attempt.id)));
  });
  await test('legacy unmarked paid intents retain the historical completion path',async()=>{
    const payment=await paid();delete payment.pi.metadata.rental_checkout_attempt_id;
    delete process.env.MONEY_RECOVERY_SCHEMA_READY;try{await complete(payment);}finally{process.env.MONEY_RECOVERY_SCHEMA_READY='true';}
  });
  await test('readiness and payout cutover fail closed before money requests',async()=>{
    delete process.env.MONEY_RECOVERY_SCHEMA_READY;const before=charges.length;
    await assert.rejects(()=>checkout.createPaymentIntentForSignup(form()),/schema is not ready/);assert.equal(charges.length,before);
    process.env.MONEY_RECOVERY_SCHEMA_READY='true';delete process.env.PAYOUT_TRANSFER_ROLLOUT_AT;
    await assert.rejects(()=>payoutService.processPayoutTransfer(transferProvider(),crypto.randomUUID()),/cutover/);
    process.env.PAYOUT_TRANSFER_ROLLOUT_AT='2020-01-01T00:00:00Z';
  });
  await test('ordinary payout dispatch and repeated cron processing create exactly one transfer',async()=>{
    const f=await payoutFixture(),p=transferProvider();assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'released');
    assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'skipped');assert.equal(p.keys.size,1);assert.equal((await payout(f.payout.id)).status,'released');
    await assert.rejects(()=>db.update(schema.payoutTransferAttempts).set({providerParams:{amount:20000}}).where(eq(schema.payoutTransferAttempts.payoutId,f.payout.id)));
  });
  await test('hold committed between preparation and dispatch prevents any transfer and survives',async()=>{
    const f=await payoutFixture(),p=transferProvider(),original=db.transaction.bind(db);let intercept=true;
    db.transaction=async(...args)=>{const value=await original(...args);if(intercept){intercept=false;await db.update(schema.payouts).set({status:'held'}).where(eq(schema.payouts.id,f.payout.id));}return value;};
    try{assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'skipped');}finally{db.transaction=original;}
    assert.equal(p.calls.length,0);assert.equal((await payout(f.payout.id)).status,'held');
  });
  await test('lost accepted transfer response retries one provider identity with the exact same parameters',async()=>{
    const f=await payoutFixture(),p=transferProvider({lost:true});assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'retry');
    const [attempt]=await db.select().from(schema.payoutTransferAttempts).where(eq(schema.payoutTransferAttempts.payoutId,f.payout.id));assert.equal(attempt.state,'unknown');
    assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'released');assert.equal(p.keys.size,1);assert.equal(p.calls[0].key,p.calls[1].key);assert.deepEqual(p.calls[0].params,p.calls[1].params);
  });
  await test('crash after accepted transfer but before database commit recovers from the prepared record',async()=>{
    const f=await payoutFixture(),p=transferProvider(),original=db.transaction.bind(db);let transactions=0;
    db.transaction=(fn,...rest)=>original(async tx=>{const value=await fn(tx);if(++transactions===2)throw Error('Synthetic process death before release commit');return value;},...rest);
    try{await assert.rejects(()=>payoutService.processPayoutTransfer(p,f.payout.id),/process death/);}finally{db.transaction=original;}
    assert.equal((await payout(f.payout.id)).status,'pending');assert.equal(p.keys.size,1);
    assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'released');assert.equal(p.keys.size,1);
  });
  await test('amount or destination changed between preparation and dispatch holds pay before Stripe',async()=>{
    for(const change of ['amount','destination']){
      const f=await payoutFixture(),p=transferProvider(),original=db.transaction.bind(db);let intercept=true;
      db.transaction=async(...args)=>{const value=await original(...args);if(intercept){intercept=false;
        if(change==='amount')await db.update(schema.payouts).set({amount:'150.00'}).where(eq(schema.payouts.id,f.payout.id));
        else await db.update(schema.cleaners).set({stripeAccountId:'acct_changed_'+crypto.randomUUID()}).where(eq(schema.cleaners.id,f.cleaner.id));
      }return value;};
      try{assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'held');}finally{db.transaction=original;}
      assert.equal(p.calls.length,0);
    }
  });
  await test('existing transfer identity is retrieved rather than recreated on later retry',async()=>{
    const f=await payoutFixture(),p=transferProvider();await payoutService.processPayoutTransfer(p,f.payout.id);
    await db.update(schema.payouts).set({status:'pending'}).where(eq(schema.payouts.id,f.payout.id));const now=Date.now;
    try{Date.now=()=>now()+30*3600000;assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'released');}finally{Date.now=now;}
    assert.equal(p.calls.length,1);
  });
  await test('expired uncertain transfer is held for review and cannot be rearmed by resetting payout status',async()=>{
    const f=await payoutFixture(),p=transferProvider({lost:true});await payoutService.processPayoutTransfer(p,f.payout.id);const now=Date.now;
    try{Date.now=()=>now()+25*3600000;assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'held');}finally{Date.now=now;}
    await db.update(schema.payouts).set({status:'pending'}).where(eq(schema.payouts.id,f.payout.id));assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'held');assert.equal(p.calls.length,1);
  });
  await test('legacy unclaimed and claimed payouts are quarantined without a provider request',async()=>{
    for(const options of [{createdAt:new Date('2019-01-01T00:00:00Z')},{processingStartedAt:new Date()}]){const f=await payoutFixture(options),p=transferProvider();assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'held');assert.equal(p.calls.length,0);}
  });
  await test('mismatched provider transfer holds pay and preserves the observed provider identity',async()=>{
    const f=await payoutFixture(),p=transferProvider({mismatch:true});assert.equal((await payoutService.processPayoutTransfer(p,f.payout.id)).outcome,'held');
    const [attempt]=await db.select().from(schema.payoutTransferAttempts).where(eq(schema.payoutTransferAttempts.payoutId,f.payout.id));assert.ok(attempt.transferId);assert.equal(attempt.state,'review');
  });
  await test('new webhook receipt is not completed; a live claim returns busy and finished work dedupes',async()=>{
    const e=event(),claim=await dedupe.claimStripeWebhook(e);assert.equal(claim.state,'claimed');
    assert.equal((await db.select().from(schema.processedStripeEvents).where(eq(schema.processedStripeEvents.eventId,e.id))).length,0);
    assert.equal((await dedupe.claimStripeWebhook(e)).state,'busy');await dedupe.finishStripeWebhook(e.id,claim.token);assert.equal((await dedupe.claimStripeWebhook(e)).state,'completed');
  });
  await test('hard-crashed webhook reclaims an expired lease; obsolete workers cannot finalize or clear it',async()=>{
    const e=event(),old=await dedupe.claimStripeWebhook(e);await db.update(schema.stripeWebhookClaims).set({claimedAt:new Date(Date.now()-16*60000)}).where(eq(schema.stripeWebhookClaims.eventId,e.id));
    const fresh=await dedupe.claimStripeWebhook(e);assert.equal(fresh.state,'claimed');assert.notEqual(fresh.token,old.token);
    await assert.rejects(()=>dedupe.finishStripeWebhook(e.id,old.token),/lease lost/);await dedupe.failStripeWebhook(e.id,old.token);assert.equal((await dedupe.claimStripeWebhook(e)).state,'busy');
    await dedupe.finishStripeWebhook(e.id,fresh.token);
  });
  await test('caught webhook failure remains retryable and historical processed events never replay',async()=>{
    const e=event(),claim=await dedupe.claimStripeWebhook(e);await dedupe.failStripeWebhook(e.id,claim.token);assert.equal((await dedupe.claimStripeWebhook(e)).state,'claimed');
    const old=event();await db.insert(schema.processedStripeEvents).values({eventId:old.id,eventType:old.type});assert.equal((await dedupe.claimStripeWebhook(old)).state,'completed');
  });
  await test('same webhook identity with different financial payload fails before handling',async()=>{
    const e=event();await dedupe.claimStripeWebhook(e);await assert.rejects(()=>dedupe.claimStripeWebhook({...e,data:{object:{...e.data.object,amount:1}}}),/identity changed/);
  });
  await test('signed dispute retry after hard crash holds pay and completes once; paid replay cannot clear hold',async()=>{
    const SDK=require('stripe'),sdk=new SDK('sk_test_local_fixture'),secret='whsec_local_fixture';process.env.STRIPE_WEBHOOK_SECRET=secret;
    replace('lib/stripe/config.ts',{stripe:{...stripe,webhooks:sdk.webhooks}});
    replace('lib/queries/cleaner-notifications.ts',{notifyAdminsOfJobAlert:async()=>{}});
    const route=require('../app/api/stripe/webhook/route.ts'),f=await payoutFixture(),e={...event(),data:{object:{id:'dp_'+crypto.randomUUID(),payment_intent:f.payment.pi.id,amount:20000,status:'needs_response',reason:'fraudulent'}}};
    await dedupe.claimStripeWebhook(e);
    async function send(value,bad=false){const body=JSON.stringify(value),header=bad?'invalid':sdk.webhooks.generateTestHeaderString({payload:body,secret});return route.POST({headers:{get:()=>header},text:async()=>body});}
    assert.equal((await send(e)).status,503);assert.equal((await payout(f.payout.id)).status,'pending');
    await db.update(schema.stripeWebhookClaims).set({claimedAt:new Date(Date.now()-16*60000)}).where(eq(schema.stripeWebhookClaims.eventId,e.id));
    assert.equal((await send(e)).status,200);assert.equal((await payout(f.payout.id)).status,'held');const first=(await db.select().from(schema.jobs).where(eq(schema.jobs.id,f.job.id)))[0].notes;
    const duplicate=await send(e);assert.equal((await duplicate.json()).duplicate,true);assert.equal((await db.select().from(schema.jobs).where(eq(schema.jobs.id,f.job.id)))[0].notes,first);
    await db.update(schema.payouts).set({stripePayoutId:'tr_held_fixture'}).where(eq(schema.payouts.id,f.payout.id));
    assert.equal((await send({...event(),type:'transfer.paid',data:{object:{id:'tr_held_fixture'}}})).status,200);assert.equal((await payout(f.payout.id)).status,'held');
    assert.equal((await send(event(),true)).status,400);
  });
  await test('fresh payment still supports a custom checklist retained on the client for onboarding',async()=>{
    const result=await checkout.createPaymentIntentForSignup({...form(),useDefaultChecklist:false,checklistFile:undefined});
    assert.ok(result.clientSecret,JSON.stringify(result));
  });
  console.log(`${passed} financial recovery checks passed; actual migration/services, blocked network, no hosted money or delivery.`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>pg.close());
