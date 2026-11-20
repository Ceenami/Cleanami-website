// Actual coordinator, SQL guards and APIs against synthetic in-memory PostgreSQL.
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
exports.verify=async function(ctx){
 const {db,pg,schema,seed,row,test,root,uuid,replace,fixture,current,reply,svc,engine,channels,emails,alerts,setFailures}=ctx;
 const {eq,and}=require('drizzle-orm');
 const migration=fs.readFileSync(path.join(root,'db/supabase/migrations/0060_phase3a_property_priority.sql'),'utf8');
 await test('M6 migration reapplies privately without changing jobs, money, assignments or offers',async()=>{
  const snapshot=async()=>JSON.stringify((await pg.query("select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j)) from jobs j),'members',(select jsonb_agg(to_jsonb(x)) from jobs_to_cleaners x),'offers',(select jsonb_agg(to_jsonb(o)) from phase3a_assignment_offers o),'payouts',(select jsonb_agg(to_jsonb(p)) from payouts p)) v")).rows);
  const before=await snapshot();await pg.exec(migration);await pg.exec(migration);assert.equal(await snapshot(),before);
  for(const table of ['phase3a_priority_plans','phase3a_priority_events','phase3a_priority_notices']){
   assert.equal((await pg.query(`select relrowsecurity from pg_class where oid='${table}'::regclass`)).rows[0].relrowsecurity,true);
   for(const role of ['anon','authenticated'])assert.equal((await pg.query(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE') v`)).rows[0].v,false);
  }
 });
 Object.assign(process.env,{ASSIGNMENT_OFFERS_SCHEMA_READY:'true',ASSIGNMENT_OFFERS_ENROLLMENT:'true',ASSIGNMENT_LIFECYCLE_SCHEMA_READY:'true',ASSIGNMENT_LIFECYCLE_ENROLLMENT:'true',ASSIGNMENT_PRIORITY_SCHEMA_READY:'true',ASSIGNMENT_PRIORITY_ENROLLMENT:'true'});
 const priority=require(path.join(root,'lib/services/assignment/priority.service.ts'));
 const plans=async id=>(await pg.query('select * from phase3a_priority_plans where target_job_id=$1 order by created_at',[id])).rows;
 const members=async id=>await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,id));
 const made=[];let caseNumber=0;
 async function make(options={}){
  const f=await fixture({startAt:new Date(Date.UTC(2035,4,2+caseNumber++,14)),residential:options.residential,size:options.donorSize??1,hot:!!options.hot,laundry:!!options.laundry});made.push(f.job.id);
  for(const o of await current(f.job.id))await reply(o);
  await db.update(schema.propertyCleaners).set({tier:'secondary_primary'}).where(and(eq(schema.propertyCleaners.propertyId,f.property.id),eq(schema.propertyCleaners.cleanerId,f.cleaner.id)));
  const p=(await seed()).property;
  await db.insert(schema.propertyCleaners).values({propertyId:p.id,cleanerId:f.cleaner.id,tier:'main_primary'});
  const [target]=await db.insert(schema.jobs).values({propertyId:p.id,calendarEventUid:uuid(),status:'unassigned',checkInTime:new Date(+f.job.checkInTime+5*3600000),checkOutTime:new Date(+f.job.checkInTime+10*3600000),expectedHours:f.job.expectedHours,addonsSnapshot:{...f.job.addonsSnapshot,teamSize:options.targetSize??1},serviceType:f.job.serviceType}).returning();made.push(target.id);
  return {...f,target,targetProperty:p};
 }
 async function plan(f){const p=await priority.planPropertyPriority(f.target.id,'synthetic-admin');assert.ok(p,'Expected a safe plan');return p;}
 async function promotion(p){return (await pg.query('select * from phase3a_assignment_offers where id=$1',[p.replacement_offer_id])).rows[0];}
 async function addCandidate(f,propertyId,tier='preferred_backup',extra={}){
  const c=(await seed()).cleaner;
  await db.update(schema.cleaners).set({accountStatus:'active',eligibleForAssignments:true,reliabilityScore:'95',...extra}).where(eq(schema.cleaners.id,c.id));
  await db.insert(schema.availability).values({cleanerId:c.id,date:f.day,availabilityType:'vacation_rental',startTime:'00:00',endTime:'23:59',onCallEligible:true,openPoolEligible:true});
  await db.insert(schema.availabilityDays).values({cleanerId:c.id,date:f.day,isAvailable:true,onCallEligible:true,openPoolEligible:true,actorId:'synthetic'});
  await db.insert(schema.cleanerAvailabilitySubmissions).values({cleanerId:c.id,periodStart:f.day,periodEnd:f.day});
  if(tier)await db.insert(schema.propertyCleaners).values({propertyId,cleanerId:c.id,tier});
  return c;
 }
 async function check(name,fn){await test('M6 '+name,async()=>{const at=made.length;try{await fn();}finally{setFailures(false,false);for(const id of made.slice(at))await db.update(schema.jobs).set({status:'canceled'}).where(eq(schema.jobs.id,id));}});}
 await check('automatic discovery secures a fresh replacement offer without displacing or double booking the donor',async()=>{
  const f=await make(),before=JSON.stringify(await members(f.job.id));
  assert.ok(+f.target.checkInTime>=+f.job.checkInTime+Number(f.job.expectedHours)*3600000); // same-day restriction, despite no physical overlap
  const result=await engine.assignJob(f.target);assert.equal(result.reason,'property_priority_replacement_pending');
  const p=(await plans(f.target.id))[0],o=await promotion(p);assert.equal(o.state,'pending');assert.equal(o.role,'primary');assert.equal(o.replaces_cleaner_id,f.cleaner.id);
  assert.equal(JSON.stringify(await members(f.job.id)),before);assert.equal((await members(f.target.id)).length,0);
  assert.equal((await svc.readOfferCoverage(f.target.id)).complete,false);assert.equal((await priority.planPropertyPriority(f.target.id)).id,p.id);
 });
 await check('replacement acceptance atomically moves the main cleaner and requires a new working confirmation',async()=>{
  const f=await make(),p=await plan(f),o=await promotion(p);await reply(o);await reply(o);
  assert.equal((await plans(f.target.id))[0].state,'completed');
  const donor=await members(f.job.id),target=await members(f.target.id);
  assert.ok(!donor.some(x=>x.cleanerId===f.cleaner.id));assert.ok(donor.some(x=>x.cleanerId===o.cleaner_id&&x.role==='primary'));
  assert.equal(target.length,1);assert.equal(target[0].cleanerId,f.cleaner.id);
  const fresh=(await current(f.target.id)).find(x=>x.cleaner_id===f.cleaner.id);assert.equal(fresh.state,'pending');assert.equal((await svc.readOfferCoverage(f.target.id)).complete,false);
  await assert.rejects(()=>db.update(schema.jobs).set({status:'in-progress'}).where(eq(schema.jobs.id,f.target.id)));
  await reply(fresh);assert.equal((await svc.readOfferCoverage(f.target.id)).complete,false); // missing paired backup stays visible
  const events=(await pg.query('select state from phase3a_priority_events where plan_id=$1 order by id',[p.id])).rows;assert.deepEqual(events.map(e=>e.state),['pending','completed']);
 });
 await check('replacement decline preserves donor coverage and records an admin-visible failed plan',async()=>{
  const f=await make(),p=await plan(f),o=await promotion(p);const declined=await reply(o,'declined');assert.ok(declined.responded_at);const again=await reply(o,'declined');assert.equal(+new Date(again.responded_at),+new Date(declined.responded_at));
  assert.equal((await pg.query("select count(*)::int n from phase3a_offer_events where offer_id=$1 and kind='declined'",[o.id])).rows[0].n,1);
  assert.equal((await plans(f.target.id))[0].reason,'replacement_declined');assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id&&x.role==='primary'));assert.equal((await members(f.target.id)).length,0);
  assert.ok(alerts.some(a=>a.jobId===f.target.id&&a.title.includes('stopped')));
 });
 for(const change of ['reschedule','availability','exclusion','designation','reliability','target_claimed'])await check(change+' before acceptance rolls back both teams and retains original pay',async()=>{
  const f=await make(),p=await plan(f),o=await promotion(p),old=await row(schema.jobsToCleaners,schema.jobsToCleaners.cleanerId,f.cleaner.id);
  if(change==='reschedule')await db.update(schema.jobs).set({checkOutTime:new Date(+f.target.checkOutTime+60000)}).where(eq(schema.jobs.id,f.target.id));
  if(change==='availability')await db.update(schema.availabilityDays).set({isAvailable:false}).where(and(eq(schema.availabilityDays.cleanerId,f.cleaner.id),eq(schema.availabilityDays.date,f.day)));
  if(change==='exclusion')await db.insert(schema.propertyExclusions).values({propertyId:f.targetProperty.id,cleanerId:f.cleaner.id,reason:'synthetic exclusion',actorId:'synthetic-admin'});
  if(change==='designation')await db.update(schema.propertyCleaners).set({tier:'secondary_primary'}).where(eq(schema.propertyCleaners.propertyId,f.targetProperty.id));
  if(change==='reliability')await db.update(schema.cleaners).set({reliabilityScore:'50'}).where(eq(schema.cleaners.id,o.cleaner_id));
  if(change==='target_claimed')await db.update(schema.jobs).set({status:'canceled'}).where(eq(schema.jobs.id,f.target.id));
  await assert.rejects(()=>reply(o));assert.equal((await plans(f.target.id))[0].state,'failed');
  assert.deepEqual(await row(schema.jobsToCleaners,schema.jobsToCleaners.cleanerId,f.cleaner.id),old);assert.equal((await members(f.target.id)).length,0);assert.equal((await promotion(p)).state,'revoked');
  if(change==='reschedule'){
   const standby=(await current(f.job.id)).find(x=>x.cleaner_id===o.cleaner_id&&x.role==='backup');assert.ok(standby);assert.equal(standby.state,'pending');
   await reply(standby);assert.equal((await svc.readOfferCoverage(f.job.id)).complete,true);await assert.rejects(()=>reply(o));
  }
 });
 await check('forged identity cannot cancel the plan and raw acceptance cannot bypass its coordinator',async()=>{
  const f=await make(),p=await plan(f),o=await promotion(p);
  for(const patch of [{cleanerId:uuid()},{jobId:uuid()},{version:o.version+1},{scheduleVersion:99},{role:'backup'}])await assert.rejects(()=>reply(o,'accepted',patch));
  assert.equal((await plans(f.target.id))[0].state,'pending');await assert.rejects(()=>pg.query("update phase3a_assignment_offers set state='accepted' where id=$1",[o.id]));
  await reply(o);assert.equal((await plans(f.target.id))[0].state,'completed');
 });
 await check('started/completed donor work and main-property ties never yield a plan',async()=>{
  for(const state of ['in-progress','completed','tie']){
   const f=await make();if(state==='tie')await db.insert(schema.propertyCleaners).values({propertyId:(await seed()).property.id,cleanerId:f.cleaner.id,tier:'main_primary'});
   else await db.update(schema.jobs).set({status:state}).where(eq(schema.jobs.id,f.job.id));
   assert.equal(await priority.planPropertyPriority(f.target.id),null);assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id));
  }
 });
 await check('waiting-plan worker invalidates changed schedules and cancellation while retaining the donor',async()=>{
  const f=await make(),p=await plan(f);await db.update(schema.jobs).set({checkOutTime:new Date(+f.target.checkOutTime+60000)}).where(eq(schema.jobs.id,f.target.id));
  await priority.processPriorityPlans();assert.equal((await plans(f.target.id))[0].state,'failed');await assert.rejects(async()=>reply(await promotion(p)));
  assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id));
 });
 await check('V2 money and immutable removed-worker terms survive a successful move without payouts',async()=>{
  const f=await make({residential:true}),before=await row(schema.jobs,schema.jobs.id,f.job.id),old=(await members(f.job.id)).find(x=>x.cleanerId===f.cleaner.id),p=await plan(f);await reply(await promotion(p));
  const after=await row(schema.jobs,schema.jobs.id,f.job.id);assert.deepEqual(after.addonsSnapshot,before.addonsSnapshot);assert.equal(after.paymentIntentId,before.paymentIntentId);assert.equal(after.paymentStatus,before.paymentStatus);
  const audit=(await pg.query("select assignment_terms from phase3a_offer_events where kind='membership_removed' and assignment_terms->>'cleaner_id'=$1",[f.cleaner.id])).rows;
  assert.ok(audit.some(x=>JSON.stringify(x.assignment_terms.residential_pay_terms)===JSON.stringify(old.residentialPayTerms)));
  assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.job.id))).length,0);assert.ok((await members(f.target.id))[0].residentialPayTerms);
 });
 await check('notice claims do not replay uncertain sends and independent email still runs',async()=>{
  const f=await make(),p=await plan(f);setFailures(true,false);const n=emails.length;await reply(await promotion(p));setFailures(false,false);assert.ok(emails.length>n);
  assert.ok((await pg.query("select id from phase3a_priority_notices where plan_id=$1 and dispatch_state='failed'",[p.id])).rows.length);
  const sent=channels.length;await priority.dispatchPriorityNotices();assert.equal(channels.length,sent);
  await assert.rejects(()=>pg.query("update phase3a_priority_notices set dispatch_state='pending' where plan_id=$1 and dispatch_state='failed'",[p.id]));
  await assert.rejects(()=>pg.query("update phase3a_priority_events set reason='rewrite' where plan_id=$1",[p.id]));
  await assert.rejects(()=>pg.query("update phase3a_priority_plans set target_team='[]' where id=$1",[p.id]));
 });
 await check('multi-person teams retain full headcounts, Laundry Lead and hot-tub capability across both jobs',async()=>{
  const f=await make({donorSize:2,targetSize:2,hot:true,laundry:true});
  await db.update(schema.cleaners).set({hasLaundryLeadCert:true}).where(eq(schema.cleaners.id,f.members[1].id));
  await addCandidate(f,f.targetProperty.id,'secondary_primary');
  const p=await plan(f),o=await promotion(p);assert.equal(o.role,'laundry_lead');await reply(o);
  for(const id of [f.job.id,f.target.id]){
   const team=(await members(id)).filter(x=>x.role!=='backup');assert.equal(team.length,2);assert.equal(team.filter(x=>x.role==='laundry_lead').length,1);assert.equal(team.filter(x=>x.isTeamLeader).length,1);
   const lead=await row(schema.cleaners,schema.cleaners.id,team.find(x=>x.role==='laundry_lead').cleanerId);assert.ok(lead.hasLaundryLeadCert);assert.ok(lead.hasHotTubCert);
  }
  assert.equal((await members(f.target.id)).filter(x=>x.role!=='backup'&&x.cleanerId===f.cleaner.id).length,1);
  assert.ok((await current(f.job.id)).filter(x=>x.role!=='backup').every(x=>x.state==='accepted'));
 });
 await check('replacement standby fallback nominates distinct duties; complete coverage requires new acknowledgments',async()=>{
  const f=await make();await addCandidate(f,f.property.id,'on_call');await addCandidate(f,f.targetProperty.id,'preferred_backup');
  const p=await plan(f);await reply(await promotion(p));
  for(const id of [f.job.id,f.target.id]){
   assert.equal((await svc.readOfferCoverage(id)).complete,false);
   for(const o of await current(id))if(o.state==='pending')await reply(o);
   assert.equal((await svc.readOfferCoverage(id)).complete,true);
  }
  const a=await current(f.job.id),b=await current(f.target.id);assert.ok(!a.some(x=>b.some(y=>x.cleaner_id===y.cleaner_id)));
 });
 await check('a missing or unqualified donor replacement leaves the donor team and pay unchanged',async()=>{
  const f=await make(),backup=(await current(f.job.id)).find(x=>x.role==='backup');
  await db.update(schema.cleaners).set({eligibleForAssignments:false}).where(eq(schema.cleaners.id,backup.cleaner_id));
  const before=JSON.stringify(await members(f.job.id));assert.equal(await priority.planPropertyPriority(f.target.id),null);assert.equal(JSON.stringify(await members(f.job.id)),before);assert.equal((await plans(f.target.id)).length,0);
 });
 await check('ordinary qualified fallback can cover an empty reviewed target while retaining the donor worker',async()=>{
  const f=await make(),backup=(await current(f.job.id)).find(x=>x.role==='backup'),alternative=await addCandidate(f,f.targetProperty.id,'preferred_backup');
  await db.update(schema.cleaners).set({eligibleForAssignments:false}).where(eq(schema.cleaners.id,backup.cleaner_id));
  const outcome=await engine.assignJob(f.target);assert.equal(outcome.status,'assigned');assert.equal(outcome.primaryCleanerId,alternative.id);
  assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id&&x.role==='primary'));
  const o=(await current(f.target.id)).find(x=>x.cleaner_id===alternative.id);assert.equal(o.state,'pending');assert.equal((await svc.readOfferCoverage(f.target.id)).complete,false);
  assert.equal((await engine.assignJob(f.target)).reason,'versioned_job_needs_coverage_review');
  const f2=await seed(),[unrelated]=await db.insert(schema.jobs).values({propertyId:f2.property.id,calendarEventUid:uuid(),status:'unassigned',checkInTime:f.target.checkInTime,expectedHours:'3',addonsSnapshot:{teamSize:1,laundryType:'none'}}).returning();made.push(unrelated.id);
  await db.transaction(tx=>svc.enrollOfferJob(tx,unrelated.id));
  assert.equal(await priority.canAssignPriorityFallback(unrelated.id),false);assert.equal((await engine.assignJob(unrelated)).reason,'versioned_job_needs_coverage_review');
 });
 await check('physical arrival after planning blocks final displacement even while the status is assigned',async()=>{
  const f=await make(),p=await plan(f),o=await promotion(p);
  await db.insert(schema.evidencePackets).values({jobId:f.job.id,gpsCheckInTimestamp:new Date(),gpsCheckInLatitude:'28',gpsCheckInLongitude:'-81'});
  await assert.rejects(()=>reply(o));assert.equal((await plans(f.target.id))[0].state,'failed');assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id));
 });
 await check('a second plan cannot reserve an active donor; cancellation cannot revoke a completed move',async()=>{
  const f=await make(),p=await plan(f);await priority.discoverPriorityPlans();assert.equal((await plans(f.target.id)).length,1);
  await reply(await promotion(p));await priority.cancelPriorityPlan(f.target.id,p.id,'synthetic-admin');assert.equal((await plans(f.target.id))[0].state,'completed');assert.ok((await members(f.target.id)).some(x=>x.cleanerId===f.cleaner.id));
 });
 await check('admin routes require trusted admin identity and return private plan history without exposing it to cleaner readers',async()=>{
  const f=await make();let admin=false;
  replace('lib/admin-auth.ts',{getAdminAuth:async()=>({isAdmin:admin,actorId:'synthetic-admin'})});
  delete require.cache[require.resolve(path.join(root,'app/api/admin/jobs/[id]/offers/route.ts'))];
  const route=require(path.join(root,'app/api/admin/jobs/[id]/offers/route.ts')),params={params:Promise.resolve({id:f.target.id})};
  const post=body=>route.POST(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),params);
  assert.equal((await post({action:'plan_priority'})).status,401);admin=true;
  assert.equal((await post({action:'plan_priority',cleanerId:uuid()})).status,400);assert.equal((await post({action:'plan_priority'})).status,200);
  const before=JSON.stringify(await plans(f.target.id)),get=await route.GET(new Request('https://synthetic.invalid'),params);assert.match(get.headers.get('cache-control'),/no-store/);assert.equal((await get.json()).priorityPlans.length,1);assert.equal(JSON.stringify(await plans(f.target.id)),before);
  const cleaner=await svc.readOfferCoverage(f.job.id,f.cleaner.id);assert.equal(cleaner.priorityPlans,undefined);
 });
 await check('notification review SQL includes failed priority notices before pagination',async()=>{
  const f=await make(),p=await plan(f);setFailures(true,false);await reply(await promotion(p));setFailures(false,false);
  const filter=require(path.join(root,'lib/services/assignment/lifecycle-read.service.ts')).assignmentIssueFilter('notification_attention');
  const found=await db.select({id:schema.jobs.id}).from(schema.jobs).where(filter);assert.ok(found.some(x=>x.id===f.target.id));assert.ok(found.some(x=>x.id===f.job.id));
 });
 await check('a new cross-date physical conflict on a proposed teammate aborts the whole move',async()=>{
  const f=await make({targetSize:2}),c=await addCandidate(f,f.targetProperty.id,'secondary_primary'),p=await plan(f);
  const start=new Date(+f.target.checkInTime-24*3600000),day=require('date-fns-tz').formatInTimeZone(start,'America/New_York','yyyy-MM-dd');assert.notEqual(day,f.day);
  await db.insert(schema.availabilityDays).values({cleanerId:c.id,date:day,isAvailable:true,onCallEligible:true,openPoolEligible:true,actorId:'synthetic'});
  const [other]=await db.insert(schema.jobs).values({propertyId:(await seed()).property.id,calendarEventUid:uuid(),status:'unassigned',checkInTime:start,expectedHours:'30',addonsSnapshot:{teamSize:1,laundryType:'none'}}).returning();made.push(other.id);
  await db.transaction(async tx=>{await tx.insert(schema.jobsToCleaners).values({jobId:other.id,cleanerId:c.id,role:'primary'});await tx.update(schema.jobs).set({status:'assigned'}).where(eq(schema.jobs.id,other.id));});
  await assert.rejects(async()=>reply(await promotion(p)));assert.equal((await plans(f.target.id))[0].state,'failed');assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id));assert.equal((await members(f.target.id)).length,0);
 });
 await check('transient serialization/deadlock errors retry without duplicate plans or working moves',async()=>{
  const f=await make(),transaction=db.transaction.bind(db);let injected=0;
  db.transaction=async(...args)=>{if(!injected++){const error=Error('synthetic serialization retry');error.code='40001';throw error;}return transaction(...args);};
  let p;try{p=await plan(f);}finally{db.transaction=transaction;}
  assert.equal((await plans(f.target.id)).length,1);const o=await promotion(p);injected=0;
  db.transaction=async(...args)=>{if(!injected++){const error=Error('synthetic deadlock retry');error.code='40P01';throw error;}return transaction(...args);};
  try{await reply(o);}finally{db.transaction=transaction;}
  assert.equal((await plans(f.target.id))[0].state,'completed');assert.equal((await members(f.target.id)).filter(x=>x.cleanerId===f.cleaner.id).length,1);
 });
 await check('admin cancellation is scoped and revokes stale promotion replies',async()=>{
  const f=await make(),p=await plan(f);await assert.rejects(()=>priority.cancelPriorityPlan(uuid(),p.id,'synthetic-admin'));
  await priority.cancelPriorityPlan(f.target.id,p.id,'synthetic-admin');assert.equal((await plans(f.target.id))[0].state,'canceled');await assert.rejects(async()=>reply(await promotion(p)));
  assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id));
 });
 await check('priority enrollment defaults off and readiness remains available for pending replies',async()=>{
  const f=await make(),p=await plan(f);delete process.env.ASSIGNMENT_PRIORITY_ENROLLMENT;await reply(await promotion(p));assert.equal((await plans(f.target.id))[0].state,'completed');
  const second=await make();assert.equal(await priority.planPropertyPriority(second.target.id),null);
  delete process.env.ASSIGNMENT_PRIORITY_SCHEMA_READY;assert.deepEqual(await priority.readPriorityPlans(f.target.id),[]);
 });
};
if(require.main===module){const result=require('node:child_process').spawnSync(process.execPath,['--require',path.join(__dirname,'test-assignment-offers.cjs'),path.join(__dirname,'test-job-execution.cjs'),'--with-schedule-upgrade','--phase2c','--assignment-offers','--assignment-lifecycle','--property-priority'],{stdio:'inherit',env:process.env,windowsHide:true});process.exitCode=result.status??1;}

