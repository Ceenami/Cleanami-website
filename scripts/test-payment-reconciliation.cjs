// Actual cancellation/webhook services and PostgreSQL; all providers controlled.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
exports.verify=async function(h){
 const {db,pg,schema,orm,load,emptyImports,pure,seed,stored,pricing,rules,freeze,charge,refusal,pay,promo,authorization,verifyPayment}=h;
 const {getTableConfig,PgDialect}=require('drizzle-orm/pg-core'),dialect=new PgDialect();
 for(const table of [schema.payouts,schema.processedStripeEvents]){
  const t=getTableConfig(table);
  for(const c of t.columns)if(c.enum?.enumName){const name=c.enum.enumName;if(!(await pg.query('select 1 from pg_type where typname=$1',[name])).rows.length)await pg.exec(`CREATE TYPE "${name}" AS ENUM (${c.enum.enumValues.map(v=>`'${v}'`).join(',')})`);}
  const columns=t.columns.map(c=>{let def='';if(c.default!==undefined){const v=c.default;def=' DEFAULT '+(orm.is(v,orm.SQL)?dialect.sqlToQuery(v).sql:typeof v==='string'?`'${v.replaceAll("'","''")}'`:JSON.stringify(v));}return `"${c.name}" ${c.getSQLType()}${c.primary?' PRIMARY KEY':''}${c.notNull?' NOT NULL':''}${def}`;});
  await pg.exec(`CREATE TABLE "${t.name}" (${columns.join(',')})`);
 }
 await pg.exec('CREATE UNIQUE INDEX payouts_job_cleaner_key ON payouts(job_id,cleaner_id); CREATE UNIQUE INDEX processed_stripe_events_event_id_key ON processed_stripe_events(event_id)');
 const test=(name,fn)=>h.test('money: '+name,async()=>{const deadline=setTimeout(()=>{throw Error('Money regression stalled: '+name)},15000);try{await pg.exec('TRUNCATE jobs_to_cleaners,cleaners,payouts,processed_stripe_events CASCADE');h.setNow('2030-01-29T12:00Z');await fn();}finally{clearTimeout(deadline);}});
 const billing={customerSkipsBilling:c=>c.skipPayment===true,isSkippedPaymentIntent:id=>id==='skipped'};
 const cancellationRules=load('lib/cancellation/rules.ts',{'date-fns':require('date-fns')});
 const snapshots=pure('lib/pricing/residential-v2/contracts.ts');
 async function fixture(options={}){
  const f=await seed(options);
  const [cleaner]=await db.insert(schema.cleaners).values({fullName:'Synthetic worker',email:crypto.randomUUID()+'@example.invalid'}).returning();
  await db.insert(schema.jobsToCleaners).values({jobId:f.job.id,cleanerId:cleaner.id,role:'primary'});
  await db.update(schema.jobs).set({status:'assigned',expectedHours:'4.65'}).where(orm.eq(schema.jobs.id,f.job.id));
  return {...f,cleaner};
 }
 function provider(options={}){
  const intents=new Map(),keys=new Map(),calls=[],refunds=[];let failCreate=options.failCreate??0,failCapture=options.failCapture??0;
  const complete=intent=>({...intent,status:'succeeded',amount_received:intent.amount,
   latest_charge:{id:'ch_'+intent.id,currency:'usd',amount:intent.amount,amount_captured:intent.amount,amount_refunded:0,refunded:false,paid:true,captured:true,payment_intent:intent.id}});
  const stripe={paymentMethods:{list:async()=>({data:[{id:'pm_fixture'}]})},
   paymentIntents:{create:async(input,opts)=>{
    calls.push({operation:'create',input:structuredClone(input),key:opts.idempotencyKey});
    let saved=keys.get(opts.idempotencyKey);
    if(saved)assert.equal(JSON.stringify(input),saved.parameters,'retry changed Stripe parameters');
    else{saved={parameters:JSON.stringify(input),id:'pi_'+crypto.randomUUID().replaceAll('-','')};keys.set(opts.idempotencyKey,saved);intents.set(saved.id,{id:saved.id,amount:input.amount,currency:input.currency,status:'requires_capture',amount_received:0,customer:input.customer,metadata:input.metadata});}
    if(failCreate-->0)throw Error('Synthetic response lost after authorization');
    return structuredClone(intents.get(saved.id));
   },retrieve:async id=>{calls.push({operation:'retrieve',id});const intent=intents.get(id);assert.ok(intent,'unknown synthetic intent');return structuredClone(intent);},
   capture:async(id,_params,opts)=>{calls.push({operation:'capture',id,key:opts.idempotencyKey});intents.set(id,complete(intents.get(id)));if(failCapture-->0)throw Error('Synthetic response lost after capture');return structuredClone(intents.get(id));},
   cancel:async id=>{calls.push({operation:'cancel',id});intents.get(id).status='canceled';return structuredClone(intents.get(id));}},
   charges:{retrieve:async id=>{for(const intent of intents.values())if(intent.latest_charge?.id===id)return structuredClone(intent.latest_charge);throw Error('unknown synthetic charge');}},
   refunds:{list:async input=>({data:refunds.filter(r=>r.payment_intent===input.payment_intent),has_more:false}),create:async()=>({id:'re_fixture',status:options.refundStatus??'succeeded'})},
  };
  return{stripe,intents,keys,calls,refunds,complete};
 }
 function service(p,config=rules(),options={}){
  const file='lib/services/customer-cancellation.service.ts',redemptions=[];
  const voider=load('lib/services/payment/void-charge.ts',{'@/lib/stripe/get-stripe':{getStripe:()=>p.stripe},'@/lib/billing/customer-billing':billing});
  const mod=load(file,{...emptyImports(file),'@/db':{db},'@/db/schemas':schema,'drizzle-orm':orm,
   './job-execution-contract':{getExecutionContract:async()=>null},'./payment/execution-cancellation':{cancelExecutionJob:async()=>{throw Error('legacy fixture entered issued cancellation');}},
   '@/lib/cancellation/rules':cancellationRules,'@/lib/billing/customer-billing':billing,'@/lib/env/messages':{SERVICE_UNAVAILABLE:{stripe:'disabled'}},
   '@/lib/pricing/recurring-pricing-input':pure('lib/pricing/recurring-pricing-input.ts'),'@/lib/services/pricing.service':pricing(config),
   '@/lib/stripe/get-stripe':{getStripe:()=>p.stripe},'@/lib/services/payment/void-charge':voider,'@/lib/pricing/cleaner-pay':pay,
   '@/lib/pricing/residential-v2/contracts':snapshots,'@/lib/jobs/job-notes':pure('lib/jobs/job-notes.ts'),'@/lib/services/email.service':{sendCancellationEmail:async()=>{}},
   './payment/verify-settled-payment':verifyPayment,'./payment/rental-authorization':authorization,'./payment/freeze-rental-charge':{freezeRentalCharge:freeze},
   '@/lib/pricing/rental-charge':charge,'@/lib/pricing/rental-quote-refusal':refusal,
   './promo-code.service':{resolvePromoCodeById:async(id,amount)=>({evaluation:promo.evaluatePromoCode(amount,{code:'TEST',discountType:'percent',discountValue:options.promoPercent??10,active:true,maxRedemptions:null,redemptionCount:0,startsAt:null,expiresAt:null})}),recordPromoRedemption:async v=>redemptions.push(v)},
  });return{...mod,redemptions};
 }
 const changed=factor=>{const value=rules();for(const rows of Object.values(value))for(const row of rows)for(const key of Object.keys(row))if(key.endsWith('Cents'))row[key]=Math.round(row[key]*factor);return value;};
 async function quote(f,config=rules()){
  const input=charge.rentalJobPricingInput(f.property,f.subscription.durationMonths,f.job.addonsSnapshot);
  return charge.buildRentalCharge(await new (pricing(config).PricingService)().calculatePrice(input),f.job.addonsSnapshot,false);
 }
 for(const factor of [1.1,.8])for(const caller of ['customer','admin'])await test(`${caller} cancellation retains $235 frozen charge after ${factor} price change`,async()=>{
  const f=await fixture();await freeze(db,f.job.id,await quote(f));const p=provider(),s=service(p,changed(factor));
  const result=caller==='customer'?await s.cancelJobForCustomer(f.job.id,f.customer.id):await s.cancelJobAsAdmin(f.job.id);
  assert.equal(result.customerCharged,true);assert.equal(p.calls.find(c=>c.operation==='create').input.amount,23500);
  assert.equal((await stored(f.job.id)).rentalCharge.chargeAmountCents,23500);assert.equal((await stored(f.job.id)).paymentStatus,'captured');
  assert.equal((await db.select().from(schema.payouts)).length,1);
  await s.cancelJobForCustomer(f.job.id,f.customer.id);assert.equal(p.calls.filter(c=>c.operation==='create').length,1);assert.equal((await db.select().from(schema.payouts)).length,1);
 });
 await test('unfrozen cancellation freezes v12 term, due drain and per-job promo before paying',async()=>{
  const f=await fixture({months:6,property:{hasHotTub:true,hotTubServiceLevel:true,hotTubDrain:true,hotTubDrainCadence:'4_weeks'}});
  const codeId=crypto.randomUUID();await db.update(schema.jobs).set({promoCodeId:codeId}).where(orm.eq(schema.jobs.id,f.job.id));
  const p=provider(),s=service(p);await s.cancelJobForCustomer(f.job.id,f.customer.id);
  const saved=await stored(f.job.id);assert.equal(saved.rentalCharge.perCleanCents,21675);assert.equal(saved.rentalCharge.drainCents,5000);assert.equal(saved.rentalCharge.chargeAmountCents,24007);
  assert.equal(p.calls.find(c=>c.operation==='create').input.amount,saved.rentalCharge.chargeAmountCents);assert.equal(s.redemptions.length,1);assert.equal(s.redemptions[0].discountAmountCents,2668);
 });
 await test('frozen discounted due-drain money survives later property changes and promo expiry',async()=>{
  const f=await fixture({months:6,property:{hasHotTub:true,hotTubServiceLevel:true,hotTubDrain:true,hotTubDrainCadence:'4_weeks'}});
  const candidate=await quote(f),codeId=crypto.randomUUID();candidate.promo={promoCodeId:codeId,code:'OLD',discountAmountCents:1000};candidate.chargeAmountCents-=1000;
  await db.update(schema.jobs).set({promoCodeId:codeId}).where(orm.eq(schema.jobs.id,f.job.id));await freeze(db,f.job.id,candidate);
  await db.update(schema.properties).set({sqFt:3000,hasHotTub:false,hotTubServiceLevel:false,hotTubDrain:false}).where(orm.eq(schema.properties.id,f.property.id));
  const p=provider();await service(p,changed(2)).cancelJobForCustomer(f.job.id,f.customer.id);
  assert.equal(p.calls.find(c=>c.operation==='create').input.amount,25675);assert.deepEqual((await stored(f.job.id)).rentalCharge,candidate);
 });
 await test('existing settled legacy intent without a receipt is verified without live repricing',async()=>{
  const f=await fixture(),p=provider(),id='pi_old';p.intents.set(id,p.complete({id,amount:23500,currency:'usd'}));
  await db.update(schema.jobs).set({paymentIntentId:id,paymentStatus:'captured'}).where(orm.eq(schema.jobs.id,f.job.id));
  await service(p,changed(2)).cancelJobForCustomer(f.job.id,f.customer.id);assert.equal(p.calls.filter(c=>c.operation==='create'||c.operation==='capture').length,0);assert.equal((await stored(f.job.id)).rentalCharge,null);
 });
 for(const loss of ['failCreate','failCapture'])await test(`${loss} retry preserves committed quote and same authorization key`,async()=>{
  const f=await fixture(),p=provider({[loss]:1}),s=service(p);
  await assert.rejects(()=>s.cancelJobForCustomer(f.job.id,f.customer.id));
  const before=await stored(f.job.id);assert.equal(before.status,'assigned');assert.equal(before.rentalCharge.chargeAmountCents,23500);assert.equal((await db.select().from(schema.payouts)).length,0);
  await service(p,changed(1.1)).cancelJobForCustomer(f.job.id,f.customer.id);
  assert.equal(p.keys.size,1);assert.equal((await stored(f.job.id)).rentalCharge.chargeAmountCents,23500);assert.equal((await db.select().from(schema.payouts)).length,1);
 });
 await test('uncertain cron authorization and late cancellation reuse one provider intent',async()=>{
  const f=await fixture(),p=provider({failCreate:1});await freeze(db,f.job.id,await quote(f));
  const frozen=(await stored(f.job.id)).rentalCharge;
  await assert.rejects(()=>authorization.authorizeRentalCharge(p.stripe,f.job.id,f.customer.stripeCustomerId,frozen));
  await service(p,changed(1.1)).cancelJobForCustomer(f.job.id,f.customer.id);assert.equal(p.keys.size,1);assert.equal((await stored(f.job.id)).paymentStatus,'captured');
 });
 for(const state of ['refunded','partial','pending','wrong_amount','wrong_currency','requires_action'])await test(`existing ${state} payment refuses cancellation pay/state changes`,async()=>{
  const f=await fixture();await freeze(db,f.job.id,await quote(f));const p=provider(),id='pi_existing';
  let intent=p.complete({id,amount:23500,currency:'usd'});
  if(state==='wrong_amount'){intent=p.complete({id,amount:25850,currency:'usd'});}
  if(state==='wrong_currency')intent.currency='eur';
  if(state==='requires_action')intent.status='requires_action';
  if(['refunded','partial','pending'].includes(state)){const amount=state==='partial'?1000:23500;p.refunds.push({id:'re_existing',payment_intent:id,charge:intent.latest_charge.id,amount,status:state==='pending'?'pending':'succeeded'});intent.latest_charge.amount_refunded=amount;intent.latest_charge.refunded=state==='refunded';}
  p.intents.set(id,intent);await db.update(schema.jobs).set({paymentIntentId:id,paymentStatus:'captured'}).where(orm.eq(schema.jobs.id,f.job.id));
  await assert.rejects(()=>service(p).cancelJobForCustomer(f.job.id,f.customer.id));assert.equal((await stored(f.job.id)).status,'assigned');assert.equal((await db.select().from(schema.payouts)).length,0);assert.equal(p.calls.filter(c=>c.operation==='create'||c.operation==='capture').length,0);
 });
 await test('unsupported rental scope refuses before any provider or payout write',async()=>{
  const f=await fixture({property:{sqFt:3000}}),p=provider();await assert.rejects(()=>service(p).cancelJobForCustomer(f.job.id,f.customer.id));assert.equal(p.calls.length,0);assert.equal((await stored(f.job.id)).rentalCharge,null);
 });
 await test('corrupt frozen receipt cannot fall back to live pricing',async()=>{
  const f=await fixture();await db.transaction(async tx=>{await tx.execute(orm.sql`select set_config('cleannami.rental_charge_freeze','v1',true)`);await tx.update(schema.jobs).set({rentalCharge:{version:'rental-charge-v1'}}).where(orm.eq(schema.jobs.id,f.job.id));});
  const p=provider();await assert.rejects(()=>service(p).cancelJobForCustomer(f.job.id,f.customer.id));assert.equal(p.calls.length,0);assert.equal((await db.select().from(schema.payouts)).length,0);
 });
 await test('VIP and unpaid manual cancellation do not create provider payments',async()=>{
  const f=await fixture({skip:true}),p=provider();await service(p).cancelJobForCustomer(f.job.id,f.customer.id);assert.equal(p.calls.length,0);
  const m=await fixture();await db.update(schema.jobs).set({jobSource:'manual'}).where(orm.eq(schema.jobs.id,m.job.id));await service(p).cancelJobAsAdmin(m.job.id);assert.equal(p.calls.length,0);
 });
 await test('on-time cancellation retains refund behavior and does not prepare another rental charge',async()=>{
  h.setNow('2030-01-28T12:00Z');const f=await fixture(),p=provider();h.setNow('2030-01-28T12:00Z');const id='pi_paid';p.intents.set(id,p.complete({id,amount:23500,currency:'usd'}));
  await db.update(schema.jobs).set({paymentIntentId:id,paymentStatus:'captured'}).where(orm.eq(schema.jobs.id,f.job.id));await service(p).cancelJobForCustomer(f.job.id,f.customer.id);assert.equal((await stored(f.job.id)).paymentStatus,'refunded');assert.equal((await stored(f.job.id)).rentalCharge,null);
 });

 const Stripe=require('stripe'),sdk=new Stripe('sk_test_local_fixture'),secret='whsec_local_fixture';
 function webhook(p){
  let failureEmails=0;
  const reconcile=load('lib/services/payment/reconcile-stripe-payment.ts',{'@/db':{db},'@/db/schemas':schema,'drizzle-orm':orm,'@/lib/jobs/job-notes':pure('lib/jobs/job-notes.ts')});
  const dedupe=load('lib/services/stripe/event-dedupe.ts',{'@/db':{db},'@/db/schemas':schema});
  const file='app/api/stripe/webhook/route.ts';
  const api=load(file,{...emptyImports(file),'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},'@/db':{db},'@/db/schemas':schema,'drizzle-orm':orm,
   '@/lib/cleaner/stripe-account-state':{applyStripeAccountState:async()=>{}},'@/lib/services/stripe/event-dedupe':dedupe,'@/lib/services/email.service':{sendPaymentFailedEmail:async()=>{failureEmails++;}},
   '@/lib/services/payment/dispute.service':{recordDisputeAndHoldPayouts:async()=>{}},'@/lib/queries/cleaner-notifications':{notifyAdminsOfJobAlert:async()=>{}},'@/lib/stripe/config':{stripe:{...p.stripe,webhooks:sdk.webhooks}},'@/lib/services/payment/reconcile-stripe-payment':reconcile,
  },`\nprocess.env.STRIPE_WEBHOOK_SECRET='${secret}';`);
  return{send:async(type,object,id=crypto.randomUUID(),bad=false)=>{const body=JSON.stringify({id,type,object:'event',data:{object}}),header=bad?'invalid':sdk.webhooks.generateTestHeaderString({payload:body,secret});return api.POST({headers:{get:()=>header},text:async()=>body});},emails:()=>failureEmails};
 }
 async function paymentFixture(){const f=await seed(),p=provider(),id='pi_fixture';p.intents.set(id,p.complete({id,amount:10000,currency:'usd'}));await db.update(schema.jobs).set({status:'canceled',paymentIntentId:id,paymentStatus:'captured'}).where(orm.eq(schema.jobs.id,f.job.id));return{...f,p,id,w:webhook(p)};}
 function refund(f,amount=10000,status='succeeded',id='re_fixture'){const value={id,payment_intent:f.id,charge:'ch_'+f.id,amount,status};f.p.refunds.push(value);return value;}
 for(const stale of ['payment_intent.succeeded','payment_intent.payment_failed','refund.created','charge.refunded'])await test(`full refund survives delayed distinct ${stale}`,async()=>{
  const f=await paymentFixture();refund(f);assert.equal((await f.w.send('charge.refunded',{id:'ch_'+f.id,payment_intent:f.id,amount:10000,amount_refunded:10000})).status,200);assert.equal((await stored(f.job.id)).paymentStatus,'refunded');
  const payload=stale.startsWith('payment_intent')?{id:f.id,status:'succeeded'}:{id:'stale',payment_intent:f.id,amount:1,amount_refunded:0,status:'pending'};
  assert.equal((await f.w.send(stale,payload)).status,200);assert.equal((await stored(f.job.id)).paymentStatus,'refunded');assert.equal(f.w.emails(),0);
 });
 for(const status of ['pending','requires_action','failed','canceled'])await test(`${status} refund cannot claim full refund; updated success completes it`,async()=>{
  const f=await paymentFixture(),r=refund(f,10000,status);
  assert.equal((await f.w.send('refund.updated',r)).status,200);assert.equal((await stored(f.job.id)).paymentStatus,'captured');
  r.status='succeeded';assert.equal((await f.w.send('refund.updated',r)).status,200);assert.equal((await stored(f.job.id)).paymentStatus,'refunded');
 });
 await test('partial and multi-page successful refunds reconcile against collected money',async()=>{
  const f=await paymentFixture();refund(f,2500);await f.w.send('refund.created',f.p.refunds[0]);assert.equal((await stored(f.job.id)).paymentStatus,'captured');
  const second=refund(f,7500,'succeeded','re_second');let pages=0;f.p.stripe.refunds.list=async input=>{pages++;return input.starting_after?{data:[second],has_more:false}:{data:[f.p.refunds[0]],has_more:true};};
  assert.equal((await f.w.send('refund.updated',second)).status,200);assert.equal((await stored(f.job.id)).paymentStatus,'refunded');assert.equal(pages,2);
 });
 await test('refund.failed reconciles an earlier inaccurate refunded flag back to actual paid state',async()=>{
  const f=await paymentFixture(),r=refund(f,10000,'failed');await db.update(schema.jobs).set({paymentStatus:'refunded'}).where(orm.eq(schema.jobs.id,f.job.id));
  assert.equal((await f.w.send('refund.failed',r)).status,200);assert.equal((await stored(f.job.id)).paymentStatus,'captured');
 });
 await test('canceled authorization stays uncharged under delayed payment success',async()=>{
  const f=await paymentFixture();f.p.intents.get(f.id).status='canceled';await f.w.send('payment_intent.canceled',{id:f.id});assert.equal((await stored(f.job.id)).paymentStatus,null);await f.w.send('payment_intent.succeeded',{id:f.id});assert.equal((await stored(f.job.id)).paymentStatus,null);
 });
 await test('stale failed event cannot overwrite a successful payment or send failure notices',async()=>{
  const f=await paymentFixture();await f.w.send('payment_intent.payment_failed',{id:f.id,last_payment_error:{message:'stale'}});assert.equal((await stored(f.job.id)).paymentStatus,'captured');assert.equal(f.w.emails(),0);
 });
 await test('actual payment failure records failure and notifies only on the transition',async()=>{
  const f=await paymentFixture();Object.assign(f.p.intents.get(f.id),{status:'requires_payment_method',last_payment_error:{message:'declined'}});
  await f.w.send('payment_intent.payment_failed',{id:f.id});await f.w.send('payment_intent.payment_failed',{id:f.id});assert.equal((await stored(f.job.id)).paymentStatus,'failed');assert.equal(f.w.emails(),1);
 });
 await test('duplicate signed events are idempotent and invalid signatures cannot mutate state',async()=>{
  const f=await paymentFixture();refund(f);const first=await f.w.send('charge.refunded',{payment_intent:f.id},'evt_duplicate');assert.equal(first.status,200);
  const notes=(await stored(f.job.id)).notes;const next=await f.w.send('charge.refunded',{payment_intent:f.id},'evt_duplicate');assert.equal(next.body.duplicate,true);assert.equal((await stored(f.job.id)).notes,notes);
  assert.equal((await f.w.send('payment_intent.succeeded',{id:f.id},'evt_bad',true)).status,400);assert.equal((await stored(f.job.id)).notes,notes);
 });
 await test('provider failure releases event claim for retry and preserves recorded money',async()=>{
  const f=await paymentFixture(),retrieve=f.p.stripe.paymentIntents.retrieve;f.p.stripe.paymentIntents.retrieve=async()=>{throw Error('Synthetic provider outage');};
  assert.equal((await f.w.send('payment_intent.succeeded',{id:f.id},'evt_retry')).status,500);assert.equal((await db.select().from(schema.processedStripeEvents)).length,0);assert.equal((await stored(f.job.id)).paymentStatus,'captured');
  f.p.stripe.paymentIntents.retrieve=retrieve;refund(f);assert.equal((await f.w.send('payment_intent.succeeded',{id:f.id},'evt_retry')).status,200);assert.equal((await stored(f.job.id)).paymentStatus,'refunded');
 });
 await test('concurrent signed reconciliation signals preserve a refund and both audit notes',async()=>{
  const f=await paymentFixture(),retrieve=f.p.stripe.paymentIntents.retrieve;
  let enter,release,active=0,maximum=0,first=true;
  const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
  f.p.stripe.paymentIntents.retrieve=async(...args)=>{active++;maximum=Math.max(maximum,active);if(first){first=false;enter();await gate;}try{return await retrieve(...args);}finally{active--;}};
  const firstEvent=f.w.send('payment_intent.succeeded',{id:f.id},'evt_before_refund');await entered;
  const secondEvent=f.w.send('charge.refunded',{payment_intent:f.id},'evt_after_refund');refund(f);release();
  assert.equal((await firstEvent).status,200);assert.equal((await secondEvent).status,200);assert.equal(maximum,1);
  const saved=await stored(f.job.id);assert.equal(saved.paymentStatus,'refunded');assert.match(saved.notes,/evt_before_refund/);assert.match(saved.notes,/evt_after_refund/);
 });
};
if(require.main===module){const {spawnSync}=require('node:child_process'),path=require('node:path');const r=spawnSync(process.execPath,[path.join(__dirname,'test-rental-pricing.cjs'),'--money-fixes'],{stdio:'inherit',windowsHide:true,env:process.env});process.exitCode=r.status??1;}
