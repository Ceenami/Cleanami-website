// Actual SQL/execution services on synthetic in-memory PostgreSQL. No hosted I/O.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
exports.verify = async ctx => {
  const { db, pg, schema, seed, row, test, replace, root, uuid, contracts, service, jpeg, media, reserveInput } = ctx;
  const { eq } = require('drizzle-orm');
  const gate = require('../lib/services/before-requirements.service.ts');
  const termService = require('../lib/services/subscription-term.service.ts');
  const { toEasternDateString } = require('../lib/time/eastern.ts');
  await test('required-work migrations apply privately and reapply without enrolling historical contracts', async()=>{
    await pg.exec('DROP TABLE job_before_requirements,subscription_term_contracts');
    for(const filename of ['0062_phase3a_before_evidence_infrastructure.sql','0064_required_before_evidence.sql','0065_subscription_term_end_contracts.sql']) {
      const sql=fs.readFileSync(path.join(root,'db/supabase/migrations',filename),'utf8');await pg.exec(sql);await pg.exec(sql);
    }
    for(const table of ['job_before_requirements','subscription_term_contracts']) {
      assert.equal((await pg.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
      assert.equal((await pg.query(`select relrowsecurity from pg_class where oid='${table}'::regclass`)).rows[0].relrowsecurity,true);
      for(const role of ['anon','authenticated']) assert.equal((await pg.query(`select has_table_privilege('${role}','${table}','SELECT,INSERT,UPDATE,DELETE') v`)).rows[0].v,false);
    }
  });
  Object.assign(process.env,{BEFORE_REQUIRED_SCHEMA_READY:'true',BEFORE_REQUIRED_ENROLLMENT:'true',BEFORE_EVIDENCE_SCHEMA_READY:'true',BEFORE_EVIDENCE_ENROLLMENT:'true'});
  async function fixture() {
    const f=await seed();await db.update(schema.properties).set({bedCount:2,bathCount:'1',hasHotTub:true,laundryType:'off_site'}).where(eq(schema.properties.id,f.property.id));
    const [job]=await contracts.insertIssuedJobs(db,[{propertyId:f.property.id,calendarEventUid:uuid(),status:'assigned',jobSource:'manual',checkInTime:new Date(Date.now()-10000),checkOutTime:new Date(Date.now()+8*3600000),expectedHours:'3',addonsSnapshot:{laundryType:'off_site'}}]);
    await db.insert(schema.jobsToCleaners).values({jobId:job.id,cleanerId:f.cleaner.id,role:'primary'});
    return {...f,job};
  }
  async function upload(f, room, phase='before') {
    const input={...reserveInput(room),source:'gallery',capturedAt:null,phase};const reserved=await service.reserveExecutionUpload(f.job.id,f.cleaner.id,input);
    media.set(reserved.path,jpeg);await service.acknowledgeExecutionUpload(f.job.id,f.cleaner.id,input.uploadId);return input;
  }
  const current=await fixture();let beforePhotos=[];
  await test('Before room counts are frozen from issued property scope with laundry receipts excluded and exteriors optional',async()=>{
    const requirement=await gate.readBeforeRequirements(current.job.id),contract=await contracts.getExecutionContract(current.job.id);
    assert.deepEqual(requirement.rooms,contract.rooms.filter(room=>room.roomKey!=='laundry'));
    assert.equal(requirement.rooms.filter(room=>room.roomKey.startsWith('bedroom')).length,2);
    assert.equal(requirement.rooms.find(room=>room.roomKey==='bathroom-1').minPhotos,2);
    assert.equal(requirement.rooms.find(room=>room.roomKey==='hot-tub').minPhotos,2);
    assert.equal(requirement.rooms.find(room=>room.roomKey==='front-exterior').minPhotos,0);
    await db.update(schema.properties).set({bedCount:4}).where(eq(schema.properties.id,current.property.id));
    assert.deepEqual((await gate.readBeforeRequirements(current.job.id)).rooms,requirement.rooms);
    await assert.rejects(()=>db.update(schema.beforeRequirements).set({rooms:[]}).where(eq(schema.beforeRequirements.jobId,current.job.id)));
  });
  await test('GPS arrival is distinct from cleaning start; missing Before and early After evidence cannot bypass the gate',async()=>{
    await assert.rejects(()=>service.startExecutionCleaning(current.job.id,current.cleaner.id));
    await service.recordExecutionVisit(current.job.id,current.cleaner.id,'arrival',null,'Synthetic location override for isolated test');
    const packet=await row(schema.evidencePackets,schema.evidencePackets.jobId,current.job.id);
    assert.ok(packet.gpsCheckInTimestamp);assert.equal((await gate.readBeforeRequirements(current.job.id)).startedAt,null);
    await assert.rejects(()=>service.startExecutionCleaning(current.job.id,current.cleaner.id),/Before/);
    await assert.rejects(()=>db.update(schema.evidencePackets).set({finalEvidenceSubmittedAt:new Date(),status:'complete',isChecklistComplete:true}).where(eq(schema.evidencePackets.jobId,current.job.id)));
    await assert.rejects(()=>upload(current,'living','after'),/Start cleaning/);
    await assert.rejects(()=>upload(current,'laundry','before'),/arrival-evidence room/);
  });
  await test('verified property Before minimums permit idempotent start without changing arrival, money, payout or reliability',async()=>{
    const before=JSON.stringify({packet:(await row(schema.evidencePackets,schema.evidencePackets.jobId,current.job.id)).gpsCheckInTimestamp,
      events:(await pg.query('select * from reliability_events order by id')).rows,payouts:(await pg.query('select * from payouts order by id')).rows,
      payment:(await row(schema.jobs,schema.jobs.id,current.job.id)).paymentIntentId});
    for(const room of (await gate.readBeforeRequirements(current.job.id)).rooms)for(let i=0;i<room.minPhotos;i++)beforePhotos.push(await upload(current,room.roomKey));
    const pending={...reserveInput('living'),source:'gallery',capturedAt:null,phase:'before'};
    await service.reserveExecutionUpload(current.job.id,current.cleaner.id,pending);
    await assert.rejects(()=>service.startExecutionCleaning(current.job.id,current.cleaner.id),/pending uploads/);
    await service.removeExecutionUpload(current.job.id,current.cleaner.id,pending.uploadId);
    const started=await service.startExecutionCleaning(current.job.id,current.cleaner.id);
    assert.equal((await service.startExecutionCleaning(current.job.id,current.cleaner.id)).startedAt,started.startedAt);
    assert.equal((await gate.readBeforeRequirements(current.job.id)).evidence.length,beforePhotos.length);
    assert.equal(JSON.stringify({packet:(await row(schema.evidencePackets,schema.evidencePackets.jobId,current.job.id)).gpsCheckInTimestamp,
      events:(await pg.query('select * from reliability_events order by id')).rows,payouts:(await pg.query('select * from payouts order by id')).rows,
      payment:(await row(schema.jobs,schema.jobs.id,current.job.id)).paymentIntentId}),before);
  });
  await test('start locks Before evidence in API and SQL; retry of verified bytes still works and After remains separate',async()=>{
    await assert.rejects(()=>service.removeExecutionUpload(current.job.id,current.cleaner.id,beforePhotos[0].uploadId),/cannot be removed/);
    await assert.rejects(()=>upload(current,'living','before'),/locked/);
    await assert.rejects(()=>db.update(schema.evidenceUploadManifest).set({state:'removed'}).where(eq(schema.evidenceUploadManifest.uploadId,beforePhotos[0].uploadId)));
    await service.acknowledgeExecutionUpload(current.job.id,current.cleaner.id,beforePhotos[0].uploadId);
    await upload(current,'living','after');
    const form=await service.getExecutionEvidence(current.job.id,current.cleaner.id);assert.equal(form.roomPhotos.living.length,1);
    assert.equal(form.beforeRequirements.startedAt,(await gate.readBeforeRequirements(current.job.id)).startedAt.toISOString());
  });
  await test('reasoned admin exception is authorized, immutable, and cannot invent visit/completion or waive After requirements',async()=>{
    const f=await fixture();let isAdmin=false;
    replace('lib/admin-auth.ts',{getAdminAuth:async()=>({isAdmin,actorId:isAdmin?'synthetic-admin':undefined})});
    const route=require('../app/api/admin/jobs/[id]/before-evidence/route.ts');
    const request=reason=>new Request('https://app.example.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})});
    assert.equal((await route.POST(request('A legitimate synthetic exception'),{params:Promise.resolve({id:f.job.id})})).status,401);
    isAdmin=true;
    assert.equal((await route.POST(request('short'),{params:Promise.resolve({id:f.job.id})})).status,400);
    assert.equal((await route.POST(request('A legitimate synthetic exception'),{params:Promise.resolve({id:f.job.id})})).status,200);
    assert.equal((await gate.readBeforeRequirements(f.job.id)).startedAt,null);
    assert.equal(await row(schema.evidencePackets,schema.evidencePackets.jobId,f.job.id),undefined);
    await assert.rejects(()=>service.startExecutionCleaning(f.job.id,f.cleaner.id));
    await service.recordExecutionVisit(f.job.id,f.cleaner.id,'arrival',null,'Synthetic location override');
    await service.startExecutionCleaning(f.job.id,f.cleaner.id);await service.recordExecutionVisit(f.job.id,f.cleaner.id,'departure',null);
    const contract=await contracts.getExecutionContract(f.job.id);
    await assert.rejects(()=>service.saveExecutionDraft(f.job.id,f.cleaner.id,{revision:0,items:contract.checklist.map(item=>({id:item.id,completed:true})),notes:''},true),/room-photo/);
  });
  await test('new required enrollment can stop without dropping existing gates or blocking physical departure',async()=>{
    delete process.env.BEFORE_REQUIRED_ENROLLMENT;delete process.env.BEFORE_EVIDENCE_ENROLLMENT;
    const f=await seed(),[job]=await contracts.insertIssuedJobs(db,[{propertyId:f.property.id,calendarEventUid:uuid(),status:'assigned',jobSource:'manual',checkInTime:new Date(Date.now()-1000),checkOutTime:new Date(Date.now()+8*3600000),expectedHours:'3'}]);
    assert.equal(await gate.readBeforeRequirements(job.id),null);assert.ok(await gate.readBeforeRequirements(current.job.id));
    await service.recordExecutionVisit(current.job.id,current.cleaner.id,'departure',null);
    assert.ok((await row(schema.evidencePackets,schema.evidencePackets.jobId,current.job.id)).gpsCheckOutTimestamp);
  });
  await test('recorded term permits its last Eastern day, refuses new outside-term jobs and preserves legacy creation',async()=>{
    process.env.SUBSCRIPTION_TERM_SCHEMA_READY='true';const f=await seed(),today=toEasternDateString(new Date());
    const [sub]=await db.insert(schema.subscriptions).values({customerId:f.property.customerId,propertyId:f.property.id,durationMonths:1,status:'active',startDate:today,endDate:today,firstCleanPaymentId:'pi_'+uuid()}).returning();
    await termService.recordSubscriptionTerm(db,sub,termService.STOP_AT_TERM_END);
    assert.equal(termService.withinRecordedTerm({startDate:today,endDate:today},new Date(`${today}T16:00Z`)),true);
    const values={subscriptionId:sub.id,propertyId:f.property.id,status:'unassigned',calendarEventUid:uuid(),checkInTime:new Date(`${today}T16:00Z`),checkOutTime:new Date(`${today}T22:00Z`)};
    await db.insert(schema.jobs).values(values);
    await assert.rejects(()=>db.insert(schema.jobs).values({...values,calendarEventUid:uuid(),checkInTime:new Date(Date.now()+3*86400000)}));
    await assert.rejects(()=>db.update(schema.subscriptions).set({endDate:'2099-01-01'}).where(eq(schema.subscriptions.id,sub.id)));
    await db.insert(schema.jobs).values({...values,subscriptionId:null,calendarEventUid:uuid(),checkInTime:new Date(Date.now()+3*86400000)});
  });
  await test('term expiry is status-only, idempotent, leaves issued payment/evidence history and blocks paused resume',async()=>{
    const f=await seed(),[sub]=await db.insert(schema.subscriptions).values({customerId:f.property.customerId,propertyId:f.property.id,durationMonths:1,status:'paused',startDate:'2026-01-01',endDate:'2026-02-01',firstCleanPaymentId:'pi_'+uuid()}).returning();
    await termService.recordSubscriptionTerm(db,sub,termService.STOP_AT_TERM_END);
    process.env.SUBSCRIPTION_TERM_WORKER_ENABLED='true';
    const before=JSON.stringify((await pg.query('select * from jobs order by id')).rows);
    assert.ok((await termService.expireRecordedSubscriptionTerms(new Date('2026-02-02T05:00Z'))).expired>=1);
    assert.equal((await row(schema.subscriptions,schema.subscriptions.id,sub.id)).status,'expired');
    assert.equal((await termService.expireRecordedSubscriptionTerms(new Date('2026-02-02T05:00Z'))).expired,0);
    assert.equal(JSON.stringify((await pg.query('select * from jobs order by id')).rows),before);
    await assert.rejects(()=>termService.assertSubscriptionServiceAllowed(sub.id,new Date('2026-01-15T16:00Z')),/outside/);
  });
  await test('recorded term uses inclusive Eastern date boundaries across DST even under a different SQL session timezone',async()=>{
    const f=await seed(),[sub]=await db.insert(schema.subscriptions).values({customerId:f.property.customerId,propertyId:f.property.id,durationMonths:1,status:'active',startDate:'2027-03-01',endDate:'2027-03-14',firstCleanPaymentId:'pi_'+uuid()}).returning();
    await termService.recordSubscriptionTerm(db,sub,termService.STOP_AT_TERM_END);
    assert.equal(termService.withinRecordedTerm(sub,new Date('2027-03-15T03:59:59Z')),true);
    assert.equal(termService.withinRecordedTerm(sub,new Date('2027-03-15T04:00:00Z')),false);
    await pg.exec("SET TIMEZONE='Asia/Kolkata'");
    try {
      await db.insert(schema.jobs).values({subscriptionId:sub.id,propertyId:f.property.id,status:'unassigned',calendarEventUid:uuid(),checkInTime:new Date('2027-03-15T03:59:59Z')});
      await assert.rejects(()=>db.insert(schema.jobs).values({subscriptionId:sub.id,propertyId:f.property.id,status:'unassigned',calendarEventUid:uuid(),checkInTime:new Date('2027-03-15T04:00:00Z')}));
    } finally {await pg.exec("SET TIMEZONE='UTC'");}
  });
  await test('canonical redirects are disabled by default, preserve query, and leave API/provider/auth methods and foreign hosts unchanged',()=>{
    const site=require('../lib/site-origin.ts');delete process.env.CANONICAL_DOMAIN_REDIRECTS_ENABLED;
    assert.equal(site.canonicalPageRedirect('https://cleannami.ceenami.com/pricing?resume=synthetic','GET'),null);
    Object.assign(process.env,{CANONICAL_DOMAIN_REDIRECTS_ENABLED:'true',CANONICAL_SITE_URL:'https://cleannami.com'});
    assert.equal(site.canonicalPageRedirect('https://cleannami.ceenami.com/pricing?resume=synthetic','GET'),'https://cleannami.com/pricing?resume=synthetic');
    for(const path of ['/api/twilio/status','/auth/callback?code=synthetic','/%61pi/jobs','/_next/static/chunk.js'])assert.equal(site.canonicalPageRedirect('https://cleannami.ceenami.com'+path,'GET'),null);
    for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS'])assert.equal(site.canonicalPageRedirect('https://cleannami.ceenami.com/customer',method),null);
    assert.equal(site.canonicalPageRedirect('https://preview.example.invalid/pricing','GET'),null);
    assert.equal(site.siteOrigin('https://attacker.example@cleannami.com'),null);assert.equal(site.siteOrigin('javascript:alert(1)'),null);
    assert.equal(site.siteOrigin('https://cleannami.com/path'),null);assert.equal(site.siteOrigin('http://localhost:3000',true),'http://localhost:3000');
    assert.equal(site.siteOrigin('localhost:3000',true),'http://localhost:3000');
    assert.equal(require('../lib/app-url.ts').getAppBaseUrl(),'https://cleannami.com');
    delete process.env.CANONICAL_DOMAIN_REDIRECTS_ENABLED;
  });
  await test('actual evidence UI gates Start on saved Before photos, omits laundry proof, and locks the arrival stage after start',()=>{
    const Module=require('node:module'),load=Module._load,React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),previous=global.React;
    global.React=React;let index=0;
    const kitchen={roomKey:'kitchen',label:'Kitchen',minPhotos:1};
    const data={protocol:'pre2c-hotfix-v1',queueOwner:'synthetic',jobId:current.job.id,revision:0,arrivalRecorded:true,departureRecorded:false,isSubmitted:false,finalEvidenceSubmittedAt:null,beforeEvidenceAvailable:true,arrivalConditions:{notes:'',revision:0},
      beforeRequirements:{rooms:[{...kitchen,saved:0}],missing:['Kitchen'],pending:false,startedAt:null,exception:false},
      roomRequirements:[kitchen,{roomKey:'laundry',label:'Laundry proof',minPhotos:1}],checklistItems:[],checklistFiles:[],cleanerNotes:'',photos:[]};
    Module._load=function(name,...args){if(name==='react')return {...React,useState:initial=>{const position=index++;return [position===0?data:position===2?'before':initial,()=>{}];}};return load.call(this,name,...args);};
    try {
      delete require.cache[require.resolve('../components/cleaner/ExecutionEvidenceClient.tsx')];
      const Component=require('../components/cleaner/ExecutionEvidenceClient.tsx').ExecutionEvidenceClient;
      let html=renderToStaticMarkup(React.createElement(Component,{jobId:current.job.id}));
      assert.match(html.match(/<button[^>]*>Start cleaning<\/button>/)[0],/\sdisabled=/);assert.ok(!html.includes('Laundry proof'));
      data.beforeRequirements.rooms[0].saved=1;data.beforeRequirements.missing=[];index=0;
      html=renderToStaticMarkup(React.createElement(Component,{jobId:current.job.id}));assert.ok(!/\sdisabled=/.test(html.match(/<button[^>]*>Start cleaning<\/button>/)[0]));
      data.beforeRequirements.startedAt=new Date().toISOString();index=0;
      html=renderToStaticMarkup(React.createElement(Component,{jobId:current.job.id}));assert.ok(!html.includes('>Start cleaning<'));assert.match(html,/Required arrival evidence is saved and locked/);
    } finally {Module._load=load;if(previous===undefined)delete global.React;else global.React=previous;}
  });
};
if(require.main===module){const run=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'test-job-execution.cjs'),'--required-work'],{stdio:'inherit',env:process.env,windowsHide:true});process.exitCode=run.status??1;}
