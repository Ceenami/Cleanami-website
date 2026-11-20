// Actual PostgreSQL constraints/services; synthetic data and blocked network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
delete process.env.RENTAL_FINANCE_SCHEMA_READY;delete process.env.RENTAL_FINANCE_ENROLLMENT;
const h=require('./test-subscription-minimum.cjs'),{db,pg,schema,stripe,replace}=h;
const {eq,sql}=require('drizzle-orm');
const credit=require('../lib/services/payment/rental-credit.ts'),service=require('../lib/services/payment/rental-finance.service.ts');
const ops=require('../lib/services/payment/rental-finance-operations.ts'),admin=require('../lib/services/payment/rental-finance-admin.ts');
const checkout=require('../lib/services/create-payment-intent.service.ts'),onboarding=require('../lib/services/complete-onboarding.service.ts');
const {isLateFinancialCancellation}=require('../lib/subscriptions/rental-finance-policy.ts');
const financeTables=['rental_finance_audit','rental_finance_notices','rental_financial_operations','rental_job_finances','prepaid_reservations','prepaid_entries','rental_finance_contracts','prepaid_entitlements'];
let passed=0,lostNext=false,failNext=false;
const created=stripe.paymentIntents.create;
stripe.paymentMethods={list:async()=>({data:[{id:'pm_synthetic'}]})};
stripe.paymentIntents.create=async(params,options)=>{
  if(params.metadata?.rental_financial_operation_id&&failNext){failNext=false;throw Error('Synthetic unavailable payment transport');}
  const pi=await created(params,options);
  if(params.metadata?.rental_financial_operation_id&&lostNext){lostNext=false;throw Error('Synthetic response lost after acceptance');}
  return pi;
};
const refunds=new Map(),refundKeys=new Map();
stripe.refunds.create=async(params,options)=>{
  if(refundKeys.has(options.idempotencyKey))return refunds.get(refundKeys.get(options.idempotencyKey));
  const pi=h.intents.get(params.payment_intent),refund={...params,id:'re_'+crypto.randomUUID(),currency:'usd',charge:pi.latest_charge.id,status:'succeeded'};
  refunds.set(refund.id,refund);refundKeys.set(options.idempotencyKey,refund.id);h.refundRows.push(refund);
  pi.latest_charge.amount_refunded+=refund.amount;pi.latest_charge.refunded=pi.latest_charge.amount_refunded===pi.amount;
  return refund;
};
stripe.refunds.retrieve=async id=>refunds.get(id);
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
async function migration(){await pg.exec(fs.readFileSync(path.join(__dirname,'../db/supabase/migrations/0067_prepaid_credit_separate_fees.sql'),'utf8'));}
function enable(){for(const key of ['RENTAL_FINANCE_SCHEMA_READY','RENTAL_FINANCE_ENROLLMENT','JOB_EXECUTION_SCHEMA_READY','JOB_EXECUTION_ENROLLMENT','ASSIGNMENT_OFFERS_SCHEMA_READY','ASSIGNMENT_OFFERS_ENROLLMENT','SUBSCRIPTION_MINIMUM_SCHEMA_READY','SUBSCRIPTION_MINIMUM_ENROLLMENT','SUBSCRIPTION_TERM_SCHEMA_READY','SUBSCRIPTION_TERM_ENROLLMENT'])process.env[key]='true';}
async function purchase(){const payment=await h.paid();await admin.auditFinance(db,'consent:'+payment.pi.id,String(payment.pi.customer),'accept_financial_terms','Synthetic explicit checkout agreement',null,null,{policy:payment.result.financePolicy});const id=await h.complete(payment);const sub=await h.sub(id),contract=await credit.financeContract(id);return {payment,sub,contract,e:await credit.entitlement(contract.entitlement_id)};}
async function jobFixture(owner,lead=48*3600000,addon={}){
  const [job]=await db.insert(schema.jobs).values({subscriptionId:owner.sub.id,propertyId:owner.sub.propertyId,calendarEventUid:crypto.randomUUID(),serviceType:'vacation_rental_subscription',status:'assigned',expectedHours:'2.00',checkInTime:new Date(Date.now()+lead),checkOutTime:new Date(Date.now()+lead+5*3600000),addonsSnapshot:{laundryType:'none',laundryLoads:0,hotTubServiceLevel:'none',petsAllowed:false,teamSize:1,...addon}}).returning();return job;
}
async function worker(job,role='primary',accepted=true){
  const [cleaner]=await db.insert(schema.cleaners).values({fullName:'Synthetic Worker',email:crypto.randomUUID()+'@example.invalid'}).returning();
  await db.insert(schema.jobsToCleaners).values({jobId:job.id,cleanerId:cleaner.id,role,frozenHourlyRateCents:1900});
  await db.execute(sql`insert into phase3a_offer_jobs(job_id) values(${job.id}::uuid) on conflict do nothing`);
  await db.execute(sql`insert into phase3a_assignment_offers(job_id,cleaner_id,role,version,schedule_version,state,responded_at) values(${job.id}::uuid,${cleaner.id}::uuid,${role},${Math.floor(Math.random()*1000000000)},1,${accepted?'accepted':'pending'},${accepted?new Date().toISOString():null}::timestamptz)`);
  return cleaner;
}
async function finalEvidence(job){await db.update(schema.jobs).set({status:'awaiting_capture'}).where(eq(schema.jobs.id,job.id));await db.insert(schema.evidencePackets).values({jobId:job.id,status:'complete',finalEvidenceSubmittedAt:new Date(),gpsCheckInTimestamp:new Date(),gpsCheckOutTimestamp:new Date(),isChecklistComplete:true});}
async function apply(job,prepared){await db.transaction(async tx=>{await tx.select().from(schema.jobs).where(eq(schema.jobs.id,job.id)).for('update');await service.applyRentalCompletion(tx,job.id,prepared);await tx.update(schema.jobs).set({status:'completed',paymentStatus:'captured'}).where(eq(schema.jobs.id,job.id));});}
async function run(){
  await h.setup();
  await pg.exec(fs.readFileSync(path.join(__dirname,'../db/supabase/migrations/0063_subscription_minimum_contracts.sql'),'utf8'));
  require('../db/index.ts').sequentialQueries=async(...queries)=>{const values=[];for(const query of queries)values.push(await query());return values;};
  // Harness auto-creates Drizzle declarations without migration constraints.
  // Replace only these EMPTY in-memory tables, then test the real SQL authority.
  for(const table of financeTables)await pg.exec(`DROP TABLE ${table}`);
  await migration();enable();
  await test('SQL0067 reapplies, has private RLS and no historical enrollment',async()=>{
    await migration();for(const table of financeTables){assert.equal((await pg.query(`select relrowsecurity v from pg_class where oid='${table}'::regclass`)).rows[0].v,true);for(const role of ['anon','authenticated'])assert.equal((await pg.query(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE') v`)).rows[0].v,false);assert.equal((await pg.query(`select count(*)::int n from ${table}`)).rows[0].n,0);}
  });
  await test('fee classification preserves exact24h, subhour, DST elapsed instants and started refusal',async()=>{
    const now=new Date('2026-11-01T05:30:00Z');assert.equal(isLateFinancialCancellation(new Date(+now+86400000),now),false);assert.equal(isLateFinancialCancellation(new Date(+now+86399999),now),true);assert.equal(isLateFinancialCancellation(new Date(+now+1800000),now),true);assert.throws(()=>isLateFinancialCancellation(now,now));
  });
  await test('new checkout pins financial policy but refuses funding without recorded agreement',async()=>{
    const p=await h.paid();assert.equal(p.result.financePolicy,'property_prepaid_separate_fee_v1');const result=await onboarding.completeOnboardingForPayment(p.input,p.pi.id);assert.equal(result.success,false);assert.match(result.error,/terms are missing/);assert.equal((await db.select().from(schema.subscriptions)).length,0);
  });
  await test('funded owner/property credit is independent of a scheduled job and onboarding retries',async()=>{
    const o=await purchase();assert.equal(o.e.balance,20000);assert.equal(o.e.reserved,0);assert.equal((await db.select().from(schema.jobs)).length,0);assert.equal(await h.complete(o.payment),o.sub.id);assert.equal((await db.select().from(schema.prepaidEntries).where(eq(schema.prepaidEntries.entitlementId,o.e.id))).length,1);
    await assert.rejects(()=>db.update(schema.prepaidEntitlements).set({fundedCents:999}).where(eq(schema.prepaidEntitlements.id,o.e.id)));
    await assert.rejects(()=>db.delete(schema.prepaidEntries).where(eq(schema.prepaidEntries.entitlementId,o.e.id)));
  });
  await test('accepted financial purchase recovers after enrollment stops but missing readiness rolls back',async()=>{
    const p=await h.paid();await admin.auditFinance(db,'consent:'+p.pi.id,'synthetic','accept_financial_terms','Synthetic explicit checkout agreement',null,null,{policy:p.result.financePolicy});delete process.env.RENTAL_FINANCE_SCHEMA_READY;
    assert.equal((await onboarding.completeOnboardingForPayment(p.input,p.pi.id)).success,false);process.env.RENTAL_FINANCE_SCHEMA_READY='true';delete process.env.RENTAL_FINANCE_ENROLLMENT;const id=await h.complete(p);assert.ok(await credit.financeContract(id));process.env.RENTAL_FINANCE_ENROLLMENT='true';
  });
  await test('unmarked legacy purchases keep old handling without credit enrollment',async()=>{
    delete process.env.RENTAL_FINANCE_ENROLLMENT;const p=await h.paid(),id=await h.complete(p);assert.equal(await credit.financeContract(id),null);process.env.RENTAL_FINANCE_ENROLLMENT='true';
  });
  await test('timely cancellation preserves full unused credit without refund/fee/pay',async()=>{
    const o=await purchase(),j=await jobFixture(o);await worker(j);const count=h.charges.length;const result=await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);assert.equal(result.lateCancel,false);assert.equal(h.charges.length,count);assert.equal((await credit.entitlement(o.e.id)).balance,20000);assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,j.id))).length,0);assert.equal((await service.jobFinance(j.id)).cancellation,'timely_customer');
  });
  await test('first late cancel creates its own full fee and pays accepted workers only, never standby or unaccepted membership',async()=>{
    const o=await purchase(),j=await jobFixture(o,1800000),accepted=await worker(j);await worker(j,'backup');await worker(j,'laundry_lead',false);const result=await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);assert.equal(result.lateCancel,true);assert.equal(result.customerCharged,true);assert.equal(result.cleanerPaid,false);
    const op=await ops.operation('late:'+j.id);assert.equal(op.cents,20000);assert.notEqual(op.provider_id,o.e.source_payment_id);assert.equal((await credit.entitlement(o.e.id)).balance,20000);
    const pay=await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,j.id));assert.equal(pay.length,1);assert.equal(pay[0].cleanerId,accepted.id);assert.equal(pay[0].amount,'38.00');assert.equal((await db.select().from(schema.evidencePackets).where(eq(schema.evidencePackets.jobId,j.id))).length,0);
    const n=h.charges.length;await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);assert.equal(h.charges.length,n);assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,j.id))).length,1);
  });
  await test('failed fee collection retains cancellation, fee obligation, accepted payout and untouched credit',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000);await worker(j);failNext=true;const result=await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);assert.equal(result.customerCharged,false);assert.equal((await ops.operation('late:'+j.id)).state,'unknown');assert.equal((await db.select().from(schema.jobs).where(eq(schema.jobs.id,j.id)))[0].status,'canceled');assert.equal((await credit.entitlement(o.e.id)).balance,20000);assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,j.id))).length,1);await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);assert.equal((await ops.operation('late:'+j.id)).state,'paid');
  });
  await test('lost accepted fee response reuses one persisted provider identity and amount',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000);lostNext=true;const before=h.charges.length;await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);assert.equal((await ops.operation('late:'+j.id)).state,'unknown');await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);assert.equal(h.charges.length,before+1);assert.equal((await ops.operation('late:'+j.id)).state,'paid');
  });
  await test('admin cancellation never levies a customer fee or consumes credit',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000);await worker(j);const result=await service.cancelFinancialJob(j.id,'admin','admin-1');assert.equal(result.lateCancel,false);assert.equal((await service.jobFinance(j.id)).cancellation,'business');assert.equal(await ops.operation('late:'+j.id),null);assert.equal((await credit.entitlement(o.e.id)).balance,20000);
  });
  await test('matching accepted scope uses the original funded first-clean price and applies only with canonical final evidence',async()=>{
    const o=await purchase(),j=await jobFixture(o);await assert.rejects(()=>service.prepareRentalCompletion(j.id),/Canonical/);assert.equal((await credit.entitlement(o.e.id)).balance,20000);await finalEvidence(j);const prepared=await service.prepareRentalCompletion(j.id);assert.equal(prepared.credit,20000);assert.equal(prepared.due,0);assert.equal((await credit.entitlement(o.e.id)).balance,20000);assert.equal((await credit.entitlement(o.e.id)).reserved,20000);await apply(j,prepared);assert.equal((await credit.entitlement(o.e.id)).balance,0);assert.equal((await credit.entitlement(o.e.id)).applied,20000);assert.equal(await db.transaction(tx=>credit.applyCredit(tx,j.id,o.e.id)),20000);
  });
  await test('two job settlements cannot reserve/spend the same prepayment',async()=>{
    const o=await purchase(),one=await jobFixture(o),two=await jobFixture(o);await finalEvidence(one);await finalEvidence(two);const prepared=await service.prepareRentalCompletion(one.id);await assert.rejects(()=>service.prepareRentalCompletion(two.id),/Another clean/);assert.equal((await credit.entitlement(o.e.id)).reserved,20000);await apply(one,prepared);const second=await service.prepareRentalCompletion(two.id);assert.equal(second.credit,0);assert.equal(second.due,20000);assert.equal(second.operationState,'paid');
  });
  await test('changed cheaper scope consumes its lower accepted price and preserves a partial remainder',async()=>{
    const o=await purchase();await db.update(schema.properties).set({bedCount:3}).where(eq(schema.properties.id,o.sub.propertyId));h.setPrice(150);const j=await jobFixture(o);await finalEvidence(j);const prepared=await service.prepareRentalCompletion(j.id);assert.equal(prepared.total,15000);await apply(j,prepared);assert.equal((await credit.entitlement(o.e.id)).balance,5000);h.setPrice(200);
  });
  await test('changed more expensive scope requires exact explicit supplemental consent before new payment',async()=>{
    const o=await purchase();await db.update(schema.properties).set({bedCount:3}).where(eq(schema.properties.id,o.sub.propertyId));h.setPrice(250);const j=await jobFixture(o);await finalEvidence(j);const before=h.charges.length;await assert.rejects(()=>service.prepareRentalCompletion(j.id),/requires customer approval/);assert.equal(h.charges.length,before);assert.equal((await credit.entitlement(o.e.id)).balance,20000);await assert.rejects(()=>service.prepareRentalCompletion(j.id,{actor:o.sub.customerId,expectedCents:4999}),/amount changed/);const prepared=await service.prepareRentalCompletion(j.id,{actor:o.sub.customerId,expectedCents:5000});assert.equal(prepared.due,5000);await apply(j,prepared);assert.equal((await credit.entitlement(o.e.id)).balance,0);h.setPrice(200);
  });
  await test('DB refuses cross-owner reservation, legacy completion/charge bypass and history deletion',async()=>{
    const o=await purchase(),other=await purchase(),j=await jobFixture(other);await assert.rejects(()=>db.execute(sql`insert into prepaid_reservations(job_id,entitlement_id,cents) values(${j.id}::uuid,${o.e.id}::uuid,1000)`));
    await assert.rejects(()=>db.update(schema.jobs).set({paymentIntentId:o.e.source_payment_id,paymentStatus:'captured'}).where(eq(schema.jobs.id,j.id)));
    await assert.rejects(()=>db.update(schema.jobs).set({status:'completed'}).where(eq(schema.jobs.id,j.id)));await assert.rejects(()=>db.delete(schema.jobs).where(eq(schema.jobs.id,j.id)));
  });
  await test('customer/property readers deny another owner and never expose provider request parameters',async()=>{
    const o=await purchase(),j=await jobFixture(o);await service.ensureJobFinance(j.id);await assert.rejects(()=>admin.loadJobFinance(j.id,crypto.randomUUID()),/not found/);await assert.rejects(()=>admin.propertyPrepayment(o.sub.propertyId,crypto.randomUUID()),/not found/);const view=await admin.loadJobFinance(j.id,o.sub.customerId);assert.equal(JSON.stringify(view).includes('sourcePaymentId'),false);assert.equal(JSON.stringify(view).includes('params'),false);
  });
  await test('reasoned partial credit refund records confirmed provider outcome and retains remaining credit exactly once',async()=>{
    const o=await purchase(),request=crypto.randomUUID();const first=await admin.refundCredit(o.e.id,'admin-1','Approved exceptional refund',request,5000);assert.equal(first.state,'refunded');assert.equal((await credit.entitlement(o.e.id)).balance,15000);assert.equal((await admin.refundCredit(o.e.id,'admin-1','Approved exceptional refund',request,5000)).state,'refunded');assert.equal((await credit.entitlement(o.e.id)).balance,15000);await credit.verifyCreditSource(stripe,await credit.entitlement(o.e.id));await assert.rejects(()=>db.update(schema.prepaidEntries).set({cents:1}).where(eq(schema.prepaidEntries.entitlementId,o.e.id)));
  });
  await test('reserved credit cannot be refunded and unrecognized external refund freezes spending',async()=>{
    const o=await purchase(),j=await jobFixture(o);await finalEvidence(j);await service.prepareRentalCompletion(j.id);await assert.rejects(()=>admin.refundCredit(o.e.id,'admin-1','Approved exceptional refund',crypto.randomUUID(),1000),/unreserved/);
    o.payment.pi.latest_charge.amount_refunded=1000;h.refundRows.push({id:'re_external',payment_intent:o.payment.pi.id,amount:1000,status:'succeeded'});await assert.rejects(async()=>credit.verifyCreditSource(stripe,await credit.entitlement(o.e.id)));assert.equal((await credit.entitlement(o.e.id)).state,'held');
  });
  await test('full separate fee refund preserves credit and the already-recorded worker payout',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000);await worker(j);await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);await admin.adminFinanceAction(j.id,'admin-1',{action:'refund_fee',reason:'Approved exceptional full fee refund',requestId:crypto.randomUUID()});assert.equal((await ops.operation('late:'+j.id)).state,'refunded');assert.equal((await credit.entitlement(o.e.id)).balance,20000);assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,j.id))).length,1);
  });
  await test('full canonical settlement atomically completes the job, applies credit once, records reserve and creates one worker payout',async()=>{
    const o=await purchase(),j=await jobFixture(o),cleaner=await worker(j);await finalEvidence(j);
    const terms={protocol:'pre2c-hotfix-v1',plannedStart:j.checkInTime.toISOString(),plannedDeadline:j.checkOutTime.toISOString(),timezone:'America/New_York',calendarIdentity:j.calendarEventUid,source:j.jobSource,propertyCheckOutTime:null,propertyCheckInTime:null,rooms:[{roomKey:'living',label:'Living',minPhotos:1}],checklist:[{id:'clean',task:'Clean issued scope'}]};
    await db.insert(schema.jobExecutionContracts).values({jobId:j.id,protocol:terms.protocol,terms});
    const upload={uploadId:crypto.randomUUID(),jobId:j.id,cleanerId:cleaner.id,roomKey:'living',path:'synthetic/living.jpg',byteSize:100,mime:'image/jpeg',sha256:'a'.repeat(64),state:'verified',verifiedAt:new Date()};
    await db.insert(schema.evidenceUploadManifest).values(upload);const items=terms.checklist.map(i=>({...i,completed:true}));
    const hash=crypto.createHash('sha256').update(JSON.stringify({items,notes:'',uploads:[[upload.uploadId,upload.sha256]]})).digest('hex');
    await db.insert(schema.jobEvidenceDrafts).values({jobId:j.id,items,notes:'',finalHash:hash});
    await db.update(schema.evidencePackets).set({photoUrls:[upload.path],cleanerNotes:'',checklistLog:{items,roomPhotos:{living:[upload.path]}}}).where(eq(schema.evidencePackets.jobId,j.id));
    const settle=require('../lib/services/payment/execution-settlement.ts').settleExecutionJob;
    const first=await settle(j.id);assert.equal(first.ok,true,JSON.stringify(first));assert.equal((await settle(j.id)).ok,true);assert.equal((await credit.entitlement(o.e.id)).balance,0);
    assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,j.id))).length,1);assert.equal((await db.select().from(schema.reserveTransactions).where(eq(schema.reserveTransactions.jobId,j.id))).length,1);assert.equal((await db.select().from(schema.jobs).where(eq(schema.jobs.id,j.id)))[0].status,'completed');
  });
  await test('subscription cancellation/end leaves the entitlement usable for an explicitly reactivated term without another upfront charge',async()=>{
    const o=await purchase(),before=h.charges.length;await db.update(schema.subscriptions).set({status:'canceled'}).where(eq(schema.subscriptions.id,o.sub.id));
    const service=require('../lib/services/payment/rental-reactivation.ts'),day=require('../lib/time/eastern.ts').toEasternDateString;
    const startDate=day(new Date(Date.now()+7*86400000)),endDate=require('../lib/subscriptions/rental-finance-policy.ts').rentalReactivationEndDate(startDate,1),input={startDate,endDate,durationMonths:1,reason:'Customer agreed to a new service term',requestId:crypto.randomUUID()};
    const result=await service.reactivateRentalSubscription(o.sub.id,'admin-1',input);assert.notEqual(result.subscriptionId,o.sub.id);assert.equal((await service.reactivateRentalSubscription(o.sub.id,'admin-1',input)).subscriptionId,result.subscriptionId);assert.equal(h.charges.length,before);
    assert.equal((await credit.financeContract(result.subscriptionId)).entitlement_id,o.e.id);assert.equal((await credit.entitlement(o.e.id)).balance,20000);assert.equal((await h.sub(o.sub.id)).status,'canceled');
    const next=await h.sub(result.subscriptionId),term=await require('../lib/services/subscription-term.service.ts').readSubscriptionTerm(next.id);assert.equal(term.endDate,endDate);
    const [scoped]=await require('../lib/services/subscription-minimum.service.ts').withSubscriptionMinimums([next]);assert.equal(scoped.cancellationMinimum.policy,'thirty_calendar_days_v1');
    await assert.rejects(()=>jobFixture({...o,sub:next},100*86400000),/Failed query/);
  });
  await test('old/out-of-order financial payment webhooks retrieve current truth and cannot regress a refunded fee',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000);await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);const fee=await ops.operation('late:'+j.id);
    const reconcile=require('../lib/services/payment/rental-finance-reconciliation.ts').reconcileRentalFinancialPayment;
    assert.equal(await reconcile(stripe,fee.provider_id,'evt_synthetic_paid'),true);await admin.adminFinanceAction(j.id,'admin-1',{action:'refund_fee',reason:'Approved exceptional full refund',requestId:crypto.randomUUID()});await reconcile(stripe,fee.provider_id,'evt_synthetic_old_paid');assert.equal((await ops.operation('late:'+j.id)).state,'refunded');
  });
  await test('source disputes freeze remaining credit, retain history and prevent another settlement',async()=>{
    const o=await purchase(),j=await jobFixture(o);await finalEvidence(j);o.payment.pi.latest_charge.disputed=true;
    const reconcile=require('../lib/services/payment/rental-finance-reconciliation.ts').reconcileRentalFinancialPayment;await reconcile(stripe,o.payment.pi.id,'evt_synthetic_dispute',true);assert.equal((await credit.entitlement(o.e.id)).state,'held');await assert.rejects(()=>service.prepareRentalCompletion(j.id));
  });
  await test('unknown provider result beyond safe key-retention window fails closed without another POST',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000);lostNext=true;await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);const fee=await ops.operation('late:'+j.id),before=h.charges.length,clock=Date.now;
    try{Date.now=()=>clock()+25*3600000;assert.equal((await ops.runOperation(fee.identity)).state,'review');assert.equal(h.charges.length,before);}finally{Date.now=clock;}
  });
  await test('property transfer cannot expose or spend the original owner credit, while admin retains history',async()=>{
    const o=await purchase(),other=await purchase(),j=await jobFixture(o);await service.ensureJobFinance(j.id);await db.update(schema.properties).set({customerId:other.sub.customerId}).where(eq(schema.properties.id,o.sub.propertyId));
    assert.equal((await admin.propertyPrepayment(o.sub.propertyId,other.sub.customerId)).length,0);assert.equal((await admin.propertyPrepayment(o.sub.propertyId)).length,1);await assert.rejects(()=>service.cancelFinancialJob(j.id,'customer',other.sub.customerId),/ownership changed/);await assert.rejects(()=>admin.loadJobFinance(j.id,other.sub.customerId),/ownership/);
  });
  await test('verified provider binding recovers an expired unknown attempt without another collection',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000);lostNext=true;const before=h.charges.length;await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);const fee=await ops.operation('late:'+j.id),pi=[...h.intents.values()].find(p=>p.metadata.rental_financial_operation_id===fee.id),clock=Date.now;
    try{Date.now=()=>clock()+25*3600000;await ops.runOperation(fee.identity);}finally{Date.now=clock;}
    const another=await purchase();await assert.rejects(()=>admin.reconcileRecordedOperation(fee.id,another.payment.pi.id,'admin-1','Reviewed provider payment mismatch',crypto.randomUUID()),/does not match/);
    assert.equal((await admin.reconcileRecordedOperation(fee.id,pi.id,'admin-1','Verified original provider collection',crypto.randomUUID())).state,'paid');assert.equal(h.charges.length,before+2);
  });
  await test('reasoned waiver of a known unsubmitted fee never charges or consumes credit',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000);const f=await service.ensureJobFinance(j.id);
    await ops.prepareOperation(db,{identity:'late:'+j.id,jobId:j.id,kind:'late_fee',cents:f.quote.chargeAmountCents,params:{amount:f.quote.chargeAmountCents,currency:'usd',customer:o.payment.pi.customer},actor:'synthetic',reason:'Frozen fee obligation'});
    const before=h.charges.length;await admin.adminFinanceAction(j.id,'admin-1',{action:'waive_fee',reason:'Approved exception before collection',requestId:crypto.randomUUID()});assert.equal((await ops.operation('late:'+j.id)).state,'waived');assert.equal(h.charges.length,before);assert.equal((await credit.entitlement(o.e.id)).balance,20000);
  });
  await test('missing accepted pay terms refuse cancellation before any fee/payout and preserve credit',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000),w=await worker(j);await db.update(schema.jobsToCleaners).set({frozenHourlyRateCents:null}).where(eq(schema.jobsToCleaners.cleanerId,w.id));const before=h.charges.length;await assert.rejects(()=>service.cancelFinancialJob(j.id,'customer',o.sub.customerId),/pay terms/);assert.equal(h.charges.length,before);assert.equal((await credit.entitlement(o.e.id)).balance,20000);
  });
  await test('the actual checkout agreement route rejects a forged secret and persists the pinned policy before payment',async()=>{
    const p=await h.paid(),savedSecret=p.pi.client_secret;p.pi.status='requires_payment_method';
    const route=require('../app/api/payment/accept-rental-terms/route.ts');
    const request=secret=>new Request('https://example.invalid/api/payment/accept-rental-terms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientSecret:secret,accepted:true})});
    p.pi.client_secret=p.pi.id+'_secret_synthetic_for_test';
    assert.equal((await route.POST(request(p.pi.id+'_secret_wrong_secret'))).status,403);assert.equal((await route.POST(request(p.pi.client_secret))).status,200);
    p.pi.status='succeeded';assert.ok(await h.complete(p));p.pi.client_secret=savedSecret;
  });
  await test('customer APIs refuse other-owner finance actions, admin APIs refuse customers, and raw exceptions are sanitized',async()=>{
    const o=await purchase(),j=await jobFixture(o);replace('lib/customer-auth.ts',{getCustomerAuth:async()=>({customerId:crypto.randomUUID(),error:null}),customerAuthErrorStatus:()=>401});
    const route=require('../app/api/customer/jobs/[id]/finance/route.ts');const response=await route.GET(new Request('https://example.invalid'),{params:Promise.resolve({id:j.id})});assert.equal(response.status,404);
    replace('lib/admin-auth.ts',{getAdminAuth:async()=>({isAdmin:false,actorId:null})});const adminRoute=require('../app/api/admin/jobs/[id]/finance/route.ts');assert.equal((await adminRoute.GET(new Request('https://example.invalid'),{params:Promise.resolve({id:j.id})})).status,401);
    const {financeErrorMessage}=require('../lib/services/payment/rental-finance-error.ts');assert.equal(financeErrorMessage(new Error('driver SQL with private parameters')).includes('private parameters'),false);
  });
  await test('disabling schema readers cannot route an enrolled job into legacy collection or cancellation',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000);await service.ensureJobFinance(j.id);const before=h.charges.length;delete process.env.RENTAL_FINANCE_SCHEMA_READY;
    try{await assert.rejects(()=>service.prepareFinancialJob(j.id),/compatible readers/);await assert.rejects(()=>service.cancelFinancialJob(j.id,'customer',o.sub.customerId),/compatible readers/);assert.equal(h.charges.length,before);}finally{process.env.RENTAL_FINANCE_SCHEMA_READY='true';}
  });
  await test('scope identity ignores tub presence without service and periodic drain occurrence without losing purchased base scope',async()=>{
    const input={bedrooms:2,bathrooms:1,sqft:1000,laundryService:'none',petsAllowed:false,hasHotTub:true,hotTubService:false,hotTubDrain:false};
    assert.equal(credit.rentalScope(input),credit.rentalScope({...input,hasHotTub:false}));assert.equal(credit.rentalScope({...input,hotTubService:true}),credit.rentalScope({...input,hotTubService:true,hotTubDrain:true,hotTubDrainCadence:'4_weeks'}));
  });
  await test('purchased first-clean discount survives a later price change and a separate first late cancellation',async()=>{
    const discounts=require('../lib/pricing/first-clean-discount.ts'),oldGet=discounts.getFirstCleanDiscountPercent,oldApply=discounts.applyFirstCleanDiscount;
    discounts.getFirstCleanDiscountPercent=async()=>10;discounts.applyFirstCleanDiscount=(cents,percent)=>Math.round(cents*(1-percent/100));
    try{const o=await purchase();assert.equal(o.e.balance,18000);h.setPrice(250);const canceled=await jobFixture(o,3600000);await service.cancelFinancialJob(canceled.id,'customer',o.sub.customerId);assert.equal((await ops.operation('late:'+canceled.id)).cents,25000);assert.equal((await credit.entitlement(o.e.id)).balance,18000);const j=await jobFixture(o);await finalEvidence(j);const prepared=await service.prepareRentalCompletion(j.id);assert.equal(prepared.total,18000);assert.equal(prepared.due,0);await apply(j,prepared);}finally{discounts.getFirstCleanDiscountPercent=oldGet;discounts.applyFirstCleanDiscount=oldApply;h.setPrice(200);}
  });
  await test('pending refund holds spendability and does not debit credit until confirmed success',async()=>{
    const o=await purchase(),request=crypto.randomUUID(),create=stripe.refunds.create;let refund;
    stripe.refunds.create=async(...args)=>{refund=await create(...args);refund.status='pending';o.payment.pi.latest_charge.amount_refunded-=refund.amount;o.payment.pi.latest_charge.refunded=false;return refund;};
    try{assert.equal((await admin.refundCredit(o.e.id,'admin-1','Approved pending partial refund',request,5000)).state,'processing');assert.equal((await credit.entitlement(o.e.id)).balance,20000);assert.equal((await credit.entitlement(o.e.id)).state,'held');refund.status='succeeded';o.payment.pi.latest_charge.amount_refunded+=5000;assert.equal((await admin.refundCredit(o.e.id,'admin-1','Approved pending partial refund',request,5000)).state,'refunded');assert.equal((await credit.entitlement(o.e.id)).balance,15000);}finally{stripe.refunds.create=create;}
  });
  await test('authentication-required fee exposes one owner-only existing payment and never creates normal completion',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000),create=stripe.paymentIntents.create;let heldCharge,pi;
    stripe.paymentIntents.create=async(...args)=>{pi=await create(...args);heldCharge=pi.latest_charge;pi.status='requires_action';pi.amount_received=0;pi.latest_charge=null;return pi;};
    try{await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);}finally{stripe.paymentIntents.create=create;}
    assert.equal((await ops.operation('late:'+j.id)).state,'requires_action');const count=h.charges.length;
    const action=await admin.customerFinanceAction(j.id,o.sub.customerId,'pay_fee',20000);assert.ok(action.clientSecret);assert.equal(h.charges.length,count);
    pi.status='succeeded';pi.amount_received=pi.amount;pi.latest_charge=heldCharge;await admin.customerFinanceAction(j.id,o.sub.customerId,'reconcile');assert.equal((await ops.operation('late:'+j.id)).state,'paid');assert.equal((await db.select().from(schema.jobs).where(eq(schema.jobs.id,j.id)))[0].status,'canceled');assert.equal((await credit.entitlement(o.e.id)).balance,20000);
  });
  await test('a reclaimed operation fences an obsolete delayed provider result while reusing one key',async()=>{
    const o=await purchase(),j=await jobFixture(o,3600000);failNext=true;await service.cancelFinancialJob(j.id,'customer',o.sub.customerId);const fee=await ops.operation('late:'+j.id),create=stripe.paymentIntents.create;let entered,release;
    const paused=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});let once=true;
    stripe.paymentIntents.create=async(...args)=>{const pi=await create(...args);if(once){once=false;entered();await gate;}return pi;};
    const first=ops.runOperation(fee.identity).catch(error=>error);await paused;const clock=Date.now;
    try{Date.now=()=>clock()+61000;assert.equal((await ops.runOperation(fee.identity)).state,'paid');}finally{Date.now=clock;release();stripe.paymentIntents.create=create;}
    assert.match((await first).message,/newer reconciliation/);assert.equal((await ops.operation(fee.identity)).state,'paid');
  });
  await test('accepted subscription dates and rate-bearing duration cannot be rewritten after financial enrollment',async()=>{
    const o=await purchase();await assert.rejects(()=>db.update(schema.subscriptions).set({durationMonths:6}).where(eq(schema.subscriptions.id,o.sub.id)));await assert.rejects(()=>db.update(schema.subscriptions).set({endDate:'2099-01-01'}).where(eq(schema.subscriptions.id,o.sub.id)));assert.equal((await credit.entitlement(o.e.id)).balance,20000);
  });
  await test('below-minimum supplemental balance can be explicitly waived without inventing collected money',async()=>{
    const o=await purchase();await admin.refundCredit(o.e.id,'admin-1','Approved one-cent refund exception',crypto.randomUUID(),1);const j=await jobFixture(o);await finalEvidence(j);
    await assert.rejects(()=>service.prepareRentalCompletion(j.id),/requires customer approval/);const before=h.charges.length;
    await admin.adminFinanceAction(j.id,'admin-1',{action:'waive_clean_balance',reason:'Approved waiver below provider minimum',requestId:crypto.randomUUID()});const prepared=await service.prepareRentalCompletion(j.id);assert.equal(prepared.due,1);assert.equal(prepared.operationState,'waived');assert.equal(prepared.collectedCents,19999);assert.equal(h.charges.length,before);await apply(j,prepared);assert.equal((await credit.entitlement(o.e.id)).balance,0);
  });
  console.log(`${passed} prepaid-credit/separate-fee checks passed. Synthetic PostgreSQL; controlled providers; no production access.`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>pg.close());
