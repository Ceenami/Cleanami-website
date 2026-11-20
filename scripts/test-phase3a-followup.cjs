// Real SQL/services against synthetic in-memory PostgreSQL; all hosted I/O blocked.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
exports.verify = async function(ctx) {
  const { db, pg, schema, seed, row, test, replace, root, uuid, contracts, service, jpeg, media, reserveInput } = ctx;
  const { eq, and, sql } = require('drizzle-orm');
  const now = new Date(), today = require('../lib/time/eastern.ts').toEasternDateString(now);
  const events = async () => (await pg.query('select * from phase3a_notification_events order by identity')).rows;
  const clearEvents = async () => pg.query('delete from phase3a_notification_events');
  await test('follow-up SQL creates private tables, reapplies without backfill or activation', async () => {
    await pg.exec('DROP TABLE phase3a_notification_events,phase3a_message_status,evidence_upload_phases,job_arrival_conditions');
    for (const name of ['0061_phase3a_notification_workflows.sql','0062_phase3a_before_evidence_infrastructure.sql']) {
      const migration = fs.readFileSync(path.join(root,'db/supabase/migrations',name),'utf8'); await pg.exec(migration); await pg.exec(migration);
    }
    assert.equal((await events()).length,0);
    for (const table of ['phase3a_notification_events','phase3a_message_status','evidence_upload_phases','job_arrival_conditions']) {
      assert.equal((await pg.query(`select relrowsecurity from pg_class where oid='${table}'::regclass`)).rows[0].relrowsecurity,true);
      for (const role of ['anon','authenticated']) assert.equal((await pg.query(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE') v`)).rows[0].v,false);
    }
  });
  async function fixture(extra = {}) {
    const f = await seed();
    await db.update(schema.cleaners).set({ accountStatus:'active',eligibleForAssignments:true }).where(eq(schema.cleaners.id,f.cleaner.id));
    const start = extra.checkInTime ?? new Date(+now+4*3600000), day = require('../lib/time/eastern.ts').toEasternDateString(start);
    await db.insert(schema.availabilityDays).values({ cleanerId:f.cleaner.id,date:day,isAvailable:true,onCallEligible:true,openPoolEligible:true,actorId:'synthetic' });
    const snapshot = require('../lib/cleaner/checklist-snapshot.ts').createChecklistSnapshot(f.property,[]);
    const [job] = await contracts.insertIssuedJobs(db,[{ propertyId:f.property.id,calendarEventUid:uuid(),status:'unassigned',jobSource:'manual',checkInTime:start,
      checkOutTime:new Date(+start+5*3600000),expectedHours:'3',addonsSnapshot:{laundryType:'none',teamSize:1},checklistSnapshot:snapshot,...extra }]);
    await db.insert(schema.jobsToCleaners).values({jobId:job.id,cleanerId:f.cleaner.id,role:'primary'});
    await db.update(schema.jobs).set({status:'assigned'}).where(eq(schema.jobs.id,job.id));
    return {...f,job};
  }
  const emails=[], channels=[]; let emailOutcome={success:true,status:'sent',providerMessageId:'synthetic-email'};
  delete require.cache[require.resolve('../lib/services/email.service.ts')];
  const actualEmail = require('../lib/services/email.service.ts');
  replace('lib/services/email.service.ts',{...actualEmail,sendTransactionalEmail:async (...args)=>{emails.push(args);return emailOutcome;}});
  replace('lib/services/notifications/notify.ts',{notifyCleaner:async x=>{channels.push(x);return {sms:{status:'sent'}};}});
  delete require.cache[require.resolve('../lib/services/notifications/workflows.service.ts')];
  const workflow = require('../lib/services/notifications/workflows.service.ts'), settings=require('../lib/services/notifications/workflow-settings.ts');
  Object.assign(process.env,{NOTIFICATION_WORKFLOWS_SCHEMA_READY:'true',NOTIFICATION_WORKFLOWS_ENABLED:'true',NOTIFICATION_WORKFLOWS_ENVIRONMENT:'test',
    NOTIFICATION_WORKFLOWS_SINCE:new Date(+now-60000).toISOString(),NOTIFICATION_MANAGEMENT_EMAIL:'manager@example.invalid',NOTIFICATION_TEST_RECIPIENTS:'manager@example.invalid'});
  await test('new notification rollout needs explicit cutoff/environment and preserves disabled behavior',async()=>{
    const since=process.env.NOTIFICATION_WORKFLOWS_SINCE;delete process.env.NOTIFICATION_WORKFLOWS_SINCE;
    assert.equal(settings.notificationWorkflowCutoff(),null);assert.equal((await workflow.dispatchNotificationEvents()).disabled,true);
    process.env.NOTIFICATION_WORKFLOWS_SINCE=since;
    assert.equal(settings.workflowRecipientAllowed('unapproved@example.invalid'),false);
  });
  let receiptJob;
  await test('committed paid public/portal bookings and iCal jobs create distinct durable intents; rollback creates none',async()=>{
    await clearEvents();
    const f=await fixture({jobSource:'customer_one_off',paymentIntentId:'pi_'+uuid(),paymentStatus:'captured'});receiptJob=f;
    assert.deepEqual((await events()).map(x=>x.kind).sort(),['one_off_booking','one_off_receipt']);
    await db.update(schema.jobs).set({paymentStatus:'captured'}).where(eq(schema.jobs.id,f.job.id));assert.equal((await events()).length,2);
    await assert.rejects(()=>db.transaction(async tx=>{await tx.insert(schema.jobs).values({propertyId:f.property.id,calendarEventUid:uuid(),jobSource:'ical'});throw Error('rollback');}));
    assert.equal((await events()).length,2);
    await contracts.insertIssuedJobs(db,[{propertyId:f.property.id,calendarEventUid:uuid(),jobSource:'ical',status:'unassigned',checkInTime:new Date(+now+86400000),checkOutTime:new Date(+now+2*86400000),expectedHours:'3',addonsSnapshot:{laundryType:'none',teamSize:1},checklistSnapshot:f.job.checklistSnapshot}]);
    assert.ok((await events()).some(x=>x.kind==='turnover_created'));
    await workflow.dispatchNotificationEvents();const count=emails.length;await workflow.dispatchNotificationEvents();assert.equal(emails.length,count);
    assert.ok(emails.some(x=>x[1]==='New one-time booking'));assert.ok(emails.some(x=>x[1]==='New iCal turnover'));
    assert.equal((await events()).find(x=>x.kind==='one_off_receipt').state,'skipped');
  });
  await test('known email failure and uncertain send stay visible and never automatically replay',async()=>{
    await clearEvents();await fixture({jobSource:'public_residential_booking',paymentIntentId:'pi_'+uuid(),paymentStatus:'captured'});
    emailOutcome={success:false,status:'failed'};await workflow.dispatchNotificationEvents();const count=emails.length;
    assert.ok((await events()).some(e=>e.kind==='one_off_booking'&&e.state==='failed'));
    emailOutcome={success:true,status:'sent'};await workflow.dispatchNotificationEvents();assert.equal(emails.length,count);
    await clearEvents();await fixture({jobSource:'public_residential_booking',paymentIntentId:'pi_'+uuid(),paymentStatus:'captured'});
    emailOutcome={success:false,status:'skipped'};await workflow.dispatchNotificationEvents();
    const skipped=(await events()).find(e=>e.kind==='one_off_booking');assert.equal(skipped.state,'failed');assert.equal(skipped.outcome.status,'skipped');
    await clearEvents();await fixture({jobSource:'public_residential_booking',paymentIntentId:'pi_'+uuid(),paymentStatus:'captured'});
    emailOutcome={success:false,status:'unknown'};await workflow.dispatchNotificationEvents();assert.ok((await events()).some(e=>e.state==='unknown'));
    emailOutcome={success:true,status:'sent'};
  });
  await test('portal Move-In/Out receipts retain frozen service, Deep inclusions, amount and private-access boundary',async()=>{
    for(const purpose of ['move_in','move_out']){
      await clearEvents();const f=await seed(),sale=require('../lib/pricing/residential-sales.ts').evaluateResidentialSale({bedrooms:1,bathrooms:1,sqft:750,cleaningLevel:'deep',purpose,petsAllowed:false,hotTub:'none',inUnitLaundryLoads:0});
      assert.ok(sale.ok);const staffed=require('../lib/pricing/residential.ts').buildResidentialJobStaffing(sale.terms,sale.terms.amountCents);
      await db.update(schema.properties).set({serviceType:'residential_one_time',entryInstructions:'SYNTHETIC_ACCESS_SECRET'}).where(eq(schema.properties.id,f.property.id));
      const customer=await row(schema.customers,schema.customers.id,f.property.customerId);process.env.NOTIFICATION_TEST_RECIPIENTS+=','+customer.email;
      const [job]=await contracts.insertIssuedJobs(db,[{propertyId:f.property.id,calendarEventUid:uuid(),jobSource:'customer_one_off',serviceType:'residential_one_time',status:'unassigned',
        checkInTime:new Date(+now+3*86400000),checkOutTime:new Date(+now+3*86400000+8*3600000),expectedHours:staffed.expectedHours,
        addonsSnapshot:{...staffed.addonsSnapshot,arrivalWindow:'fixed-9'},paymentIntentId:'pi_'+uuid(),paymentStatus:'captured'}]);
      await workflow.dispatchNotificationEvents();const sent=emails.findLast(x=>x[0]===customer.email);assert.ok(sent);
      assert.match(JSON.stringify(sent),purpose==='move_in'?/Move-In Clean/:/Move-Out Clean/);assert.match(JSON.stringify(sent),/oven and refrigerator/);
      assert.ok(JSON.stringify(sent).includes((sale.terms.amountCents/100).toFixed(2)));assert.ok(!JSON.stringify(sent).includes('SYNTHETIC_ACCESS_SECRET'));
      assert.equal((await events()).find(x=>x.job_id===job.id&&x.kind==='one_off_receipt').state,'sent');
      const count=emails.length;await workflow.dispatchNotificationEvents();assert.equal(emails.length,count);
    }
  });
  await test('receipt request version is pinned per checkout and survives flags/cutoff changes without rewriting old attempts',async()=>{
    const checkout=require('../lib/services/residential-checkout.service.ts');
    const sale=require('../lib/pricing/residential-sales.ts').evaluateResidentialSale({bedrooms:1,bathrooms:1,sqft:750,cleaningLevel:'deep',purpose:'move_out',petsAllowed:false,hotTub:'none',inUnitLaundryLoads:0});assert.ok(sale.ok);
    const input={slotKey:uuid(),requestIdentity:uuid(),terms:sale.terms,amountChargedCents:sale.terms.amountCents};
    const current=await checkout.prepareResidentialCheckout(input);assert.equal(current.terms.receiptFieldsVersion,1);
    delete process.env.NOTIFICATION_WORKFLOWS_ENABLED;
    const same=await checkout.prepareResidentialCheckout(input);assert.equal(same.id,current.id);assert.equal(same.terms.receiptFieldsVersion,1);
    const oldInput={...input,slotKey:uuid(),requestIdentity:uuid()},old=await checkout.prepareResidentialCheckout(oldInput);assert.equal(old.terms.receiptFieldsVersion,undefined);
    process.env.NOTIFICATION_WORKFLOWS_ENABLED='true';
    const oldAgain=await checkout.prepareResidentialCheckout(oldInput);assert.equal(oldAgain.id,old.id);assert.equal(oldAgain.terms.receiptFieldsVersion,undefined);
  });
  await test('removed-worker messages cover email and cleaner channels without restoring private job access',async()=>{
    await clearEvents();const f=await fixture();process.env.NOTIFICATION_TEST_RECIPIENTS+=','+f.cleaner.email+','+f.cleaner.phone;
    await db.transaction(async tx=>{await tx.delete(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id));await tx.update(schema.jobs).set({status:'unassigned'}).where(eq(schema.jobs.id,f.job.id));});
    assert.deepEqual((await events()).map(x=>x.kind).sort(),['worker_removed_cleaner','worker_removed_email']);
    await workflow.dispatchNotificationEvents();assert.ok(channels.some(x=>x.cleanerId===f.cleaner.id&&x.url==='/cleaner/jobs'&&x.sms));
    assert.ok(emails.some(x=>x[0]===f.cleaner.email&&x[2].ctaUrl.endsWith('/cleaner/jobs')));
  });
  await test('a later reassignment invalidates queued removed-worker messages',async()=>{
    await clearEvents();const f=await fixture();await db.transaction(async tx=>{await tx.delete(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id));await tx.update(schema.jobs).set({status:'unassigned'}).where(eq(schema.jobs.id,f.job.id));});
    await db.insert(schema.jobsToCleaners).values({jobId:f.job.id,cleanerId:f.cleaner.id,role:'primary'});
    await workflow.dispatchNotificationEvents();assert.ok((await events()).every(x=>x.state==='skipped'));
  });
  await test('seven-day term reminder uses selected date and dedupes without renewing/expiring subscriptions',async()=>{
    await clearEvents();const f=await fixture(), customer=await row(schema.customers,schema.customers.id,f.property.customerId);
    process.env.NOTIFICATION_TEST_RECIPIENTS+=','+customer.email;
    const end=new Date(Date.parse(today+'T12:00Z')+7*86400000).toISOString().slice(0,10);
    const [sub]=await db.insert(schema.subscriptions).values({customerId:customer.id,propertyId:f.property.id,status:'active',durationMonths:3,startDate:today,endDate:end,firstCleanPaymentId:'pi_'+uuid(),isFirstCleanPrepaid:true}).returning();
    assert.ok((await events()).some(e=>e.kind==='subscription_purchase'));
    await workflow.discoverNotificationEvents(now);await workflow.discoverNotificationEvents(now);
    assert.equal((await events()).filter(e=>e.kind==='term_end').length,1);
    await workflow.dispatchNotificationEvents(now);assert.equal((await row(schema.subscriptions,schema.subscriptions.id,sub.id)).status,'active');
    assert.ok(emails.some(x=>x[0]===customer.email&&x[1].includes('seven days')));
  });
  await test('cancellation before dispatch suppresses the term reminder',async()=>{
    await clearEvents();const f=await fixture(), customerId=f.property.customerId;
    const end=new Date(Date.parse(today+'T12:00Z')+7*86400000).toISOString().slice(0,10);
    const [sub]=await db.insert(schema.subscriptions).values({customerId,propertyId:f.property.id,status:'active',durationMonths:3,startDate:today,endDate:end}).returning();
    await workflow.discoverNotificationEvents(now);await db.update(schema.subscriptions).set({status:'canceled'}).where(eq(schema.subscriptions.id,sub.id));
    await workflow.dispatchNotificationEvents(now);assert.equal((await events()).find(e=>e.subscription_id===sub.id&&e.kind==='term_end').state,'skipped');
  });
  await test('delivery callbacks are monotonic, idempotent, and can arrive before send logging',async()=>{
    const status=require('../lib/services/notifications/message-status.ts'),sid='SM'+'1'.repeat(32);
    await status.recordMessageStatus(sid,'delivered',null);await status.recordMessageStatus(sid,'sent',null);await status.recordMessageStatus(sid,'failed','30003');await status.recordMessageStatus(sid,'delivered',null);
    assert.equal((await pg.query('select status from phase3a_message_status where message_sid=$1',[sid])).rows[0].status,'delivered');
    const sid2='SM'+'2'.repeat(32);await status.recordMessageStatus(sid2,'sent',null);await status.recordMessageStatus(sid2,'undelivered','30003');
    assert.equal((await pg.query('select status from phase3a_message_status where message_sid=$1',[sid2])).rows[0].status,'undelivered');
  });
  await test('Twilio status endpoint requires a valid signature, configured account and supported status',async()=>{
    const twilio=require('twilio'),url='https://callbacks.example.invalid/api/twilio/status',token='synthetic-webhook-token',account='AC'+'a'.repeat(32);
    Object.assign(process.env,{TWILIO_AUTH_TOKEN:token,TWILIO_ACCOUNT_SID:account,TWILIO_STATUS_WEBHOOK_URL:url});
    const route=require('../app/api/twilio/status/route.ts');
    const post=async(params,signature)=>route.POST(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature??twilio.getExpectedTwilioSignature(token,url,params)},body:new URLSearchParams(params).toString()}));
    const params={AccountSid:account,MessageSid:'SM'+'3'.repeat(32),MessageStatus:'delivered'};
    assert.equal((await post(params,'forged')).status,403);assert.equal((await post({...params,AccountSid:'AC'+'b'.repeat(32)})).status,403);
    assert.equal((await post({...params,MessageStatus:'invented'})).status,400);assert.equal((await post(params)).status,204);
    assert.equal((await pg.query('select status from phase3a_message_status where message_sid=$1',[params.MessageSid])).rows[0].status,'delivered');
    for(const key of ['TWILIO_AUTH_TOKEN','TWILIO_ACCOUNT_SID','TWILIO_STATUS_WEBHOOK_URL'])delete process.env[key];
  });
  await test('GPS follow-up uses existing arrival allowance, dedupes, and stops after a real check-in',async()=>{
    await clearEvents();process.env.NOTIFICATION_WORKFLOWS_SINCE=new Date(+now-86400000).toISOString();
    const f=await fixture({checkInTime:new Date(+now-30*60000)});await workflow.discoverNotificationEvents(now);await workflow.discoverNotificationEvents(now);
    assert.equal((await events()).filter(e=>e.job_id===f.job.id&&e.kind==='gps_overdue').length,1);
    await service.recordExecutionVisit(f.job.id,f.cleaner.id,'arrival',{latitude:0,longitude:0});await workflow.dispatchNotificationEvents(now);
    assert.equal((await events()).find(e=>e.job_id===f.job.id&&e.kind==='gps_overdue').state,'skipped');
    await service.recordExecutionVisit(f.job.id,f.cleaner.id,'departure',{latitude:0,longitude:0});
  });
  await test('global notification queue includes initial offer and underlying channel failures',async()=>{
    process.env.ASSIGNMENT_OFFERS_SCHEMA_READY='true';const filters=require('../lib/services/assignment/lifecycle-read.service.ts');
    const f=await fixture();await pg.query('insert into phase3a_offer_jobs(job_id) values($1)',[f.job.id]);
    // Membership trigger preceded enrollment; issue its normal current working offer now.
    await pg.query("insert into phase3a_assignment_offers(job_id,cleaner_id,role,schedule_version,dispatch_state) values($1,$2,'primary',1,'failed')",[f.job.id,f.cleaner.id]);
    const matches=await db.select({id:schema.jobs.id}).from(schema.jobs).where(and(eq(schema.jobs.id,f.job.id),filters.assignmentIssueFilter('notification_attention')));assert.equal(matches.length,1);
    assert.equal((await db.select({id:schema.jobs.id}).from(schema.jobs).where(and(eq(schema.jobs.id,f.job.id),filters.assignmentIssueFilter('missing_confirmation')))).length,1);
    await db.insert(schema.notificationLog).values({channel:'email',trigger:'synthetic',recipient:'manager@example.invalid',jobId:receiptJob.job.id,status:'failed'});
    assert.equal((await db.select({id:schema.jobs.id}).from(schema.jobs).where(and(eq(schema.jobs.id,receiptJob.job.id),filters.assignmentIssueFilter('notification_attention')))).length,1);
    const empty=await fixture();await db.transaction(async tx=>{await tx.delete(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,empty.job.id));await tx.update(schema.jobs).set({status:'unassigned'}).where(eq(schema.jobs.id,empty.job.id));});
    assert.equal((await db.select({id:schema.jobs.id}).from(schema.jobs).where(and(eq(schema.jobs.id,empty.job.id),filters.assignmentIssueFilter('coverage_incomplete')))).length,1);
    const predicate=(await pg.query("select prosrc from pg_proc where oid='phase3a_candidate_is_eligible(uuid,uuid,uuid,text)'::regprocedure")).rows[0].prosrc;
    assert.ok(!/for update|for share|pg_advisory|phase3a_assert_candidate/i.test(predicate));
    await db.select({id:schema.jobs.id}).from(schema.jobs).where(filters.assignmentIssueFilter('coverage_incomplete')).limit(2);
  });
  await test('jobless notification follow-up API refuses non-admins and exposes private operational states only to admin',async()=>{
    let admin=false;replace('lib/admin-auth.ts',{getAdminAuth:async()=>({isAdmin:admin,actorId:'synthetic-admin'})});
    const route=require('../app/api/admin/notification-workflows/route.ts');
    assert.equal((await route.GET(new Request('https://synthetic.invalid'))).status,401);admin=true;
    const response=await route.GET(new Request('https://synthetic.invalid'));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    const data=await response.json();assert.ok(Array.isArray(data.items));assert.ok(!JSON.stringify(data).includes('SYNTHETIC_ACCESS_SECRET'));
  });
  await test('cancellation at 30 minutes is allowed; past starts and exact 24-hour tier stay correct',async()=>{
    const rules=require('../lib/cancellation/rules.ts'), assignments=[{role:'primary'}];
    assert.equal(rules.canCancelJob(null,{status:'assigned',checkInTime:new Date(Date.now()+30*60000)},assignments).allowed,true);
    assert.equal(rules.canCancelJob(null,{status:'assigned',checkInTime:new Date(Date.now()-1)},assignments).allowed,false);
    assert.equal(rules.isLateCancellation(new Date(Date.now()+24*3600000+1000),assignments),false);
  });
  await test('subscription dates are timezone-stable and do not invent renewal or term prepayment',async()=>{
    const display=require('../lib/subscriptions/display.ts');
    for(const zone of ['UTC','America/New_York','Asia/Kolkata']){process.env.TZ=zone;assert.equal(display.formatSubscriptionDate('2027-01-31'),'Jan 31, 2027');}
    delete process.env.TZ;assert.equal(display.formatSubscriptionDate('2027-02-31'),'Not recorded');assert.equal(display.subscriptionStatusLabel('expired'),'Ended');
    const source=fs.readFileSync(path.join(root,'components/dashbboard/admin/subscriptions/SubscriptionsDetailModal.tsx'),'utf8');assert.ok(!source.includes('autoRenew'));assert.ok(!source.includes('Renews on'));assert.ok(!source.includes('Prepaid Term'));
  });
  let beforeFixture, beforeInput, beforeReservation;
  await test('Before reservations are opt-in, immutable, and cannot be confused with After on retry',async()=>{
    delete process.env.ASSIGNMENT_OFFERS_ENROLLMENT;beforeFixture=await fixture({checkInTime:new Date(Date.now()-60000)});
    const f=beforeFixture;await service.recordExecutionVisit(f.job.id,f.cleaner.id,'arrival',{latitude:0,longitude:0});
    const issued=await contracts.getExecutionContract(f.job.id);beforeInput={...reserveInput(issued.rooms[0].roomKey),phase:'before'};
    await assert.rejects(()=>service.reserveExecutionUpload(f.job.id,f.cleaner.id,beforeInput));
    Object.assign(process.env,{BEFORE_EVIDENCE_SCHEMA_READY:'true',BEFORE_EVIDENCE_ENROLLMENT:'true'});
    beforeReservation=await service.reserveExecutionUpload(f.job.id,f.cleaner.id,beforeInput);assert.match(beforeReservation.path,/issued-before/);
    await service.reserveExecutionUpload(f.job.id,f.cleaner.id,beforeInput);
    await assert.rejects(()=>service.reserveExecutionUpload(f.job.id,f.cleaner.id,{...beforeInput,phase:'after'}));
    await assert.rejects(()=>pg.query("update evidence_upload_phases set phase='after' where upload_id=$1",[beforeInput.uploadId]));
    media.set(beforeReservation.path,jpeg);await service.acknowledgeExecutionUpload(f.job.id,f.cleaner.id,beforeInput.uploadId);
  });
  await test('arrival notes enforce working identity and revision; customers cannot read drafts or private notes',async()=>{
    const f=beforeFixture;
    await service.saveArrivalConditions(f.job.id,f.cleaner.id,{revision:0,notes:'Synthetic arrival-condition note'});
    await assert.rejects(()=>service.saveArrivalConditions(f.job.id,uuid(),{revision:1,notes:'forged'}));
    await assert.rejects(()=>service.saveArrivalConditions(f.job.id,f.cleaner.id,{revision:0,notes:'stale'}));
    replace('lib/storage/signed-url.ts',{EVIDENCE_BUCKET:'synthetic',createSignedUrls:async (_bucket,paths)=>paths.map(()=> 'https://private.example.invalid/photo'),createSignedUrl:async()=> 'https://private.example.invalid/photo'});
    const phases=require('../lib/services/phase-evidence.service.ts');
    const admin=await phases.loadPhaseEvidence(f.job.id);assert.equal(admin.photos[0].phase,'before');assert.equal(admin.notes,'Synthetic arrival-condition note');
    const customer=await phases.loadPhaseEvidence(f.job.id,f.property.customerId);assert.equal(customer.photos.length,0);assert.equal(customer.notes,null);
    await assert.rejects(()=>phases.loadPhaseEvidence(f.job.id,uuid()));
    assert.ok(!JSON.stringify(admin).includes(beforeReservation.path));
  });
  await test('Before uploads never satisfy completion minimums, including readiness flag rollback',async()=>{
    const f=beforeFixture, issued=await contracts.getExecutionContract(f.job.id);
    await service.recordExecutionVisit(f.job.id,f.cleaner.id,'departure',{latitude:0,longitude:0});
    await service.reserveExecutionUpload(f.job.id,f.cleaner.id,beforeInput); // same reservation remains retryable after departure
    await assert.rejects(()=>service.reserveExecutionUpload(f.job.id,f.cleaner.id,{...beforeInput,uploadId:uuid()}));
    await assert.rejects(()=>service.saveArrivalConditions(f.job.id,f.cleaner.id,{revision:1,notes:'late'}));
    const body={revision:0,items:issued.checklist.map(i=>({id:i.id,completed:true})),notes:''};
    delete process.env.BEFORE_EVIDENCE_SCHEMA_READY;await assert.rejects(()=>service.saveExecutionDraft(f.job.id,f.cleaner.id,body,true));
    process.env.BEFORE_EVIDENCE_SCHEMA_READY='true';
    for(const room of issued.rooms)for(let i=0;i<room.minPhotos;i++){
      const input={...reserveInput(room.roomKey),source:'gallery',capturedAt:null,phase:'after'},r=await service.reserveExecutionUpload(f.job.id,f.cleaner.id,input);
      media.set(r.path,jpeg);await service.acknowledgeExecutionUpload(f.job.id,f.cleaner.id,input.uploadId);
    }
    await service.saveExecutionDraft(f.job.id,f.cleaner.id,body,true);
    const packet=await row(schema.evidencePackets,schema.evidencePackets.jobId,f.job.id);assert.ok(!packet.photoUrls.includes(beforeReservation.path));
    const phases=require('../lib/services/phase-evidence.service.ts'),customer=await phases.loadPhaseEvidence(f.job.id,f.property.customerId);
    assert.ok(customer.photos.some(p=>p.phase==='before'));assert.ok(customer.photos.some(p=>p.phase==='after'));assert.equal(customer.notes,null);
  });
  await test('comparison API rejects anonymous/other-owner reads and keeps private arrival notes out of owner responses',async()=>{
    let scope={error:'Unauthorized'};
    replace('lib/customer-auth.ts',{resolvePortalCustomerScope:async()=>scope,customerAuthErrorStatus:()=>401});
    const {NextRequest}=require('next/server'),route=require('../app/api/jobs/[id]/evidence-phases/route.ts');
    const params={params:Promise.resolve({id:beforeFixture.job.id})},request=new NextRequest('https://synthetic.invalid/?ownerScope=1');
    assert.equal((await route.GET(request,params)).status,401);scope={error:null,customerId:uuid()};assert.equal((await route.GET(request,params)).status,404);
    scope={error:null,customerId:beforeFixture.property.customerId};const response=await route.GET(request,params);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
    const body=await response.json();assert.equal(body.notes,null);assert.ok(body.photos.some(x=>x.phase==='before'));assert.ok(!JSON.stringify(body).includes(beforeReservation.path));
  });
  await test('actual comparison and capture components render phase labels, timestamps and After-only completion counts',async()=>{
    const Module=require('node:module'),load=Module._load,React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),previousReact=global.React;
    global.React=React;
    let data={available:true,notes:null,photos:[{id:'one',room:'Kitchen',phase:'before',url:'https://private.example.invalid/photo',capturedAt:null,uploadedAt:now.toISOString()}]},capture=false,stateIndex=0;
    Module._load=function(name,...args){
      if(name==='@tanstack/react-query')return {useQuery:()=>({data,isError:false,refetch:()=>{}})};
      if(name==='react'&&capture)return {...React,useState:initial=>{const i=stateIndex++;return [i===0?{protocol:'pre2c-hotfix-v1',queueOwner:'synthetic',jobId:beforeFixture.job.id,revision:0,arrivalRecorded:true,departureRecorded:false,isSubmitted:false,finalEvidenceSubmittedAt:null,beforeEvidenceAvailable:true,arrivalConditions:{notes:'',revision:0},roomRequirements:[{roomKey:'kitchen',label:'Kitchen',minPhotos:1}],checklistItems:[],checklistFiles:[],cleanerNotes:'',photos:[{uploadId:'one',roomKey:'kitchen',path:'hidden',state:'verified',phase:'before',url:'https://private.example.invalid/photo',mine:true}]}:i===2?'before':initial,()=>{}];}};
      return load.call(this,name,...args);
    };
    try{
      const Comparison=require('../components/checklists/BeforeAfterEvidence.tsx').BeforeAfterEvidence;
      const html=renderToStaticMarkup(React.createElement(Comparison,{jobId:beforeFixture.job.id}));assert.match(html,/Before and After photos/);assert.match(html,/Capture time not recorded/);assert.ok(!html.includes('hidden'));
      capture=true;stateIndex=0;
      delete require.cache[require.resolve('../components/cleaner/ExecutionEvidenceClient.tsx')];
      const Capture=require('../components/cleaner/ExecutionEvidenceClient.tsx').ExecutionEvidenceClient;
      const form=renderToStaticMarkup(React.createElement(Capture,{jobId:beforeFixture.job.id}));assert.match(form,/Before cleaning/);assert.match(form,/0 of 1 required After photos/);
    } finally{Module._load=load;if(previousReact===undefined)delete global.React;else global.React=previousReact;}
  });
  await clearEvents();
  for(const key of Object.keys(process.env))if(/NOTIFICATION_WORKFLOWS|NOTIFICATION_TEST_|BEFORE_EVIDENCE|NOTIFICATION_MANAGEMENT/.test(key))delete process.env[key];
};
if(require.main===module){const run=require('node:child_process').spawnSync(process.execPath,['--require',path.join(__dirname,'test-assignment-offers.cjs'),path.join(__dirname,'test-job-execution.cjs'),'--with-schedule-upgrade','--phase2c','--assignment-offers','--phase3a-followup'],{stdio:'inherit',env:process.env,windowsHide:true});process.exitCode=run.status??1;}
