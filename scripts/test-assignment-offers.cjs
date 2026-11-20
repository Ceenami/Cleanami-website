// Actual SQL triggers, services and authenticated routes against synthetic PGlite.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
// Also loaded as the child's preload, before any application modules.
for (const key of Object.keys(process.env)) if (/database|postgres|supabase|stripe|resend|twilio|vapid|assignment_exceptions/i.test(key)) delete process.env[key];
global.fetch = async () => { throw Error('Network prohibited in assignment tests'); };
require('node:net').Socket.prototype.connect = function() { throw Error('Network prohibited in assignment tests'); };
exports.verify = async function(ctx) {
  const { db, pg, schema, seed, row, test, replace, root, uuid } = ctx;
  const { eq, and } = require('drizzle-orm');
  const { formatInTimeZone } = require('date-fns-tz');
  const channels = [], emails = [], alerts = [];
  let failChannel = false, failEmail = false, nearby=[];
  replace('db/index.ts', { db, schema, sequentialQueries: async (...queries) => { const result=[]; for(const q of queries) result.push(await q()); return result; } });
  replace('lib/services/notifications/notify.ts', { notifyCleaner: async x => { channels.push(x); if(failChannel) throw Error('synthetic uncertain send'); } });
  replace('lib/services/email.service.ts', { sendTransactionalEmail: async (...args) => { emails.push(args); return {success: !failEmail}; }, sendCleanerAssignmentEmail: async x => { emails.push(x); return {success:true}; } });
  replace('lib/queries/admin-notifications.ts', { notifyAdmins: async x => { alerts.push(x); return 1; } });
  replace('lib/queries/cleaners-proximity.ts', { getAvailableCleanersForProperty: async () => nearby });
  for(const file of ['lib/services/assignment/priority-notices.service.ts','lib/services/assignment/priority-transitions.ts','lib/services/assignment/priority.service.ts','lib/services/assignment/candidates.service.ts','lib/services/assignment/offers.service.ts','lib/services/assignment/assignment-engine.service.ts']) delete require.cache[require.resolve(path.join(root,file))];
  const svc = require(path.join(root,'lib/services/assignment/offers.service.ts'));
  const engine = require(path.join(root,'lib/services/assignment/assignment-engine.service.ts'));
  const policy = require(path.join(root,'lib/services/assignment/offer-policy.ts'));
  const sqlFile=fs.readFileSync(path.join(root,'db/supabase/migrations/0058_phase3a_assignment_offers.sql'),'utf8');
  await test('M4 migration reapplies without changing job, pay, evidence or existing assignments', async()=>{
    const snapshot=async()=>JSON.stringify((await pg.query("select jsonb_build_object('jobs',(select jsonb_agg(to_jsonb(j)) from jobs j),'assignments',(select jsonb_agg(to_jsonb(x)) from jobs_to_cleaners x),'payouts',(select jsonb_agg(to_jsonb(p)) from payouts p),'evidence',(select jsonb_agg(to_jsonb(e)) from evidence_packets e)) as value")).rows);
    const before=await snapshot(); await pg.exec(sqlFile); await pg.exec(sqlFile); assert.equal(await snapshot(),before);
    assert.equal((await pg.query('select count(*)::int n from phase3a_offer_jobs')).rows[0].n,0);
    for(const table of ['phase3a_offer_jobs','phase3a_assignment_offers','phase3a_offer_events','phase3a_coverage_alerts']) {
      assert.equal((await pg.query(`select relrowsecurity from pg_class where oid='${table}'::regclass`)).rows[0].relrowsecurity,true);
      for(const role of ['anon','authenticated']) assert.equal((await pg.query(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE') allowed`)).rows[0].allowed,false);
    }
  });
  process.env.ASSIGNMENT_OFFERS_SCHEMA_READY='true'; process.env.ASSIGNMENT_OFFERS_ENROLLMENT='true';
  const offers=async jid=>(await pg.query('select * from phase3a_assignment_offers where job_id=$1 order by version',[jid])).rows;
  const current=async jid=>(await offers(jid)).filter(o=>o.state!=='revoked');
  const reply=async(o,response='accepted',patch={})=>svc.respondToOffer({jobId:o.job_id,cleanerId:o.cleaner_id,offerId:o.id,version:o.version,scheduleVersion:o.schedule_version,role:o.role,response,...patch});
  let dayIndex=0;
  async function fixture({size=1,backups=size,hot=false,laundry=false,residential=false,startAt}={}) {
    const f=await seed(), members=[];
    const start=startAt ?? new Date(Date.UTC(2034,10,5+dayIndex++,15)), day=formatInTimeZone(start,'America/New_York','yyyy-MM-dd');
    for(let i=0;i<size+backups;i++) {
      const cleaner=i===0?f.cleaner:(await seed()).cleaner;
      await db.update(schema.cleaners).set({accountStatus:'active',eligibleForAssignments:true,hasHotTubCert:hot&&(i===0||i===size),hasLaundryLeadCert:laundry&&(i===0||i===size),reliabilityScore:String(100-i)}).where(eq(schema.cleaners.id,cleaner.id));
      await db.insert(schema.availability).values({cleanerId:cleaner.id,date:day,availabilityType:'vacation_rental',startTime:'00:00',endTime:'23:59',onCallEligible:true,openPoolEligible:true});
      await db.insert(schema.availabilityDays).values({cleanerId:cleaner.id,date:day,isAvailable:true,onCallEligible:true,openPoolEligible:true,actorId:'synthetic'});
      await db.insert(schema.cleanerAvailabilitySubmissions).values({cleanerId:cleaner.id,periodStart:day,periodEnd:day});
      await db.insert(schema.propertyCleaners).values({propertyId:f.property.id,cleanerId:cleaner.id,tier:i===0?'main_primary':i<size?'secondary_primary':'preferred_backup',sortOrder:i});
      members.push(cleaner);
    }
    let staffing={expectedHours:'3',addonsSnapshot:{teamSize:size,laundryType:laundry?'off_site':'none',hotTubServiceLevel:hot?'basic':'none'}};
    if(residential) {
      const pricing=require(path.join(root,'lib/pricing/residential.ts')); const terms=pricing.buildResidentialV2AnalysisTerms({bedrooms:1,bathrooms:1,sqft:750,cleaningLevel:'standard',petsAllowed:false,hotTub:'none',inUnitLaundryLoads:0});
      staffing=pricing.buildResidentialJobStaffing(terms,terms.amountCents);
      await db.update(schema.properties).set({serviceType:'residential_one_time',bedCount:1,bathCount:'1',sqFt:750}).where(eq(schema.properties.id,f.property.id));
    }
    const [job]=await db.insert(schema.jobs).values({propertyId:f.property.id,calendarEventUid:uuid(),status:'unassigned',jobSource:'manual',serviceType:residential?'residential_one_time':'vacation_rental_subscription',checkInTime:start,checkOutTime:new Date(+start+6*3600000),...staffing}).returning();
    const outcome=await engine.assignJob(job); assert.equal(outcome.status,'assigned'); return {...f,job,members,day};
  }
  await test('M4 maximum distinct pairing avoids a greedy specialist shortage',()=>{
    const pairs=policy.pairQualifiedBackups([{cleanerId:'w1',special:false},{cleanerId:'w2',special:true}],[{cleanerId:'b1',special:true},{cleanerId:'b2',special:false}],(b,w)=>!w.special||b.special);
    assert.equal(pairs.length,2); assert.equal(pairs.find(p=>p.worker.cleanerId==='w2').backup.cleanerId,'b1');
  });
  let full;
  await test('M4 two workers receive two distinct qualified paired backups, pending responses and an incomplete alert',async()=>{
    full=await fixture({size:2,hot:true,laundry:true}); const rows=await current(full.job.id);
    assert.equal(rows.length,4); const backups=rows.filter(o=>o.role==='backup'); assert.equal(new Set(backups.map(o=>o.paired_worker_id)).size,2);
    const laundry=rows.find(o=>o.role==='laundry_lead'); const specialist=backups.find(o=>o.paired_worker_id===laundry.cleaner_id); assert.equal(specialist.cleaner_id,full.members[2].id);
    assert.equal((await svc.readOfferCoverage(full.job.id)).complete,false); assert.ok(alerts.some(a=>a.jobId===full.job.id));
    assert.equal(emails.length,4); assert.ok(channels.every(c=>c.sms===true&&c.url.includes('offerId=')));
  });
  await test('M4 current role/version/owner checks reject forged replies and exact retries create one response event',async()=>{
    const o=(await current(full.job.id))[0];
    for(const patch of [{cleanerId:uuid()},{version:o.version+100},{scheduleVersion:99},{role:o.role==='backup'?'primary':'backup'}]) await assert.rejects(()=>reply(o,'accepted',patch));
    await reply(o); await reply(o); await assert.rejects(()=>reply(o,'declined'));
    assert.equal((await pg.query("select count(*)::int n from phase3a_offer_events where offer_id=$1 and kind='accepted'",[o.id])).rows[0].n,1);
  });
  await test('M4 backup confirmation does not accept a working role; only all explicit acceptances yield complete coverage',async()=>{
    for(const o of await current(full.job.id)) if(o.state==='pending') await reply(o);
    assert.equal((await svc.readOfferCoverage(full.job.id)).complete,true);
    const memberships=await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,full.job.id)); assert.equal(memberships.filter(a=>a.role==='backup').length,2);
  });
  await test('M4 lost qualifications and standby conflicts cannot be disguised by old acceptances',async()=>{
    const backups=(await current(full.job.id)).filter(o=>o.role==='backup');
    await db.update(schema.cleaners).set({eligibleForAssignments:false}).where(eq(schema.cleaners.id,backups[0].cleaner_id));
    assert.equal((await svc.readOfferCoverage(full.job.id)).complete,false);
    await db.update(schema.cleaners).set({eligibleForAssignments:true}).where(eq(schema.cleaners.id,backups[0].cleaner_id));
    const second=(await seed()).property; const [job]=await db.insert(schema.jobs).values({propertyId:second.id,calendarEventUid:uuid(),status:'unassigned',checkInTime:full.job.checkInTime,expectedHours:'3'}).returning();
    await assert.rejects(()=>pg.query("select phase3a_assert_candidate($1,$2,null,'primary')",[job.id,backups[0].cleaner_id]));
  });
  await test('M4 reschedule revokes all old versions, preserves money/assignments and requires fresh responses',async()=>{
    const old=await current(full.job.id); const assignments=JSON.stringify(await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,full.job.id)));
    await db.update(schema.jobs).set({checkOutTime:new Date(+full.job.checkOutTime+1800000)}).where(eq(schema.jobs.id,full.job.id));
    const next=await current(full.job.id); assert.equal(next.length,4); assert.ok(next.every(o=>o.state==='pending'&&o.schedule_version===2));
    await assert.rejects(()=>reply(old[0])); assert.equal(JSON.stringify(await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,full.job.id))),assignments);
  });
  await test('M4 pending working offers cannot start work; accepted workers may start despite a standby shortage',async()=>{
    const f=await fixture({backups:0});
    await assert.rejects(()=>db.update(schema.jobs).set({status:'in-progress'}).where(eq(schema.jobs.id,f.job.id)));
    await reply((await current(f.job.id))[0]); await db.update(schema.jobs).set({status:'in-progress'}).where(eq(schema.jobs.id,f.job.id));
    await assert.rejects(()=>svc.offerPairedPromotion(f.job.id,f.cleaner.id,'synthetic-admin'));
    await assert.rejects(()=>db.delete(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id)));
  });
  let promotion;
  await test('M4 promotion retains the old worker until a fresh working acceptance and cannot use the standby reply',async()=>{
    promotion=await fixture(); for(const o of await current(promotion.job.id)) await reply(o);
    const worker=(await current(promotion.job.id)).find(o=>o.role==='primary'); const backup=(await current(promotion.job.id)).find(o=>o.role==='backup');
    const offered=await svc.offerPairedPromotion(promotion.job.id,worker.cleaner_id,'synthetic-admin');
    assert.equal(offered.state,'pending'); await assert.rejects(()=>reply(backup));
    assert.ok((await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,promotion.job.id))).some(a=>a.cleanerId===worker.cleaner_id));
    await assert.rejects(()=>db.update(schema.jobsToCleaners).set({role:'primary'}).where(and(eq(schema.jobsToCleaners.jobId,promotion.job.id),eq(schema.jobsToCleaners.cleanerId,backup.cleaner_id))));
    await reply(offered); await reply(offered);
    const assigned=await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,promotion.job.id)); assert.equal(assigned.length,1); assert.equal(assigned[0].cleanerId,backup.cleaner_id); assert.equal(assigned[0].role,'primary'); assert.equal(assigned[0].urgentBonus,false);
    assert.equal((await svc.readOfferCoverage(promotion.job.id)).complete,false);
  });
  await test('M4 failed cleaner channel still attempts email; dispatch claims and admin alerts do not replay',async()=>{
    failChannel=true; failEmail=true; const before=emails.length; const f=await fixture();
    assert.equal(emails.length-before,2); assert.ok((await current(f.job.id)).every(o=>o.dispatch_state==='failed'));
    const count=channels.length,alertCount=alerts.length; await svc.dispatchJobOffers(f.job.id); assert.equal(channels.length,count); assert.equal(alerts.length,alertCount);
    failChannel=false; failEmail=false;
  });
  await test('M4 V2 acceptance/promotion preserves customer money, freezes replacement pay and retains removed-worker terms without paying standby',async()=>{
    const f=await fixture({residential:true});
    const original=await row(schema.jobsToCleaners,schema.jobsToCleaners.cleanerId,f.cleaner.id); assert.equal(original.frozenHourlyRateCents,1900); assert.ok(original.residentialPayTerms);
    const before=(await row(schema.jobs,schema.jobs.id,f.job.id));
    for(const o of await current(f.job.id)) await reply(o);
    const proposed=await svc.offerPairedPromotion(f.job.id,f.cleaner.id,'synthetic-admin'); await reply(proposed);
    const after=await row(schema.jobs,schema.jobs.id,f.job.id); assert.deepEqual(after.addonsSnapshot,before.addonsSnapshot); assert.equal(after.paymentIntentId,before.paymentIntentId); assert.equal(after.paymentStatus,before.paymentStatus);
    const assignments=await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id)); assert.equal(assignments.length,1); assert.equal(assignments[0].frozenHourlyRateCents,1900); assert.ok(assignments[0].residentialPayTerms);
    const audit=(await pg.query("select assignment_terms from phase3a_offer_events where kind='membership_removed' and assignment_terms->>'cleaner_id'=$1",[f.cleaner.id])).rows;
    assert.ok(audit.some(a=>JSON.stringify(a.assignment_terms.residential_pay_terms)===JSON.stringify(original.residentialPayTerms)));
    assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.job.id))).length,0);
  });
  await test('M4 changed eligibility blocks acceptance and decline remains truthful without reoffering to the same cleaner',async()=>{
    const f=await fixture(); const standby=(await current(f.job.id)).find(o=>o.role==='backup');
    await db.update(schema.cleaners).set({eligibleForAssignments:false}).where(eq(schema.cleaners.id,standby.cleaner_id)); await assert.rejects(()=>reply(standby));
    await reply(standby,'declined'); await db.update(schema.cleaners).set({eligibleForAssignments:true}).where(eq(schema.cleaners.id,standby.cleaner_id)); await svc.repairPairedBackups(f.job.id);
    assert.equal((await current(f.job.id)).filter(o=>o.cleaner_id===standby.cleaner_id).length,1); assert.equal((await svc.readOfferCoverage(f.job.id)).complete,false);
  });
  await test('M4 schedule changes invalidate pending promotions and retain the actual role after an accepted promotion',async()=>{
    const f=await fixture(); for(const o of await current(f.job.id)) await reply(o);
    const stale=await svc.offerPairedPromotion(f.job.id,f.cleaner.id,'synthetic-admin');
    await db.update(schema.jobs).set({checkOutTime:new Date(+f.job.checkOutTime+60000)}).where(eq(schema.jobs.id,f.job.id)); await assert.rejects(()=>reply(stale));
    let rows=await current(f.job.id); assert.equal(rows.filter(o=>o.role==='backup').length,1);
    for(const o of rows) await reply(o);
    const fresh=await svc.offerPairedPromotion(f.job.id,f.cleaner.id,'synthetic-admin'); await reply(fresh);
    await db.update(schema.jobs).set({checkOutTime:new Date(+f.job.checkOutTime+120000)}).where(eq(schema.jobs.id,f.job.id));
    rows=await current(f.job.id); assert.equal(rows.length,1); assert.equal(rows[0].role,'primary'); assert.equal(rows[0].state,'pending'); assert.equal(rows[0].cleaner_id,fresh.cleaner_id); assert.equal(rows[0].replaces_cleaner_id,null);
  });
  await test('M4 event history and offer identity are immutable',async()=>{
    const o=(await current(full.job.id))[0];
    await assert.rejects(()=>pg.query("update phase3a_assignment_offers set role='backup' where id=$1",[o.id]));
    await assert.rejects(()=>pg.query("update phase3a_offer_events set actor_id='forged' where offer_id=$1",[o.id]));
    await assert.rejects(()=>pg.query('delete from phase3a_offer_events where offer_id=$1',[o.id]));
  });
  await test('M4 swap approval waits for working acceptance; revocation blocks the old offer and confirmation closes the linked swap',async()=>{
    for(const revoke of [true,false]) {
      const f=await fixture(); for(const o of await current(f.job.id)) await reply(o);
      const [swap]=await db.insert(schema.swapRequests).values({jobId:f.job.id,originalCleanerId:f.cleaner.id,status:'pending',expiresAt:new Date('2035-01-01T00:00Z')}).returning();
      const offer=await svc.offerPairedPromotion(f.job.id,f.cleaner.id,'synthetic-admin',swap.id);
      if(revoke) {await db.update(schema.swapRequests).set({status:'cancelled'}).where(eq(schema.swapRequests.id,swap.id)); await assert.rejects(()=>reply(offer));}
      else {await reply(offer); assert.equal((await row(schema.swapRequests,schema.swapRequests.id,swap.id)).status,'accepted');}
    }
  });
  await test('M4 declined standby falls back to qualified on-call, then opted-in open pool, with new confirmations',async()=>{
    const f=await fixture({backups:3});
    await db.update(schema.propertyCleaners).set({tier:'on_call'}).where(and(eq(schema.propertyCleaners.propertyId,f.property.id),eq(schema.propertyCleaners.cleanerId,f.members[2].id)));
    await db.delete(schema.propertyCleaners).where(and(eq(schema.propertyCleaners.propertyId,f.property.id),eq(schema.propertyCleaners.cleanerId,f.members[3].id)));
    nearby=[{...f.members[3],hasHotTubCert:false,hasLaundryLeadCert:false,residentialQualified:true,petComfortable:true}];
    const first=(await current(f.job.id)).find(o=>o.role==='backup'); await reply(first,'declined');
    let next=(await current(f.job.id)).find(o=>o.role==='backup'&&o.state==='pending'); assert.equal(next.cleaner_id,f.members[2].id);
    await reply(next,'declined'); next=(await current(f.job.id)).find(o=>o.role==='backup'&&o.state==='pending'); assert.equal(next.cleaner_id,f.members[3].id);
    assert.equal((await svc.readOfferCoverage(f.job.id)).complete,false); nearby=[];
  });
  await test('M4 revoked membership raises a durable coverage alert even when no unsent offer remains',async()=>{
    const f=await fixture(); for(const o of await current(f.job.id)) await reply(o);
    const b=(await current(f.job.id)).find(o=>o.role==='backup'); const n=alerts.length;
    await db.delete(schema.jobsToCleaners).where(and(eq(schema.jobsToCleaners.jobId,f.job.id),eq(schema.jobsToCleaners.cleanerId,b.cleaner_id)));
    await svc.dispatchPendingOffers(); assert.ok(alerts.length>n); await assert.rejects(()=>reply(b));
  });
  await test('M4 cleaner GET is scoped/read-only and POST rejects malformed or stale identities; admin endpoint refuses cleaner access',async()=>{
    const f=await fixture(); let cid=f.cleaner.id,admin=false;
    replace('lib/cleaner-auth.ts',{getCleanerAuth:async()=>({cleanerId:cid}),cleanerAuthErrorStatus:()=>401,requireCleanerJobAssignment:async(c,j)=>({error:(await db.query.jobsToCleaners.findFirst({where:and(eq(schema.jobsToCleaners.jobId,j),eq(schema.jobsToCleaners.cleanerId,c))}))?null:'forbidden'})});
    replace('lib/admin-auth.ts',{getAdminAuth:async()=>({isAdmin:admin,actorId:'synthetic-admin'})});
    const route=require(path.join(root,'app/api/cleaner/jobs/[id]/offers/route.ts')), ar=require(path.join(root,'app/api/admin/jobs/[id]/offers/route.ts')),params={params:Promise.resolve({id:f.job.id})};
    const before=JSON.stringify(await offers(f.job.id)); const get=await route.GET(new Request('https://synthetic.invalid/?action=accept'),params); assert.equal(get.status,200); assert.match(get.headers.get('cache-control'),/no-store/); assert.equal((await get.json()).offers.length,1); assert.equal(JSON.stringify(await offers(f.job.id)),before);
    cid=uuid(); assert.equal((await route.GET(new Request('https://synthetic.invalid'),params)).status,403); cid=f.cleaner.id;
    assert.equal((await ar.GET(new Request('https://synthetic.invalid'),params)).status,401);
    const o=(await current(f.job.id)).find(o=>o.cleaner_id===cid); const body={offerId:o.id,version:o.version,scheduleVersion:o.schedule_version,role:o.role,response:'accepted'};
    const post=body=>route.POST(new Request('https://synthetic.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),params);
    assert.equal((await post({...body,version:99999})).status,409); assert.equal((await post({...body,cleanerId:uuid()})).status,400); assert.equal((await post(body)).status,200);
    admin=true; assert.equal((await ar.GET(new Request('https://synthetic.invalid'),params)).status,200);
  });
  await test('M4 gate defaults preserve legacy jobs and do not enroll new assignments without rollout authorization',async()=>{
    delete process.env.ASSIGNMENT_OFFERS_ENROLLMENT; const f=await fixture(); assert.equal(await svc.isOfferJob(f.job.id),false); assert.equal(await svc.readOfferCoverage(f.job.id),null);
    delete process.env.ASSIGNMENT_OFFERS_SCHEMA_READY;
  });
  if(process.argv.includes('--assignment-lifecycle')) await require('./test-assignment-lifecycle.cjs').verify({ ...ctx, fixture, offers, current, reply, channels, emails, alerts, svc, setFailures: (channel,email) => {failChannel=channel;failEmail=email;} });
  if(process.argv.includes('--property-priority')) await require('./test-property-priority.cjs').verify({ ...ctx, fixture, offers, current, reply, channels, emails, alerts, svc, engine, setFailures: (channel,email) => {failChannel=channel;failEmail=email;} });
  if(process.argv.includes('--assignment-completion')) await require('./test-assignment-completion.cjs').verify({ ...ctx, fixture, offers, current, reply, channels, emails, alerts, svc, engine, setFailures: (channel,email) => {failChannel=channel;failEmail=email;} });
};
if(require.main===module) {
  const result=require('node:child_process').spawnSync(process.execPath,['--require',__filename,path.join(__dirname,'test-job-execution.cjs'),'--with-schedule-upgrade','--phase2c','--assignment-offers'],{stdio:'inherit',env:process.env,windowsHide:true}); process.exitCode=result.status??1;
}
