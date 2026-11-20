// Synthetic PGlite, actual triggers/services/routes, no root environment or network.
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
exports.verify = async function(ctx) {
  const {db,pg,schema,test,root,uuid,replace,fixture,current,reply,svc,channels,emails,alerts,setFailures}=ctx;
  const {eq,and}=require('drizzle-orm');
  const H=3600000, time=value=>+new Date(value), actions=async id=>(await pg.query('select a.* from phase3a_lifecycle_actions a join phase3a_assignment_offers o on o.id=a.offer_id where o.job_id=$1 order by a.occurred_at,a.id',[id])).rows;
  await test('M5 migration reapplies privately without changing existing money, jobs, assignments or offer responses',async()=>{
    const snapshot=async()=>JSON.stringify((await pg.query("select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j)) from jobs j),'members',(select jsonb_agg(to_jsonb(x)) from jobs_to_cleaners x),'pay',(select jsonb_agg(to_jsonb(p)) from payouts p),'offers',(select jsonb_agg(jsonb_build_array(id,state,responded_at)) from phase3a_assignment_offers)) v")).rows);
    const before=await snapshot(),sql=fs.readFileSync(path.join(root,'db/supabase/migrations/0059_phase3a_offer_lifecycle.sql'),'utf8'); await pg.exec(sql);await pg.exec(sql);assert.equal(await snapshot(),before);
    assert.equal((await pg.query('select count(*)::int n from phase3a_offer_jobs where lifecycle_enabled')).rows[0].n,0);
    for(const table of ['phase3a_reconfirmations','phase3a_lifecycle_actions']) {
      assert.equal((await pg.query(`select relrowsecurity from pg_class where oid='${table}'::regclass`)).rows[0].relrowsecurity,true);
      for(const role of ['anon','authenticated'])assert.equal((await pg.query(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE') allowed`)).rows[0].allowed,false);
    }
  });
  Object.assign(process.env,{ASSIGNMENT_OFFERS_SCHEMA_READY:'true',ASSIGNMENT_OFFERS_ENROLLMENT:'true',ASSIGNMENT_LIFECYCLE_SCHEMA_READY:'true',ASSIGNMENT_LIFECYCLE_ENROLLMENT:'true'});
  const life=require(path.join(root,'lib/services/assignment/lifecycle.service.ts'));
  const policy=require(path.join(root,'lib/services/assignment/lifecycle-policy.ts'));
  const made=[];
  const make=async(lead=100,options={})=>{const f=await fixture({...options,startAt:new Date(Date.now()+lead*H)});made.push(f.job.id);return f;};
  const worker=async f=>(await current(f.job.id)).find(o=>o.role!=='backup');
  const acceptAll=async f=>{for(const o of await current(f.job.id))if(o.state==='pending')await reply(o);};
  const reconfs=async f=>(await pg.query('select r.* from phase3a_reconfirmations r join phase3a_assignment_offers o on o.id=r.offer_id where o.job_id=$1',[f.job.id])).rows;
  const respond=async(f,r,response='confirmed',patch={})=>{const o=(await current(f.job.id)).find(o=>o.id===r.offer_id);return life.respondToReconfirmation({jobId:f.job.id,cleanerId:o.cleaner_id,reconfirmationId:r.id,offerId:o.id,version:o.version,scheduleVersion:o.schedule_version,role:o.role,response,...patch});};
  const tick=async now=>{const result=await life.processAssignmentLifecycle(new Date(now));assert.deepEqual(result.errors,[]);return result;};
  async function check(name,fn){const start=made.length;await test('M5 '+name,async()=>{try{await fn();}finally{setFailures(false,false);for(const id of made.slice(start))await db.update(schema.jobs).set({status:'canceled'}).where(eq(schema.jobs.id,id));}});}
  async function syntheticOfferAt(f,at){const old=await worker(f);await pg.query("update phase3a_assignment_offers set state='revoked',revoked_at=now(),reason='synthetic_fixture' where id=$1",[old.id]);return (await pg.query("insert into phase3a_assignment_offers(job_id,cleaner_id,role,schedule_version,offered_at) values($1,$2,$3,$4,$5) returning *",[f.job.id,old.cleaner_id,old.role,old.schedule_version,new Date(at).toISOString()])).rows[0];}

  await check('SQL and pure deadline tiers agree at exact 24h/72h and adjacent milliseconds',async()=>{
    const f=await make();
    for(const lead of [72*H+1,72*H,72*H-1,24*H+1,24*H,24*H-1,30*60000]) {
      const at=+f.job.checkInTime-lead,o=await syntheticOfferAt(f,at),expected=policy.initialResponseWindowMs(lead);
      assert.equal(time(o.response_due_at)-at,expected);assert.equal(time(o.response_reminder_at)-at,expected/2);assert.equal(o.deadline_gate,null);
    }
  });
  await check('elapsed deadlines survive DST/host timezone changes',async()=>{
    const old=process.env.TZ;
    for(const zone of ['UTC','Asia/Kolkata','America/New_York']){process.env.TZ=zone;const at=Date.parse('2034-11-04T15:00Z');assert.equal(policy.initialResponseWindowMs(Date.parse('2034-11-07T15:00Z')-at),2*H);}
    if(old===undefined)delete process.env.TZ;else process.env.TZ=old;
  });
  await check('halfway reminders are exact, durable and independent across cleaner and email channels',async()=>{
    const f=await make(),o=await worker(f),half=time(o.response_reminder_at);await tick(half-1);assert.equal((await actions(f.job.id)).filter(a=>a.kind==='initial_reminder').length,0);
    await tick(half);await tick(half);assert.equal((await actions(f.job.id)).filter(a=>a.kind==='initial_reminder').length,1);
    const a=(await actions(f.job.id)).find(a=>a.kind==='initial_reminder'),before=emails.length;
    setFailures(true,false);await life.dispatchLifecycleActions(new Date(half));setFailures(false,false);
    assert.equal(emails.length-before,1);assert.equal((await actions(f.job.id)).find(x=>x.id===a.id).dispatch_state,'failed');const n=channels.length;
    await life.dispatchLifecycleActions(new Date(half));assert.equal(channels.length,n);
  });
  await check('late replies fail at the SQL deadline before a timer runs',async()=>{
    const f=await make(),o=await syntheticOfferAt(f,Date.now()-13*H);await assert.rejects(()=>reply(o));
    assert.equal((await worker(f)).state,'pending');await tick(Date.now());assert.equal((await pg.query('select reason from phase3a_assignment_offers where id=$1',[o.id])).rows[0].reason,'response_deadline_expired');
  });
  await check('expiry records one miss/alert and retains membership when no eligible backup exists',async()=>{
    const f=await make(100,{backups:0}),o=await worker(f),before=JSON.stringify(await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id)));
    await tick(time(o.response_due_at));await tick(time(o.response_due_at)+1000);
    const events=(await actions(f.job.id)).filter(a=>a.kind==='offer_expired');assert.equal(events.length,1);assert.equal(events[0].details.coverage,'no_confirmed_eligible_backup');
    assert.equal(JSON.stringify(await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id))),before);await assert.rejects(()=>reply(o));
    const n=alerts.length;await life.dispatchLifecycleActions(new Date(time(o.response_due_at)));await life.dispatchLifecycleActions(new Date(time(o.response_due_at)));assert.equal(alerts.length-n,1);
  });
  await check('eligible paired backup gets a fresh pending working offer, with replacement standby sought',async()=>{
    const f=await make(100,{backups:2}),o=await worker(f),backup=(await current(f.job.id)).find(o=>o.role==='backup');await reply(backup);
    await tick(time(o.response_due_at));const promotion=(await current(f.job.id)).find(x=>x.replaces_cleaner_id===o.cleaner_id);assert.ok(promotion);assert.equal(promotion.state,'pending');assert.equal(promotion.deadline_gate,'promotion_deadline_policy');assert.equal(promotion.response_due_at,null);
    assert.ok((await current(f.job.id)).some(x=>x.role==='backup'&&x.cleaner_id!==backup.cleaner_id));
    assert.ok(await db.query.jobsToCleaners.findFirst({where:and(eq(schema.jobsToCleaners.jobId,f.job.id),eq(schema.jobsToCleaners.cleanerId,o.cleaner_id))}));
    await reply(promotion);assert.equal((await svc.readOfferCoverage(f.job.id)).complete,false);
  });
  await check('failed final backup qualification rolls back its savepoint and preserves expiry/escalation',async()=>{
    const f=await make(),o=await worker(f),b=(await current(f.job.id)).find(o=>o.role==='backup');await reply(b);await db.update(schema.cleaners).set({eligibleForAssignments:false}).where(eq(schema.cleaners.id,b.cleaner_id));
    await tick(time(o.response_due_at));assert.equal((await actions(f.job.id)).find(a=>a.kind==='offer_expired').details.promotionOfferId,null);assert.equal((await current(f.job.id)).filter(x=>x.replaces_cleaner_id).length,0);
  });
  await check('an accepted initial offer never enters the expiry path',async()=>{
    const f=await make(),o=await worker(f);await reply(o);await tick(time(o.response_due_at)+1);assert.equal((await worker(f)).state,'accepted');assert.equal((await actions(f.job.id)).filter(a=>a.kind==='offer_expired').length,0);
  });
  await check('a delayed worker records a passed deadline after start without guessing a last-minute promotion policy',async()=>{
    const f=await make(0.5),o=await syntheticOfferAt(f,+f.job.checkInTime-0.5*H),b=(await current(f.job.id)).find(o=>o.role==='backup');await reply(b);
    assert.ok(o.response_due_at);await tick(+f.job.checkInTime+60000);assert.equal((await actions(f.job.id)).find(a=>a.kind==='offer_expired').details.coverage,'past_start_admin_review');assert.equal((await current(f.job.id)).filter(o=>o.replaces_cleaner_id).length,0);
  });
  await check('rescheduling an expired reservation creates a fresh gated working offer without erasing the old miss',async()=>{
    const f=await make(100,{backups:1}),old=await worker(f);await tick(time(old.response_due_at));
    await db.update(schema.jobs).set({checkOutTime:new Date(+f.job.checkOutTime+60000)}).where(eq(schema.jobs.id,f.job.id));
    const fresh=await worker(f);assert.ok(fresh);assert.notEqual(fresh.id,old.id);assert.equal(fresh.schedule_version,2);assert.equal(fresh.deadline_gate,'rescheduled_deadline_policy');assert.equal(fresh.state,'pending');
    assert.equal((await pg.query('select reason from phase3a_assignment_offers where id=$1',[old.id])).rows[0].reason,'response_deadline_expired');await assert.rejects(()=>reply(old));
    await reply(fresh);await reply((await current(f.job.id)).find(o=>o.role==='backup'));assert.ok((await current(f.job.id)).every(o=>o.state==='accepted'));assert.equal((await current(f.job.id)).filter(o=>o.replaces_cleaner_id).length,0);
  });
  await check('backup, near-start and rescheduled expiry policies remain explicitly gated',async()=>{
    const f=await make(0.25),o=await worker(f),b=(await current(f.job.id)).find(o=>o.role==='backup');assert.equal(o.response_due_at,null);assert.equal(o.deadline_gate,'near_start_deadline_policy');assert.equal(b.deadline_gate,'backup_deadline_policy');
    await tick(+f.job.checkInTime+H);assert.equal((await worker(f)).state,'pending');
    const normal=await make();await db.update(schema.jobs).set({checkOutTime:new Date(+normal.job.checkOutTime+60000)}).where(eq(schema.jobs.id,normal.job.id));assert.equal((await worker(normal)).deadline_gate,'rescheduled_deadline_policy');
  });
  await check('short-notice admin awareness is deduped independently of cleaner reminders',async()=>{
    const f=await make(23),o=await worker(f);assert.equal(time(o.response_due_at)-time(o.offered_at),0.5*H);assert.equal((await actions(f.job.id)).filter(a=>a.kind==='immediate_admin').length,1);
    assert.equal((await actions(f.job.id)).find(a=>a.kind==='immediate_admin').dispatch_state,'sent');assert.ok(alerts.some(a=>a.jobId===f.job.id&&a.title==='Short-notice assignment under 24 hours'));const n=alerts.length;await life.dispatchLifecycleActions();await life.dispatchLifecycleActions();assert.equal(alerts.length,n);assert.equal((await actions(f.job.id)).filter(a=>a.kind==='immediate_admin').length,1);
  });
  await check('a queued reminder is suppressed after response or schedule revocation',async()=>{
    const f=await make(),o=await worker(f);await tick(time(o.response_reminder_at));await reply(o);const a=(await actions(f.job.id)).find(a=>a.kind==='initial_reminder');assert.equal(a.dispatch_state,'skipped');
    const n=channels.length;await life.dispatchLifecycleActions(new Date(time(o.response_reminder_at)));assert.equal(channels.length,n);
    const f2=await make(),old=await worker(f2);await tick(time(old.response_reminder_at));await db.update(schema.jobs).set({checkOutTime:new Date(+f2.job.checkOutTime+60000)}).where(eq(schema.jobs.id,f2.job.id));assert.equal((await actions(f2.job.id)).find(a=>a.kind==='initial_reminder').dispatch_state,'skipped');
  });
  await check('T-24 requests and exactly two-hour reminders cover accepted working and backup duty separately',async()=>{
    const f=await make();await acceptAll(f);const at=+f.job.checkInTime-24*H;await tick(at-1);assert.equal((await reconfs(f)).length,0);
    await tick(at);assert.equal((await reconfs(f)).length,2);await tick(at+2*H-1);assert.equal((await actions(f.job.id)).filter(a=>a.kind==='reconfirmation_reminder').length,0);
    await tick(at+2*H);await tick(at+2*H);assert.equal((await actions(f.job.id)).filter(a=>a.kind==='reconfirmation_reminder').length,2);
  });
  await check('T-12 silence escalates once without changing accepted roles, pay or job status',async()=>{
    const f=await make();await acceptAll(f);const before=JSON.stringify(await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id))),at=+f.job.checkInTime-24*H;await tick(at);await tick(at+12*H);await tick(at+12*H+1);
    assert.equal((await actions(f.job.id)).filter(a=>a.kind==='reconfirmation_escalation').length,2);assert.ok((await reconfs(f)).every(r=>r.state==='pending'));assert.ok((await current(f.job.id)).every(o=>o.state==='accepted'));
    assert.equal(JSON.stringify(await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id))),before);assert.equal((await db.query.jobs.findFirst({where:eq(schema.jobs.id,f.job.id)})).status,'assigned');
  });
  await check('explicit reconfirmation is idempotent and stops future reminders/escalations',async()=>{
    const f=await make();await acceptAll(f);const at=+f.job.checkInTime-24*H;await tick(at);for(const r of await reconfs(f)){await respond(f,r);await respond(f,r);await assert.rejects(()=>respond(f,r,'cannot_fulfill'));}
    await tick(at+12*H);assert.equal((await actions(f.job.id)).filter(a=>a.kind==='reconfirmation_escalation').length,0);assert.equal((await actions(f.job.id)).filter(a=>a.kind==='reconfirmation_response').length,2);
  });
  await check('Cannot Fulfill is explicit admin follow-up, with no automatic removal, penalty, charge or payout',async()=>{
    const f=await make(100,{residential:true});await acceptAll(f);await tick(+f.job.checkInTime-24*H);const r=(await reconfs(f)).find(r=>(r.offer_id));await respond(f,r,'cannot_fulfill');
    const coverage=await svc.readOfferCoverage(f.job.id);assert.equal(coverage.complete,false);assert.ok(coverage.issues.some(x=>x.includes('cannot fulfil')));assert.equal((await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id))).length,2);
    assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.job.id))).length,0);assert.equal((await db.select().from(schema.reliabilityEvents).where(eq(schema.reliabilityEvents.jobId,f.job.id))).length,0);
    await life.dispatchLifecycleActions(new Date(+f.job.checkInTime-24*H));assert.ok(alerts.some(a=>a.jobId===f.job.id&&a.title.includes('cannot fulfil')));
  });
  await check('reconfirmation cannot use another owner, role, version or schedule',async()=>{
    const f=await make();await acceptAll(f);await tick(+f.job.checkInTime-24*H);const r=(await reconfs(f))[0];
    for(const patch of [{cleanerId:uuid()},{version:99999},{role:'invalid'},{scheduleVersion:999},{reconfirmationId:uuid()}])await assert.rejects(()=>respond(f,r,'confirmed',patch));
    await db.update(schema.jobs).set({checkOutTime:new Date(+f.job.checkOutTime+60000)}).where(eq(schema.jobs.id,f.job.id));assert.equal((await reconfs(f)).find(x=>x.id===r.id).state,'revoked');
  });
  await check('inside-24h confirmation produces a review gate instead of inventing reconfirmation timing',async()=>{
    const f=await make(23);await acceptAll(f);await tick(Date.now());assert.equal((await reconfs(f)).length,0);assert.equal((await actions(f.job.id)).filter(a=>a.kind==='reconfirmation_policy_review').length,2);
  });
  await check('a late worker escalates reconfirmation without sending obsolete request and reminder together',async()=>{
    const f=await make();await acceptAll(f);const at=+f.job.checkInTime-12*H;await tick(at);const records=await actions(f.job.id);assert.equal(records.filter(a=>a.kind==='reconfirmation_request'&&a.dispatch_state==='skipped').length,2);assert.equal(records.filter(a=>a.kind==='reconfirmation_escalation').length,2);
  });
  await check('T-60 ETA remains version-bound to accepted working duty and never asks standby',async()=>{
    const f=await make();await acceptAll(f);const at=+f.job.checkInTime-H;await tick(at);await life.dispatchLifecycleActions(new Date(at));
    const eta=(await actions(f.job.id)).filter(a=>a.kind==='eta_prompt');assert.equal(eta.length,1);assert.equal(eta[0].dispatch_state,'sent');const count=channels.length;
    delete require.cache[require.resolve(path.join(root,'lib/services/notifications/reminders.service.ts'))];
    const legacy=require(path.join(root,'lib/services/notifications/reminders.service.ts'));await legacy.sendUpcomingJobReminders(new Date(at));assert.equal(channels.length,count);
    await tick(at+1000);await life.dispatchLifecycleActions(new Date(at+1000));assert.equal(channels.length,count);
  });
  await check('unknown claimed sends never replay and are exposed for admin review',async()=>{
    const f=await make(),o=await worker(f),at=time(o.response_reminder_at);await tick(at);const a=(await actions(f.job.id)).find(a=>a.kind==='initial_reminder');await pg.query("update phase3a_lifecycle_actions set dispatch_state='claimed',claimed_at=now() where id=$1",[a.id]);const n=channels.length;await life.dispatchLifecycleActions(new Date(at));assert.equal(channels.length,n);assert.ok((await svc.readOfferCoverage(f.job.id)).lifecycleWarnings.some(x=>x.includes('dispatch needs review')));
  });
  await check('started physical work suppresses overdue processing and stale notification dispatch',async()=>{
    const f=await make(),o=await worker(f);await db.insert(schema.evidencePackets).values({jobId:f.job.id,gpsCheckInTimestamp:new Date()});await tick(time(o.response_due_at));assert.equal((await actions(f.job.id)).filter(a=>a.kind==='offer_expired').length,0);
  });
  await check('deadline and lifecycle histories reject mutation',async()=>{
    const f=await make(),o=await worker(f);await assert.rejects(()=>pg.query("update phase3a_assignment_offers set response_due_at=now() where id=$1",[o.id]));
    await tick(time(o.response_reminder_at));const a=(await actions(f.job.id)).find(a=>a.kind==='initial_reminder');await assert.rejects(()=>pg.query("update phase3a_lifecycle_actions set details='{}',kind='offer_expired' where id=$1",[a.id]));await assert.rejects(()=>pg.query('delete from phase3a_lifecycle_actions where id=$1',[a.id]));
  });
  await check('reconfirmation API is authenticated, strict, private and read-only through the offers GET',async()=>{
    const f=await make();await acceptAll(f);await tick(+f.job.checkInTime-24*H);const r=(await reconfs(f))[0],o=(await current(f.job.id)).find(o=>o.id===r.offer_id);let cid=o.cleaner_id;
    replace('lib/cleaner-auth.ts',{getCleanerAuth:async()=>({cleanerId:cid}),cleanerAuthErrorStatus:()=>401,requireCleanerJobAssignment:async(c,j)=>({error:await db.query.jobsToCleaners.findFirst({where:and(eq(schema.jobsToCleaners.cleanerId,c),eq(schema.jobsToCleaners.jobId,j))})?null:'forbidden'})});
    delete require.cache[require.resolve(path.join(root,'app/api/cleaner/jobs/[id]/offers/route.ts'))];const read=require(path.join(root,'app/api/cleaner/jobs/[id]/offers/route.ts')),route=require(path.join(root,'app/api/cleaner/jobs/[id]/reconfirmation/route.ts')),params={params:Promise.resolve({id:f.job.id})};
    const body={reconfirmationId:r.id,offerId:o.id,version:o.version,scheduleVersion:o.schedule_version,role:o.role,response:'confirmed'},post=body=>route.POST(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}),params);
    const before=JSON.stringify(await reconfs(f)),response=await read.GET(new Request('https://synthetic.invalid/?action=confirm'),params);assert.equal(response.status,200);assert.equal((await response.json()).reconfirmations.length,1);assert.equal(JSON.stringify(await reconfs(f)),before);
    assert.equal((await post({...body,cleanerId:uuid()})).status,400);assert.equal((await post({...body,version:99999})).status,409);cid=undefined;assert.equal((await post(body)).status,401);cid=uuid();assert.equal((await post(body)).status,403);cid=o.cleaner_id;const ok=await post(body);assert.equal(ok.status,200);assert.match(ok.headers.get('cache-control'),/no-store/);
  });
  await check('V2 expiry preserves customer billing, worker terms and all issued money',async()=>{
    const f=await make(100,{residential:true,backups:0}),o=await worker(f),before=await db.query.jobs.findFirst({where:eq(schema.jobs.id,f.job.id)}),members=JSON.stringify(await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id)));
    await tick(time(o.response_due_at));const after=await db.query.jobs.findFirst({where:eq(schema.jobs.id,f.job.id)});assert.deepEqual(after.addonsSnapshot,before.addonsSnapshot);assert.equal(after.paymentIntentId,before.paymentIntentId);assert.equal(after.paymentStatus,before.paymentStatus);assert.equal(JSON.stringify(await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id))),members);assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.job.id))).length,0);
  });
  await check('admin issue filters apply in SQL before pagination and retain an unresolved expired reservation',async()=>{
    const expired=await make(100,{backups:0});await syntheticOfferAt(expired,Date.now()-13*H);await make();
    const {getJobsWithDetails}=require(path.join(root,'lib/queries/jobs.ts'));
    const first=await getJobsWithDetails({assignmentIssue:'response_overdue',limit:1,page:1});assert.equal(first.data.length,1);assert.equal(first.data[0].id,expired.job.id);
    await tick(Date.now());const after=await getJobsWithDetails({assignmentIssue:'response_overdue',limit:1,page:1});assert.equal(after.data[0].id,expired.job.id);assert.ok(after.data[0].operations.warnings.some(w=>w.includes('response expired')));
    const failed=await make(),o=await worker(failed);await pg.query("insert into phase3a_lifecycle_actions(offer_id,kind,dispatch_state) values($1,'initial_reminder','failed')",[o.id]);
    const attention=await getJobsWithDetails({assignmentIssue:'notification_attention',limit:1});assert.equal(attention.data[0].id,failed.job.id);
  });
  await check('admin overdue reconfirmation filter uses current accepted duty and T-12, not just membership',async()=>{
    const f=await make(11,{backups:0}),old=await worker(f),now=Date.now();await pg.query("update phase3a_assignment_offers set state='revoked',revoked_at=now(),reason='synthetic_fixture' where id=$1",[old.id]);
    const o=(await pg.query("insert into phase3a_assignment_offers(job_id,cleaner_id,role,schedule_version,state,offered_at,responded_at) values($1,$2,'primary',1,'accepted',$3,$4) returning *",[f.job.id,old.cleaner_id,new Date(now-40*H).toISOString(),new Date(now-39*H).toISOString()])).rows[0];
    const request=+f.job.checkInTime-24*H;await pg.query("insert into phase3a_reconfirmations(offer_id,schedule_version,planned_start,requested_at,reminder_at,escalate_at) values($1,1,$2,$3,$4,$5)",[o.id,f.job.checkInTime.toISOString(),new Date(request).toISOString(),new Date(request+2*H).toISOString(),new Date(+f.job.checkInTime-12*H).toISOString()]);
    const {getJobsWithDetails}=require(path.join(root,'lib/queries/jobs.ts'));const result=await getJobsWithDetails({assignmentIssue:'reconfirmation_overdue',limit:1});assert.equal(result.data[0].id,f.job.id);
    await respond(f,(await reconfs(f))[0]);assert.equal((await getJobsWithDetails({assignmentIssue:'reconfirmation_overdue',limit:1})).data.length,0);
  });
  await check('customer callers cannot request admin lifecycle queues or inject another owner scope',async()=>{
    const f=await make();let reads=0,last;
    replace('lib/customer-auth.ts',{resolvePortalCustomerScope:async()=>({customerId:f.property.customerId}),customerAuthErrorStatus:()=>401});
    replace('lib/queries/jobs.ts',{getJobsWithDetails:async input=>{reads++;last=input;return{data:[],nextPage:null};}});
    delete require.cache[require.resolve(path.join(root,'app/api/jobs/route.ts'))];const route=require(path.join(root,'app/api/jobs/route.ts')),{NextRequest}=require('next/server');
    assert.equal((await route.GET(new NextRequest('https://synthetic.invalid/api/jobs?assignmentIssue=response_overdue'))).status,403);assert.equal(reads,0);
    assert.equal((await route.GET(new NextRequest('https://synthetic.invalid/api/jobs?assignmentIssue=invalid'))).status,400);assert.equal(reads,0);
    assert.equal((await route.GET(new NextRequest('https://synthetic.invalid/api/jobs?customerId='+uuid()))).status,200);assert.equal(last.customerId,f.property.customerId);assert.equal(last.assignmentIssue,'all');
  });
  await check('lifecycle enrollment stays prospective and defaults off independently of M4',async()=>{
    delete process.env.ASSIGNMENT_LIFECYCLE_ENROLLMENT;const f=await make();assert.equal((await pg.query('select lifecycle_enabled from phase3a_offer_jobs where job_id=$1',[f.job.id])).rows[0].lifecycle_enabled,false);assert.equal((await worker(f)).response_due_at,null);
    delete process.env.ASSIGNMENT_LIFECYCLE_SCHEMA_READY;assert.deepEqual(await life.processAssignmentLifecycle(),{scanned:0,errors:[]});
  });
};
if(require.main===module){const result=require('node:child_process').spawnSync(process.execPath,['--require',path.join(__dirname,'test-assignment-offers.cjs'),path.join(__dirname,'test-job-execution.cjs'),'--with-schedule-upgrade','--phase2c','--assignment-offers','--assignment-lifecycle'],{stdio:'inherit',env:process.env,windowsHide:true});process.exitCode=result.status??1;}
