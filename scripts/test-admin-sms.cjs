// Actual services/routes and SQL0068 in synthetic PostgreSQL. Root env is never
// loaded; every network path is blocked by the shared harness.
const h = require('./test-subscription-minimum.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { pg, db, schema, replace } = h, { eq } = require('drizzle-orm');
const root = path.resolve(__dirname, '..'), uuid = () => crypto.randomUUID();
const phone = '+12025550123', sender = '+12025550124', serviceSid = 'MG'+'a'.repeat(32), accountSid = 'AC'+'b'.repeat(32);
const sid = () => 'SM'+crypto.randomBytes(16).toString('hex');
let providerAvailable = true, createError = null, duringCreate = null, emailMode = 'off', authorized = false;
const requests = [], emailRequests = [], snapshots = new Map(), cleanerPreferences = [];
const messages = id => ({ fetch: async () => { if (!snapshots.has(id)) throw Error('Synthetic provider lookup unavailable'); return snapshots.get(id); } });
messages.create = async input => { requests.push(input); if (duringCreate) await duringCreate(); if (createError) throw createError; return { sid: sid() }; };
replace('lib/services/sms.service.ts', { getTwilio: () => providerAvailable ? { messages } : null });
replace('lib/resend.ts', { EMAIL_FROM: 'synthetic@example.invalid', getEmailUnavailableMessage: () => 'Synthetic email disabled',
  getResend: () => emailMode === 'off' ? null : { emails: { send: async input => { emailRequests.push(input); if (emailMode === 'throw') throw Error('Synthetic lost email response'); return { data:{id:'synthetic'},error:null }; } } } });
replace('lib/emails/TransactionalEmail.tsx', { __esModule:true,default:props=>props });
replace('lib/admin-auth.ts', { getAdminAuth: async () => ({ isAdmin:authorized,userRole:authorized?'admin':'customer',error:null }) });
replace('lib/services/cleaner-sms-consent.ts', { recordCarrierSmsPreference:async (...args)=>{cleanerPreferences.push(args);} });
delete require.cache[require.resolve('../lib/services/email.service.ts')];
const email = require('../lib/services/email.service.ts'), sms = require('../lib/services/notifications/admin-sms.service.ts');
const { adminSmsDestination } = require('../lib/notifications/admin-sms.ts');
const incoming = require('../app/api/twilio/incoming/route.ts'), callback = require('../app/api/twilio/status/route.ts');
const statusRoute = require('../app/api/admin/admin-sms/route.ts'), twilio = require('twilio');
const { NextRequest } = require('next/server');
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS '+name); }
async function sql(query, args=[]) { return (await pg.query(query,args)).rows; }
const intents = () => sql('select * from admin_sms_intents order by created_at,identity');
const intent = async identity => (await sql('select * from admin_sms_intents where identity=$1',[identity]))[0];
const pref = async () => (await sql('select * from admin_sms_preferences where recipient=$1 and sender_key=$2',[phone,'service:'+serviceSid]))[0];
const notice = identity => ({ identity,category:'assignment',destination:'/admin/notifications' });
function configure() {
  Object.assign(process.env, { ADMIN_SMS_ENABLED:'true',ADMIN_SMS_SCHEMA_READY:'true',ADMIN_SMS_TO:phone,ADMIN_SMS_ENVIRONMENT:'test',ADMIN_SMS_TEST_RECIPIENTS:phone,
    TWILIO_MESSAGING_SERVICE_SID:serviceSid,TWILIO_ACCOUNT_SID:accountSid,TWILIO_AUTH_TOKEN:'synthetic-token',TWILIO_FROM_NUMBER:sender,
    TWILIO_INCOMING_WEBHOOK_URL:'https://app.example.invalid/api/twilio/incoming',TWILIO_STATUS_WEBHOOK_URL:'https://app.example.invalid/api/twilio/status',
    NEXT_PUBLIC_APP_URL:'https://app.example.invalid',NOTIFICATION_WORKFLOWS_SCHEMA_READY:'true' });
}
function carrier(at) { const id=sid(); snapshots.set(id,{accountSid,from:phone,dateCreated:new Date(at)}); return id; }
function signedRequest(url, params, valid=true) {
  return new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':valid?twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN,url,params):'invalid'},body:new URLSearchParams(params)});
}
async function inbound(id,type,valid=true,changes={}) {
  return incoming.POST(signedRequest(process.env.TWILIO_INCOMING_WEBHOOK_URL,{AccountSid:accountSid,MessagingServiceSid:serviceSid,From:phone,To:sender,MessageSid:id,OptOutType:type,Body:type,...changes},valid));
}
async function run() {
  await h.setup();
  await pg.exec('DROP TABLE admin_sms_intents,admin_sms_preferences,admin_sms_carrier_events');
  const migration=fs.readFileSync(path.join(root,'db/supabase/migrations/0068_admin_operations_sms.sql'),'utf8');
  await test('actual migration reapplies without enrolling recipients and denies client roles',async()=>{
    await pg.exec(migration);await pg.exec(migration);assert.equal((await intents()).length,0);
    for(const table of ['admin_sms_intents','admin_sms_preferences','admin_sms_carrier_events']) {
      assert.equal((await sql('select relrowsecurity v from pg_class where oid=$1::regclass',[table]))[0].v,true);
      for(const role of ['anon','authenticated']) assert.equal((await sql('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') v',[role,table]))[0].v,false);
    }
  });
  await test('disabled/missing-number configuration makes no intent, preference or provider request',async()=>{
    assert.equal((await sms.enqueueAdminSms(notice('disabled'))).state,'disabled');
    configure();process.env.ADMIN_SMS_TO='';assert.equal((await sms.enqueueAdminSms(notice('missing'))).state,'skipped');
    assert.equal((await sms.dispatchAdminSms()).disabled,true);assert.equal((await intents()).length,0);assert.equal(requests.length,0);
    assert.equal((await sql('select * from admin_sms_preferences')).length,0);
  });
  await test('readiness, explicit environment, international number and independent TEST allowlist are mandatory',async()=>{
    for(const [key,value] of [['ADMIN_SMS_SCHEMA_READY','false'],['ADMIN_SMS_ENVIRONMENT',''],['ADMIN_SMS_TO','2025550123'],['ADMIN_SMS_TO','+1evil'],['ADMIN_SMS_TEST_RECIPIENTS',''],['TWILIO_MESSAGING_SERVICE_SID','malformed']]) {
      configure();process.env[key]=value;assert.equal((await sms.enqueueAdminSms(notice('invalid-'+key+value))).state,'skipped');
    }
    assert.equal((await intents()).length,0);configure();
  });
  let first;
  await test('recipient need not be a cleaner; duplicate event has one frozen private intent',async()=>{
    first=await sms.enqueueAdminSms(notice('one-event'));await sms.enqueueAdminSms(notice('one-event'));
    assert.equal((await intents()).length,1);assert.equal((await intent(first.identity)).recipient,phone);
    assert.ok((await pref()).opted_in_at);assert.equal((await db.select().from(schema.cleaners)).length,0);
  });
  await test('only one pending intent is claimed before a provider call and summaries contain no private text',async()=>{
    const second=await sms.enqueueAdminSms({...notice('second'),destination:'https://evil.invalid/?code=9999'});
    let checked=false;duringCreate=async()=>{if(!checked){checked=true;assert.equal((await sql("select * from admin_sms_intents where state='claimed'")).length,1);assert.equal((await sql("select * from admin_sms_intents where state='pending'")).length,1);}};
    await sms.dispatchAdminSms();duringCreate=null;
    assert.equal((await intent(first.identity)).state,'sent');assert.equal((await intent(second.identity)).state,'sent');
    assert.equal(requests.length,2);assert.equal(requests[0].to,phone);assert.equal(requests[0].messagingServiceSid,serviceSid);
    for(const request of requests){assert.match(request.body,/CleanNami: Assignment update/);assert.match(request.body,/Reply STOP/);assert.doesNotMatch(request.body,/evil|9999/);assert.equal(request.statusCallback,process.env.TWILIO_STATUS_WEBHOOK_URL);}
    assert.equal(adminSmsDestination('/admin/notifications?secret=1',null),'/admin/notifications');
    assert.equal((await sms.loadAdminSmsStatus()).items.find(x=>x.identity===first.identity).delivery_status,null);
  });
  await test('accepted SMS is not retried; provider delivery callback is separate, signed and monotonic',async()=>{
    const count=requests.length;await sms.dispatchAdminSms();assert.equal(requests.length,count);
    const saved=await intent(first.identity),params={AccountSid:accountSid,MessageSid:saved.provider_sid,MessageStatus:'delivered'};
    assert.equal((await callback.POST(signedRequest(process.env.TWILIO_STATUS_WEBHOOK_URL,params,false))).status,403);
    assert.equal((await callback.POST(signedRequest(process.env.TWILIO_STATUS_WEBHOOK_URL,params))).status,204);
    assert.equal((await callback.POST(signedRequest(process.env.TWILIO_STATUS_WEBHOOK_URL,{...params,MessageStatus:'queued'}))).status,204);
    assert.equal((await sms.loadAdminSmsStatus()).items.find(x=>x.identity===first.identity).delivery_status,'delivered');
  });
  await test('history cannot be retargeted, reset to pending, rebound or deleted',async()=>{
    for(const query of ["update admin_sms_intents set recipient='+12025550199' where identity=$1","update admin_sms_intents set state='pending' where identity=$1","update admin_sms_intents set provider_sid='SM00000000000000000000000000000000' where identity=$1","delete from admin_sms_intents where identity=$1"])
      await assert.rejects(()=>sql(query,[first.identity]),/immutable|retained/);
  });
  await test('recipient, sender or environment changes never retarget queued notices',async()=>{
    for(const [key,value] of [['ADMIN_SMS_TO','+12025550199'],['TWILIO_MESSAGING_SERVICE_SID','MG'+'c'.repeat(32)]]) {
      configure();const saved=await sms.enqueueAdminSms(notice('change-'+key));process.env[key]=value;if(key==='ADMIN_SMS_TO')process.env.ADMIN_SMS_TEST_RECIPIENTS=value;
      await sms.dispatchAdminSms();assert.equal((await intent(saved.identity)).state,'skipped');
    }
    configure();const saved=await sms.enqueueAdminSms(notice('mode-change'));process.env.ADMIN_SMS_ENVIRONMENT='production';await sms.dispatchAdminSms();assert.equal((await intent(saved.identity)).state,'pending');
    configure();await sms.dispatchAdminSms(new Date(Date.now()+31*60000));assert.equal((await intent(saved.identity)).state,'skipped');
  });
  await test('30-minute operational expiry and current GPS eligibility are rechecked at dispatch',async()=>{
    configure();const stale=await sms.enqueueAdminSms(notice('expired'));await sms.dispatchAdminSms(new Date(Date.now()+31*60000));assert.equal((await intent(stale.identity)).state,'skipped');
    const [job]=await db.insert(schema.jobs).values({calendarEventUid:uuid(),status:'assigned',checkInTime:new Date(Date.now()-60*60000)}).returning();
    const gps=await sms.enqueueAdminSms({identity:'gps-arrived',category:'gps_overdue'},job.id);
    await db.update(schema.jobs).set({status:'in-progress'}).where(eq(schema.jobs.id,job.id));await sms.dispatchAdminSms();assert.equal((await intent(gps.identity)).state,'skipped');
  });
  await test('missing credentials, definite rejection and uncertain acceptance remain distinct and never replay',async()=>{
    const count=requests.length;providerAvailable=false;const missing=await sms.enqueueAdminSms(notice('credentials'));await sms.dispatchAdminSms();assert.equal((await intent(missing.identity)).state,'failed');assert.equal(requests.length,count);providerAvailable=true;
    for(const [identity,error,state] of [['reject',{status:400,code:21211},'failed'],['transport',Error('Lost response'),'unknown'],['timeout',{status:408},'unknown'],['server',{status:503},'unknown']]) {
      createError=error;const saved=await sms.enqueueAdminSms(notice(identity));await sms.dispatchAdminSms();assert.equal((await intent(saved.identity)).state,state);
    }
    createError=null;const after=requests.length;await sms.dispatchAdminSms();assert.equal(requests.length,after);
  });
  await test('a provider request that never resolves becomes unknown after the bounded deadline',async()=>{
    const saved=await sms.enqueueAdminSms(notice('hung-provider')),originalTimeout=global.setTimeout;
    duringCreate=()=>new Promise(()=>{});global.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===10000?5:ms,...args);
    try { await sms.dispatchAdminSms();assert.equal((await intent(saved.identity)).state,'unknown'); }
    finally { duringCreate=null;global.setTimeout=originalTimeout; }
    const count=requests.length;await sms.dispatchAdminSms();assert.equal(requests.length,count);
  });
  await test('admin email failure or missing Resend does not suppress SMS; private email content never enters SMS',async()=>{
    for(const mode of ['off','throw']) {
      emailMode=mode;const result=await email.sendAdminAlertEmail({to:'admin@example.invalid',subject:'Secret code 123456',message:'Door key PRIVATE',smsIdentity:'email-'+mode,url:'https://evil.invalid/private'});
      assert.equal(result.success,false);
    }
    const before=requests.length;await sms.dispatchAdminSms();assert.equal(requests.length,before+2);
    for(const request of requests.slice(before))assert.doesNotMatch(request.body,/Secret|123456|PRIVATE|evil/);
  });
  await test('SMS database failure does not suppress a working email',async()=>{
    emailMode='on';await pg.exec('ALTER TABLE admin_sms_intents RENAME TO admin_sms_intents_unavailable');
    try { assert.equal((await email.sendAdminAlertEmail({to:'admin@example.invalid',subject:'Notice',message:'Message',smsIdentity:'db-down'})).success,true); }
    finally { await pg.exec('ALTER TABLE admin_sms_intents_unavailable RENAME TO admin_sms_intents'); }
  });
  await test('customer and cleaner transactional emails never become admin SMS based on matching mailbox',async()=>{
    const count=(await intents()).length;
    await email.sendTransactionalEmail('admin@example.invalid','Customer receipt',{previewText:'Receipt',heading:'Receipt',bodyLines:['Private receipt']},{trigger:'one_off_receipt'});
    await email.sendCleanerAssignmentEmail({to:'admin@example.invalid',name:'Synthetic',propertyAddress:'Private',jobDate:'2027-01-01'});
    assert.equal((await intents()).length,count);
  });
  await test('multiple admin email recipients and durable caller retries create one SMS',async()=>{
    for(const role of ['admin','super_admin'])await db.insert(schema.users).values({supabaseUserId:uuid(),email:uuid()+'@example.invalid',role});
    const { notifyAdmins }=require('../lib/queries/admin-notifications.ts');const count=(await intents()).length,before=emailRequests.length;
    const event={type:'assignment',title:'Synthetic staffing exception',message:'Private',email:true,eventIdentity:'stable-lifecycle-action'};
    await notifyAdmins(event);await notifyAdmins(event);assert.equal((await intents()).length,count+1);assert.equal(emailRequests.length,before+4);
    await sms.dispatchAdminSms();
  });
  await test('management workflow queues SMS independently of its email TEST allowlist',async()=>{
    Object.assign(process.env,{NOTIFICATION_WORKFLOWS_ENABLED:'true',NOTIFICATION_WORKFLOWS_ENVIRONMENT:'test',NOTIFICATION_WORKFLOWS_SINCE:new Date(Date.now()-86400000).toISOString(),NOTIFICATION_TEST_RECIPIENTS:''});
    const [job]=await db.insert(schema.jobs).values({calendarEventUid:uuid(),status:'assigned',checkInTime:new Date(Date.now()-60*60000)}).returning();
    const before=(await intents()).length;
    for(const kind of ['one_off_booking','turnover_created','gps_overdue','one_off_receipt']) {
      const identity=kind==='gps_overdue'?`gps_overdue:${job.id}:${job.checkInTime.toISOString()}:`:'workflow-'+kind;
      await db.insert(schema.notificationEvents).values({identity,kind,jobId:job.id});
    }
    const workflows=require('../lib/services/notifications/workflows.service.ts');await workflows.dispatchNotificationEvents();
    assert.equal((await intents()).length,before+3);await workflows.dispatchNotificationEvents();assert.equal((await intents()).length,before+3);
    await sms.dispatchAdminSms();
  });
  await test('subscription purchase alerts are mirrored but customer term-end emails are excluded',async()=>{
    const [customer]=await db.insert(schema.customers).values({name:'Synthetic owner',email:'admin@example.invalid'}).returning();
    const {toEasternDateString}=require('../lib/time/eastern.ts');const now=new Date(),endDate=toEasternDateString(new Date(+now+7*86400000));
    const [sub]=await db.insert(schema.subscriptions).values({customerId:customer.id,propertyId:uuid(),durationMonths:1,status:'active',startDate:toEasternDateString(now),endDate}).returning();
    for(const [kind,identity] of [['subscription_purchase','purchase:'+sub.id],['term_end',`term_end:${sub.id}:${endDate}`]]) await db.insert(schema.notificationEvents).values({identity,kind,subscriptionId:sub.id});
    const before=(await intents()).length;await require('../lib/services/notifications/workflows.service.ts').dispatchNotificationEvents(now);
    assert.equal((await intents()).length,before+1);assert.equal((await intents()).filter(x=>x.category==='subscription_purchase').length,1);await sms.dispatchAdminSms();
  });
  await test('signed STOP blocks admin SMS without creating a cleaner; duplicate delivery is harmless',async()=>{
    const stop=carrier('2026-11-13T10:00:20Z');assert.equal((await inbound(stop,'STOP',false)).status,403);assert.equal((await pref()).carrier_blocked,false);
    assert.equal((await inbound(stop,'STOP',true,{MessagingServiceSid:'MG'+'d'.repeat(32)})).status,403);
    assert.equal((await inbound(stop,'STOP')).status,200);assert.equal((await inbound(stop,'STOP')).status,200);assert.equal((await pref()).carrier_blocked,true);
    assert.equal((await sql('select * from admin_sms_carrier_events where message_sid=$1',[stop])).length,1);assert.equal((await db.select().from(schema.cleaners)).length,0);assert.ok(cleanerPreferences.length);
    const saved=await sms.enqueueAdminSms(notice('blocked'));await sms.dispatchAdminSms();assert.equal((await intent(saved.identity)).state,'skipped');
  });
  await test('older STOP cannot overwrite newer STOP; stale/same-second START cannot clear either',async()=>{
    await inbound(carrier('2026-11-13T10:00:10Z'),'STOP');assert.equal(new Date((await pref()).last_stop_at).toISOString(),'2026-11-13T10:00:20.000Z');
    for(const at of ['2026-11-13T10:00:15Z','2026-11-13T10:00:20Z']){assert.equal((await inbound(carrier(at),'START')).status,200);assert.equal((await pref()).carrier_blocked,true);}
    await inbound(carrier('2026-11-13T10:00:21Z'),'START');assert.equal((await pref()).carrier_blocked,false);
    await inbound(carrier('2026-11-13T10:00:19Z'),'STOP');assert.equal((await pref()).carrier_blocked,false);
  });
  await test('unverifiable STOP blocks immediately and unverifiable START requests retry instead of clearing',async()=>{
    const stop=sid();assert.equal((await inbound(stop,'STOP')).status,200);assert.equal((await pref()).carrier_blocked,true);
    const start=sid();assert.equal((await inbound(start,'START')).status,503);assert.equal((await pref()).carrier_blocked,true);
    snapshots.set(start,{accountSid,from:phone,dateCreated:new Date('2026-11-13T10:00:30Z')});assert.equal((await inbound(start,'START')).status,503);
    snapshots.set(stop,{accountSid,from:phone,dateCreated:new Date('2026-11-13T10:00:25Z')});assert.equal((await inbound(start,'START')).status,200);assert.equal((await pref()).carrier_blocked,false);
    await assert.rejects(()=>sql('update admin_sms_carrier_events set blocked=false where message_sid=$1',[stop]),/append only/);
  });
  await test('START never enables application sending and provider 21610 suppresses subsequent attempts',async()=>{
    process.env.ADMIN_SMS_ENABLED='false';await inbound(carrier('2026-11-13T10:00:40Z'),'START');assert.equal(process.env.ADMIN_SMS_ENABLED,'false');assert.equal((await sms.enqueueAdminSms(notice('carrier-not-app-optin'))).state,'disabled');
    configure();createError={status:400,code:21610};const first=await sms.enqueueAdminSms(notice('carrier-21610'));await sms.dispatchAdminSms();createError=null;assert.equal((await intent(first.identity)).state,'failed');assert.equal((await pref()).carrier_blocked,true);
    const before=requests.length;const second=await sms.enqueueAdminSms(notice('after-21610'));await sms.dispatchAdminSms();assert.equal(requests.length,before);assert.equal((await intent(second.identity)).state,'skipped');
  });
  await test('admin status requires trusted admin authorization and masks the configured number',async()=>{
    authorized=false;assert.equal((await statusRoute.GET(new NextRequest('https://app.example.invalid/api/admin/admin-sms'))).status,401);
    authorized=true;const response=await statusRoute.GET(new NextRequest('https://app.example.invalid/api/admin/admin-sms'));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    const body=await response.text();assert.doesNotMatch(body,new RegExp(phone.replace('+','\\+')));assert.match(body,/0123/);assert.match(body,/unknown/);
  });
  await test('existing cron drains queued SMS even when another notification workflow fails',async()=>{
    let drained=0;process.env.CRON_SECRET='synthetic-cron-secret';
    replace('lib/services/notifications/workflows.service.ts',{discoverNotificationEvents:async()=>{throw Error('Synthetic email workflow failure');}});
    replace('lib/services/notifications/admin-sms.service.ts',{dispatchAdminSms:async()=>{drained++;return{processed:1};}});
    const cron=require('../app/api/cron/notification-workflows/route.ts');assert.equal((await cron.GET(new Request('https://app.example.invalid/api/cron/notification-workflows'))).status,401);assert.equal(drained,0);
    const response=await cron.GET(new Request('https://app.example.invalid/api/cron/notification-workflows',{headers:{authorization:'Bearer synthetic-cron-secret'}}));
    assert.equal(response.status,500);assert.equal(drained,1);assert.equal((await response.json()).adminSms.processed,1);
  });
  await test('scheduled worker runs for SMS alone while both disabled gates prevent requests',async()=>{
    const ts=require('typescript'),vm=require('node:vm'),module={exports:{}},calls=[];
    const env={ADMIN_SMS_ENABLED:'false',NOTIFICATION_WORKFLOWS_ENABLED:'false',NEXT_PUBLIC_APP_URL:'https://app.example.invalid',CRON_SECRET:'synthetic-worker'};
    const source=ts.transpileModule(fs.readFileSync(path.join(root,'netlify/functions/notification-workflows.mts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(source,{exports:module.exports,process:{env},Response,fetch:async(url,options)=>{calls.push({url,options});return new Response('Synthetic',{status:200});}});
    assert.equal(await (await module.exports.default()).text(),'Disabled');assert.equal(calls.length,0);
    env.ADMIN_SMS_ENABLED='true';assert.equal((await module.exports.default()).status,200);assert.equal(calls.length,1);assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic-worker');assert.equal(module.exports.config.schedule,'*/5 * * * *');
  });
  console.log(`${passed} admin SMS checks passed; actual SQL/services/routes, synthetic PostgreSQL, blocked network, controlled providers. No hosted migration or SMS sent.`);
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>pg.close());
