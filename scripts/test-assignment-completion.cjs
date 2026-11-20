// Actual SQL0069, services and authenticated routes; synthetic PostgreSQL only.
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
exports.verify=async function(ctx){
 const {db,pg,schema,seed,row,test,root,uuid,replace,fixture,current,reply,svc,engine,channels,emails,alerts,setFailures}=ctx;
 const {eq,and}=require('drizzle-orm'),H=3600000,policy=require(path.join(root,'lib/services/assignment/lifecycle-policy.ts'));
 const life=require(path.join(root,'lib/services/assignment/lifecycle.service.ts')),priority=require(path.join(root,'lib/services/assignment/priority.service.ts'));
 const sql=async(q,args=[]) => (await pg.query(q,args)).rows;
 const members=id=>db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,id));
 const migration=fs.readFileSync(path.join(root,'db/supabase/migrations/0069_phase3a_assignment_completion.sql'),'utf8');
 await test('completion SQL reapplies privately without changing assignments, offers, pay or enrolled policies',async()=>{
  const snapshot=async()=>JSON.stringify(await sql("select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(x)) from jobs x),'members',(select jsonb_agg(to_jsonb(x)) from jobs_to_cleaners x),'offers',(select jsonb_agg(to_jsonb(x)) from phase3a_assignment_offers x),'pay',(select jsonb_agg(to_jsonb(x)) from payouts x)) v"));
  const before=await snapshot();await pg.exec(migration);await pg.exec(migration);assert.equal(await snapshot(),before);
  assert.equal((await sql('select count(*)::int n from phase3a_offer_jobs where automation_policy is not null'))[0].n,0);
  assert.equal((await sql("select relrowsecurity v from pg_class where oid='phase3a_priority_move_approvals'::regclass"))[0].v,true);
  for(const role of ['anon','authenticated'])assert.equal((await sql("select has_table_privilege($1,'phase3a_priority_move_approvals','SELECT,INSERT,UPDATE,DELETE') v",[role]))[0].v,false);
 });
 function enable(){Object.assign(process.env,{ASSIGNMENT_OFFERS_SCHEMA_READY:'true',ASSIGNMENT_OFFERS_ENROLLMENT:'true',ASSIGNMENT_LIFECYCLE_SCHEMA_READY:'true',ASSIGNMENT_LIFECYCLE_ENROLLMENT:'true',ASSIGNMENT_PRIORITY_SCHEMA_READY:'true',ASSIGNMENT_PRIORITY_ENROLLMENT:'true',ASSIGNMENT_EXCEPTIONS_SCHEMA_READY:'true',ASSIGNMENT_EXCEPTIONS_ENROLLMENT:'true'});}
 enable();const made=[];let caseNumber=0;
 async function make(lead=100,options={}){const f=await fixture({...options,startAt:new Date(Date.now()+lead*H)});made.push(f.job.id);return f;}
 async function check(name,run){const first=made.length;await test('completion '+name,async()=>{try{await run();}finally{enable();setFailures(false,false);for(const id of made.slice(first))await db.update(schema.jobs).set({status:'canceled'}).where(eq(schema.jobs.id,id));}});}
 const worker=async f=>(await current(f.job.id)).find(o=>o.role!=='backup');
 const reconfs=id=>sql('select r.* from phase3a_reconfirmations r join phase3a_assignment_offers o on o.id=r.offer_id where o.job_id=$1',[id]);
 const actions=id=>sql('select a.* from phase3a_lifecycle_actions a join phase3a_assignment_offers o on o.id=a.offer_id where o.job_id=$1',[id]);
 async function tick(at=new Date()){const result=await life.processAssignmentLifecycle(new Date(at));assert.deepEqual(result.errors,[]);return result;}
 async function acceptAll(f){for(const o of await current(f.job.id))if(o.state==='pending')await reply(o);}
 async function addCandidate(f,propertyId,tier='preferred_backup',extra={}){
  const c=(await seed()).cleaner;await db.update(schema.cleaners).set({accountStatus:'active',eligibleForAssignments:true,reliabilityScore:'95',...extra}).where(eq(schema.cleaners.id,c.id));
  await db.insert(schema.availability).values({cleanerId:c.id,date:f.day,availabilityType:'vacation_rental',startTime:'00:00',endTime:'23:59',onCallEligible:true,openPoolEligible:true});
  await db.insert(schema.availabilityDays).values({cleanerId:c.id,date:f.day,isAvailable:true,onCallEligible:true,openPoolEligible:true,actorId:'synthetic'});
  await db.insert(schema.cleanerAvailabilitySubmissions).values({cleanerId:c.id,periodStart:f.day,periodEnd:f.day});
  if(tier)await db.insert(schema.propertyCleaners).values({propertyId,cleanerId:c.id,tier});return c;
 }
 await check('new jobs pin complete policy and backup/working offers receive the scope windows',async()=>{
  const f=await make();assert.equal((await sql('select automation_policy from phase3a_offer_jobs where job_id=$1',[f.job.id]))[0].automation_policy,'phase3a-complete-2026-11-13');
  for(const o of await current(f.job.id)){assert.equal(o.deadline_gate,null);assert.equal(+new Date(o.response_due_at)-+new Date(o.offered_at),12*H);}
 });
 await check('new working rates freeze without repricing after a profile or leader edit',async()=>{
  const f=await make(),before=(await members(f.job.id)).find(x=>x.cleanerId===f.cleaner.id);assert.equal(before.frozenHourlyRateCents,1700);
  await db.update(schema.cleaners).set({hourlyRateCents:2500}).where(eq(schema.cleaners.id,f.cleaner.id));await db.update(schema.jobsToCleaners).set({isTeamLeader:false}).where(and(eq(schema.jobsToCleaners.jobId,f.job.id),eq(schema.jobsToCleaners.cleanerId,f.cleaner.id)));
  assert.equal((await members(f.job.id)).find(x=>x.cleanerId===f.cleaner.id).frozenHourlyRateCents,1700);
  await assert.rejects(()=>sql('update phase3a_offer_jobs set automation_policy=null where job_id=$1',[f.job.id]),/frozen/);
 });
 await check('SQL and pure capped timing agree at exact tiers and near/past-start boundaries',async()=>{
  const f=await make(100,{backups:0});let old=await worker(f);
  for(const lead of [72*H+1,72*H,24*H,24*H-1,30*60000,15*60000,1,0,-1]){
   await sql("update phase3a_assignment_offers set state='revoked',revoked_at=now() where id=$1",[old.id]);
   const offered=new Date(+f.job.checkInTime-lead);old=(await sql('insert into phase3a_assignment_offers(job_id,cleaner_id,role,schedule_version,offered_at) values($1,$2,$3,1,$4) returning *',[f.job.id,f.cleaner.id,'primary',offered.toISOString()]))[0];
   const expected=policy.cappedResponseTimes(offered,f.job.checkInTime);assert.equal(+new Date(old.response_due_at),+expected.dueAt);assert.equal(+new Date(old.response_reminder_at),+expected.reminderAt);assert.equal(old.deadline_gate,null);
  }
 });
 await check('near-start response closes at start and no post-start promotion or acceptance is permitted',async()=>{
  const f=await make(0.25),o=await worker(f);assert.equal(+new Date(o.response_due_at),+f.job.checkInTime);
  await tick(+f.job.checkInTime+1000);assert.equal((await sql('select state from phase3a_assignment_offers where id=$1',[o.id]))[0].state,'revoked');await assert.rejects(()=>reply(o));
  assert.equal((await current(f.job.id)).filter(x=>x.replaces_cleaner_id).length,0);assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id));
 });
 await check('expired standby is retired, never promoted or repeatedly reoffered, and qualified fallback receives a fresh deadline',async()=>{
  const f=await make(),w=await worker(f);await reply(w);const b=(await current(f.job.id)).find(o=>o.role==='backup'),fallback=await addCandidate(f,f.property.id,'on_call');
  await tick(+new Date(b.response_due_at)+1);assert.equal((await sql('select reason from phase3a_assignment_offers where id=$1',[b.id]))[0].reason,'response_deadline_expired');
  assert.ok(!(await members(f.job.id)).some(x=>x.cleanerId===b.cleaner_id));const fresh=(await current(f.job.id)).find(o=>o.cleaner_id===fallback.id);assert.equal(fresh.role,'backup');assert.ok(fresh.response_due_at);await reply(fresh);
  assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id&&x.role==='primary'));assert.ok((await actions(f.job.id)).some(x=>x.kind==='offer_expired'));
 });
 await check('promoted working proposals receive deadlines and their expiry retains the current accepted worker',async()=>{
  const f=await make();await acceptAll(f);const original=(await members(f.job.id)).find(x=>x.cleanerId===f.cleaner.id),p=await svc.offerPairedPromotion(f.job.id,f.cleaner.id,'synthetic-admin');
  assert.ok(p.response_due_at);assert.equal(p.deadline_gate,null);await tick(+new Date(p.response_due_at)+1);assert.equal((await sql('select reason from phase3a_assignment_offers where id=$1',[p.id]))[0].reason,'response_deadline_expired');
  assert.deepEqual((await members(f.job.id)).find(x=>x.cleanerId===f.cleaner.id),original);assert.ok(!(await members(f.job.id)).some(x=>x.cleanerId===p.cleaner_id));
 });
 await check('reschedules invalidate old responses and give each fresh working/backup duty an automatic deadline',async()=>{
  const f=await make();await acceptAll(f);const old=await current(f.job.id);await db.update(schema.jobs).set({checkOutTime:new Date(+f.job.checkOutTime+60000)}).where(eq(schema.jobs.id,f.job.id));
  const fresh=await current(f.job.id);assert.equal(fresh.length,2);assert.ok(fresh.every(o=>o.schedule_version===2&&o.state==='pending'&&o.response_due_at&&o.deadline_gate===null));await assert.rejects(()=>reply(old[0]));
 });
 await check('inside-T24 fresh acceptance reconfirms exact working and backup duties without duplicate prompts',async()=>{
  const f=await make(23);await acceptAll(f);await tick();await tick();const records=await reconfs(f.job.id);assert.equal(records.length,2);assert.ok(records.every(r=>r.state==='confirmed'&&r.responded_at));
  assert.ok(!(await actions(f.job.id)).some(a=>a.kind==='reconfirmation_policy_review'));assert.ok((await actions(f.job.id)).filter(a=>a.kind==='reconfirmation_request').every(a=>a.dispatch_state==='skipped'));
 });
 await check('rescheduled duties accepted before T24 use ordinary reconfirmation and silence preserves pay/membership',async()=>{
  const f=await make();await acceptAll(f);await db.update(schema.jobs).set({checkOutTime:new Date(+f.job.checkOutTime+60000)}).where(eq(schema.jobs.id,f.job.id));await acceptAll(f);
  const before=JSON.stringify(await members(f.job.id));await tick(+f.job.checkInTime-24*H);assert.ok((await reconfs(f.job.id)).filter(r=>r.state!=='revoked').every(r=>r.state==='pending'&&r.schedule_version===2));
  await tick(+f.job.checkInTime-12*H);assert.equal(JSON.stringify(await members(f.job.id)),before);assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.job.id))).length,0);
 });
 await check('promoted duties accepted before T24 reconfirm under their current role instead of policy review',async()=>{
  const f=await make();await acceptAll(f);const promotion=await svc.offerPairedPromotion(f.job.id,f.cleaner.id,'synthetic-admin');await reply(promotion);await tick(+f.job.checkInTime-24*H);
  const records=await reconfs(f.job.id);assert.ok(records.some(r=>r.offer_id===promotion.id&&r.state==='pending'));assert.ok(!(await actions(f.job.id)).some(a=>a.kind==='reconfirmation_policy_review'));
 });
 async function makePriority({legacy=false,residential=false,size=1,hot=false,laundry=false}={}){
  if(legacy)process.env.ASSIGNMENT_OFFERS_ENROLLMENT='false';
  const f=await fixture({startAt:new Date(Date.UTC(2037,4,2+caseNumber++,14)),residential,size,hot,laundry});made.push(f.job.id);enable();if(!legacy)await acceptAll(f);
  await db.update(schema.propertyCleaners).set({tier:'secondary_primary'}).where(and(eq(schema.propertyCleaners.propertyId,f.property.id),eq(schema.propertyCleaners.cleanerId,f.cleaner.id)));
  const p=(await seed()).property;await db.insert(schema.propertyCleaners).values({propertyId:p.id,cleanerId:f.cleaner.id,tier:'main_primary'});
  const incumbents=[];for(let i=0;i<size;i++)incumbents.push(await addCandidate(f,p.id,'secondary_primary',{hasHotTubCert:hot,hasLaundryLeadCert:laundry}));
  const [target]=await db.insert(schema.jobs).values({propertyId:p.id,calendarEventUid:uuid(),status:'unassigned',checkInTime:new Date(+f.job.checkInTime+5*H),checkOutTime:new Date(+f.job.checkInTime+11*H),expectedHours:f.job.expectedHours,addonsSnapshot:f.job.addonsSnapshot,serviceType:f.job.serviceType}).returning();made.push(target.id);
  await db.transaction(async tx=>{await svc.enrollOfferJob(tx,target.id);for(let i=0;i<incumbents.length;i++)await tx.insert(schema.jobsToCleaners).values({jobId:target.id,cleanerId:incumbents[i].id,role:laundry&&i===0?'laundry_lead':'primary'});await tx.update(schema.jobs).set({status:'assigned'}).where(eq(schema.jobs.id,target.id));});
  for(const o of await current(target.id))await reply(o);return {...f,target:{...target,status:'assigned'},targetProperty:p,incumbents};
 }
 const plans=id=>sql('select * from phase3a_priority_plans where target_job_id=$1 order by created_at',[id]);
 const promotion=p=>sql('select * from phase3a_assignment_offers where id=$1',[p.replacement_offer_id]).then(x=>x[0]);
 const approval=p=>sql('select * from phase3a_priority_move_approvals where plan_id=$1',[p.id]).then(x=>x[0]);
 async function plan(f){const p=await priority.planPropertyPriority(f.target.id,'synthetic-admin');assert.ok(p,'Expected safe staffed-target plan');return p;}
 const approve=async(f,p,response='accepted',patch={})=>priority.respondToPriorityMove({sourceJobId:f.job.id,cleanerId:f.cleaner.id,planId:p.id,targetScheduleVersion:(await approval(p)).target_schedule_version,response,...patch});
 async function atProposalTime(at,work){const OriginalDate=global.Date;global.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[at]));}};try{return await work();}finally{global.Date=OriginalDate;}}
 await check('staffed priority targets preserve both teams until main and donor replacement explicitly confirm',async()=>{
  const f=await makePriority(),before=JSON.stringify(await members(f.target.id)),donor=JSON.stringify(await members(f.job.id)),p=await plan(f),o=await promotion(p);
  await reply(o);assert.equal((await plans(f.target.id))[0].state,'pending');assert.equal(JSON.stringify(await members(f.target.id)),before);assert.equal(JSON.stringify(await members(f.job.id)),donor);
  await priority.processPriorityPlans();assert.equal((await plans(f.target.id))[0].state,'pending');const result=await approve(f,p);assert.equal(result.state,'completed');assert.equal(result.destination,`/cleaner/jobs/${f.target.id}`);
  assert.ok((await members(f.target.id)).some(x=>x.cleanerId===f.cleaner.id&&x.role==='primary'));assert.ok(!(await members(f.target.id)).some(x=>x.cleanerId===f.incumbents[0].id));assert.ok((await current(f.target.id)).some(x=>x.cleaner_id===f.cleaner.id&&x.state==='accepted'));
  await approve(f,p);assert.equal((await sql("select count(*)::int n from phase3a_priority_events where plan_id=$1 and state='completed'",[p.id]))[0].n,1);
 });
 await check('incoming main confirmation first also waits for donor replacement and exact retries are idempotent',async()=>{
  const f=await makePriority(),p=await plan(f),before=JSON.stringify(await members(f.target.id));assert.equal((await approve(f,p)).state,'pending');assert.equal(JSON.stringify(await members(f.target.id)),before);await approve(f,p);await reply(await promotion(p));assert.equal((await plans(f.target.id))[0].state,'completed');
  const accepted=await sql("select e.actor_id from phase3a_offer_events e join phase3a_assignment_offers o on o.id=e.offer_id where o.job_id=$1 and o.cleaner_id=$2 and e.kind='accepted'",[f.target.id,f.cleaner.id]);assert.deepEqual(accepted.map(x=>x.actor_id),[f.cleaner.id]);
 });
 await check('priority proposal halfway reminders deduplicate and are suppressed after acceptance',async()=>{
  const f=await makePriority(),p=await atProposalTime(Date.now()-7*H,()=>plan(f));await priority.processPriorityPlans();await priority.processPriorityPlans();const reminders=await sql("select * from phase3a_priority_notices where plan_id=$1 and state='approval_reminder'",[p.id]);assert.equal(reminders.length,1);
  await approve(f,p);await priority.dispatchPriorityNotices();assert.equal((await sql('select dispatch_state from phase3a_priority_notices where id=$1',[reminders[0].id]))[0].dispatch_state,'skipped');
 });
 await check('an expired main proposal stops without moving either team or accepting a late reply',async()=>{
  const f=await makePriority(),p=await atProposalTime(Date.now()-13*H,()=>plan(f)),before=JSON.stringify(await members(f.target.id));await priority.processPriorityPlans();assert.equal((await plans(f.target.id))[0].reason,'priority_move_response_expired');assert.equal((await approval(p)).state,'revoked');assert.equal(JSON.stringify(await members(f.target.id)),before);await assert.rejects(()=>approve(f,p));assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id));
 });
 await check('late priority replies are refused before the poller runs',async()=>{
  const f=await makePriority(),p=await atProposalTime(Date.now()-13*H,()=>plan(f));await assert.rejects(()=>approve(f,p));assert.equal((await plans(f.target.id))[0].state,'failed');assert.ok(!(await members(f.target.id)).some(x=>x.cleanerId===f.cleaner.id));
 });
 await check('main cleaner decline retains both teams and unchanged proposal is not offered repeatedly',async()=>{
  const f=await makePriority(),p=await plan(f),before=JSON.stringify(await members(f.target.id));await approve(f,p,'declined');assert.equal((await plans(f.target.id))[0].reason,'priority_move_declined');assert.equal(JSON.stringify(await members(f.target.id)),before);assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id));assert.equal(await priority.planPropertyPriority(f.target.id),null);
 });
 for(const change of ['schedule','started','pay','exclusion'])await check('a '+change+' change while confirmations wait safely stops the entire move',async()=>{
  const f=await makePriority(),p=await plan(f),o=await promotion(p);await reply(o);const before=JSON.stringify(await members(f.target.id));
  if(change==='schedule')await db.update(schema.jobs).set({checkOutTime:new Date(+f.target.checkOutTime+60000)}).where(eq(schema.jobs.id,f.target.id));
  if(change==='started')await db.update(schema.jobs).set({status:'in-progress'}).where(eq(schema.jobs.id,f.target.id));
  if(change==='pay')await db.update(schema.cleaners).set({hourlyRateCents:2300}).where(eq(schema.cleaners.id,f.cleaner.id));
  if(change==='exclusion')await db.insert(schema.propertyExclusions).values({propertyId:f.targetProperty.id,cleanerId:f.cleaner.id,reason:'Synthetic',actorId:'synthetic'});
  await assert.rejects(()=>approve(f,p));assert.equal((await plans(f.target.id))[0].state,'failed');assert.equal(JSON.stringify(await members(f.target.id)),before);assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id&&x.role==='primary'));
 });
 await check('legacy future donors get fresh offers without fabricated acceptance or changed pay before priority proceeds',async()=>{
  const f=await makePriority({legacy:true}),before=JSON.stringify(await members(f.job.id));assert.equal(await priority.planPropertyPriority(f.target.id),null);const offers=await current(f.job.id);assert.ok(offers.length>=2);assert.ok(offers.every(o=>o.state==='pending'&&o.responded_at===null));assert.equal(JSON.stringify(await members(f.job.id)),before);
  await acceptAll(f);const p=await plan(f);await approve(f,p);await reply(await promotion(p));assert.equal((await plans(f.target.id))[0].state,'completed');
 });
 await check('future old-policy offers are reissued with new deadlines while old acceptance/pay remains intact',async()=>{
  delete process.env.ASSIGNMENT_EXCEPTIONS_ENROLLMENT;const f=await makePriority();const old=await current(f.job.id),oldTerms=JSON.stringify(await members(f.job.id));enable();
  // The working offer remains accepted; reissue the pending backup only.
  await sql("update phase3a_assignment_offers set state='revoked',revoked_at=now() where id=$1",[old.find(o=>o.role==='backup').id]);await svc.repairPairedBackups(f.job.id);const pending=(await current(f.job.id)).find(o=>o.role==='backup');assert.equal(pending.response_due_at,null);
  assert.equal(await priority.planPropertyPriority(f.target.id),null);const fresh=(await current(f.job.id)).find(o=>o.role==='backup');assert.notEqual(fresh.id,pending.id);assert.ok(fresh.response_due_at);assert.equal((await current(f.job.id)).find(o=>o.role!=='backup').state,'accepted');assert.equal(JSON.stringify(await members(f.job.id)),oldTerms);
 });
 await check('multi-worker priority handoff preserves headcounts, retained role acceptance and Laundry Lead/hot-tub qualifications',async()=>{
  const f=await makePriority({size:2,hot:true,laundry:true}),p=await plan(f);const retained=p.target_team.find(x=>x.cleanerId!==f.cleaner.id),old=(await members(f.target.id)).find(x=>x.cleanerId===retained.cleanerId);
  await approve(f,p);await reply(await promotion(p));for(const id of [f.job.id,f.target.id]){const team=(await members(id)).filter(x=>x.role!=='backup');assert.equal(team.length,2);assert.equal(team.filter(x=>x.role==='laundry_lead').length,1);assert.ok((await current(id)).filter(x=>x.role!=='backup').every(x=>x.state==='accepted'));}
  const after=(await members(f.target.id)).find(x=>x.cleanerId===retained.cleanerId);assert.equal(after.role,old.role);assert.equal(after.frozenHourlyRateCents,old.frozenHourlyRateCents);
 });
 await check('V2 staffed-target move preserves both customer snapshots/payments and issues the existing flat-rate contract',async()=>{
  const f=await makePriority({residential:true}),before=await row(schema.jobs,schema.jobs.id,f.target.id),p=await plan(f);assert.equal((await approval(p)).details.rateCents,1900);await approve(f,p);await reply(await promotion(p));const after=await row(schema.jobs,schema.jobs.id,f.target.id);assert.deepEqual(after.addonsSnapshot,before.addonsSnapshot);assert.equal(after.paymentIntentId,before.paymentIntentId);assert.equal(after.paymentStatus,before.paymentStatus);assert.equal((await members(f.target.id)).find(x=>x.cleanerId===f.cleaner.id).residentialPayTerms.hourlyRateCents,1900);assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.target.id))).length,0);
 });
 await check('multiple-main designations keep an existing main-property booking but unrelated designations do not block a valid move',async()=>{
  const f=await makePriority();await db.update(schema.propertyCleaners).set({tier:'main_primary'}).where(and(eq(schema.propertyCleaners.propertyId,f.property.id),eq(schema.propertyCleaners.cleanerId,f.cleaner.id)));const before=JSON.stringify(await members(f.job.id));assert.equal(await priority.planPropertyPriority(f.target.id),null);assert.equal(JSON.stringify(await members(f.job.id)),before);
  await db.update(schema.propertyCleaners).set({tier:'secondary_primary'}).where(and(eq(schema.propertyCleaners.propertyId,f.property.id),eq(schema.propertyCleaners.cleanerId,f.cleaner.id)));await db.insert(schema.propertyCleaners).values({propertyId:(await seed()).property.id,cleanerId:f.cleaner.id,tier:'main_primary'});assert.ok(await plan(f));
 });
 await check('a started donor is protected while an empty priority target can still receive eligible fallback coverage',async()=>{
  const f=await makePriority();await db.transaction(async tx=>{await tx.update(schema.jobs).set({status:'unassigned'}).where(eq(schema.jobs.id,f.target.id));await tx.delete(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.target.id));});await db.update(schema.jobs).set({status:'in-progress'}).where(eq(schema.jobs.id,f.job.id));
  const result=await engine.assignJob(await row(schema.jobs,schema.jobs.id,f.target.id));assert.equal(result.status,'assigned');assert.ok(!(await members(f.target.id)).some(x=>x.cleanerId===f.cleaner.id));assert.ok((await members(f.job.id)).some(x=>x.cleanerId===f.cleaner.id));
 });
 await check('forged cleaner/source/version responses cannot mutate another priority proposal',async()=>{
  const f=await makePriority(),p=await plan(f);for(const patch of [{cleanerId:uuid()},{sourceJobId:uuid()},{targetScheduleVersion:99}])await assert.rejects(()=>approve(f,p,'accepted',patch));assert.equal((await approval(p)).state,'pending');
  await assert.rejects(()=>sql("update phase3a_priority_move_approvals set details='{}' where plan_id=$1",[p.id]),/frozen/);await assert.rejects(()=>sql('delete from phase3a_priority_move_approvals where plan_id=$1',[p.id]),/frozen/);
 });
 await check('cleaner API exposes only own proposal and scoped response; committed replies remain idempotent after membership moves',async()=>{
  const f=await makePriority(),p=await plan(f);let cid=null;replace('lib/cleaner-auth.ts',{getCleanerAuth:async()=>({cleanerId:cid,error:cid?null:'Unauthorized'}),cleanerAuthErrorStatus:()=>401,requireCleanerJobAssignment:async(cleanerId,jobId)=>({error:(await members(jobId)).some(x=>x.cleanerId===cleanerId)?null:'Forbidden'})});
  delete require.cache[require.resolve(path.join(root,'app/api/cleaner/jobs/[id]/offers/route.ts'))];const api=require(path.join(root,'app/api/cleaner/jobs/[id]/offers/route.ts')),context={params:Promise.resolve({id:f.job.id})},body={action:'priority_move',planId:p.id,targetScheduleVersion:(await approval(p)).target_schedule_version,response:'accepted'};
  const post=value=>api.POST(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}),context);
  assert.equal((await post(body)).status,401);cid=uuid();assert.equal((await post(body)).status,409);cid=f.cleaner.id;assert.equal((await post({...body,cleanerId:uuid()})).status,400);
  const view=await api.GET(new Request('https://synthetic.invalid'),context),own=await view.json();assert.equal(own.priorityMoves.length,1);assert.equal(own.priorityPlans,undefined);assert.doesNotMatch(JSON.stringify(own.priorityMoves),/target_fingerprint|entryCode|accessCode/);
  await reply(await promotion(p));const response=await post(body);assert.equal(response.status,200);const safe=await response.json();assert.equal(safe.state,'completed');assert.equal(safe.plan,undefined);assert.equal(safe.target_team,undefined);assert.equal((await post(body)).status,200);assert.equal((await api.GET(new Request('https://synthetic.invalid'),context)).status,403);
 });
 await check('proposed confirmation and overdue filters include their jobs before pagination',async()=>{
  const f=await makePriority(),p=await atProposalTime(Date.now()-13*H,()=>plan(f)),read=require(path.join(root,'lib/services/assignment/lifecycle-read.service.ts'));
  for(const issue of ['missing_confirmation','response_overdue']){const found=await db.select({id:schema.jobs.id}).from(schema.jobs).where(read.assignmentIssueFilter(issue));assert.ok(found.some(x=>x.id===f.target.id));assert.ok(found.some(x=>x.id===f.job.id));}
  assert.equal((await approval(p)).state,'pending');
 });
 await check('completed priority plans cannot be canceled to revoke already-secured working acceptance',async()=>{
  const f=await makePriority(),p=await plan(f);await approve(f,p);await reply(await promotion(p));const before=JSON.stringify(await members(f.job.id));await priority.cancelPriorityPlan(f.target.id,p.id,'synthetic-admin');assert.equal(JSON.stringify(await members(f.job.id)),before);assert.equal((await promotion(p)).state,'accepted');
 });
 await check('admin can upgrade a specific future job; accepted roles/pay survive, pending offers are reissued, and started work is refused',async()=>{
  delete process.env.ASSIGNMENT_EXCEPTIONS_ENROLLMENT;const f=await make();const w=await worker(f);await reply(w);const oldBackup=(await current(f.job.id)).find(o=>o.role==='backup'),before=JSON.stringify(await members(f.job.id));enable();
  let admin=false;replace('lib/admin-auth.ts',{getAdminAuth:async()=>({isAdmin:admin,actorId:admin?'synthetic-admin':undefined})});delete require.cache[require.resolve(path.join(root,'app/api/admin/jobs/[id]/offers/route.ts'))];const api=require(path.join(root,'app/api/admin/jobs/[id]/offers/route.ts')),context={params:Promise.resolve({id:f.job.id})};
  const post=body=>api.POST(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),context);
  assert.equal((await post({action:'upgrade_future_policy'})).status,401);admin=true;assert.equal((await post({action:'upgrade_future_policy',cleanerId:uuid()})).status,400);
  assert.equal((await api.GET(new Request('https://synthetic.invalid'),context)).status,200);assert.equal((await post({action:'upgrade_future_policy'})).status,200);assert.equal(JSON.stringify(await members(f.job.id)),before);
  const fresh=await current(f.job.id);assert.equal(fresh.find(o=>o.cleaner_id===w.cleaner_id).state,'accepted');const backup=fresh.find(o=>o.role==='backup');assert.notEqual(backup.id,oldBackup.id);assert.ok(backup.response_due_at);await assert.rejects(()=>reply(oldBackup));
  await db.update(schema.jobs).set({status:'in-progress'}).where(eq(schema.jobs.id,f.job.id));assert.equal((await post({action:'upgrade_future_policy'})).status,409);
 });
 await check('priority preparation never resets a missed working deadline automatically',async()=>{
  const f=await make(),w=await worker(f);await tick(+new Date(w.response_due_at)+1);const count=(await sql('select * from phase3a_assignment_offers where job_id=$1 and cleaner_id=$2',[f.job.id,f.cleaner.id])).length;
  const prep=require(path.join(root,'lib/services/assignment/priority-preparation.ts'));await prep.prepareFuturePriorityJob(f.job.id);assert.equal((await sql('select * from phase3a_assignment_offers where job_id=$1 and cleaner_id=$2',[f.job.id,f.cleaner.id])).length,count);
 });
 await check('upgrading old policy preserves the identity/deadline of an already timed pending working offer',async()=>{
  delete process.env.ASSIGNMENT_EXCEPTIONS_ENROLLMENT;const f=await make(),w=await worker(f);enable();await require(path.join(root,'lib/services/assignment/priority-preparation.ts')).prepareFuturePriorityJob(f.job.id);
  const after=(await current(f.job.id)).find(o=>o.cleaner_id===w.cleaner_id);assert.equal(after.id,w.id);assert.equal(+new Date(after.response_due_at),+new Date(w.response_due_at));assert.equal(after.state,'pending');
 });
 await check('new enrollment remains off by default and existing marked readers do not depend on enrollment staying enabled',async()=>{
  const f=await make(23);await acceptAll(f);delete process.env.ASSIGNMENT_EXCEPTIONS_ENROLLMENT;await tick();assert.ok((await reconfs(f.job.id)).every(r=>r.state==='confirmed'));const legacy=await make();assert.equal((await sql('select automation_policy from phase3a_offer_jobs where job_id=$1',[legacy.job.id]))[0].automation_policy,null);
 });
};
if(require.main===module){const result=require('node:child_process').spawnSync(process.execPath,['--require',path.join(__dirname,'test-assignment-offers.cjs'),path.join(__dirname,'test-job-execution.cjs'),'--with-schedule-upgrade','--phase2c','--assignment-offers','--assignment-lifecycle','--property-priority','--assignment-completion'],{stdio:'inherit',env:process.env,windowsHide:true});process.exitCode=result.status??1;}
