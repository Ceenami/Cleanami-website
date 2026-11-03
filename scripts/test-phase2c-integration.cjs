// Full combined PostgreSQL and actual-service regression cases. No hosted I/O.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
exports.verify=async function(ctx){
 const {db,pg,schema,seed,row,contracts,service,test,replace,jpeg,media,reserveInput,root,uuid}=ctx;
 const {eq,and}=require('drizzle-orm');
 const {formatInTimeZone}=require('date-fns-tz');
 const residential=require(path.join(root,'lib/pricing/residential.ts'));
 const {verifySettledPayment}=require(path.join(root,'lib/services/payment/verify-settled-payment.ts'));
 const {effectiveChecklist}=require(path.join(root,'lib/services/effective-checklist.ts'));
 await test('combined 0049-0054 install/reapply without rewriting existing financial/job history',async()=>{
  const history=async()=>JSON.stringify((await pg.query('select to_jsonb(j) as value from jobs j order by id')).rows);
  const before=await history();
  for(let pass=0;pass<2;pass++)for(const file of ['0049_phase2c_operations.sql','0050_phase2c_assignment_guards.sql','0051_residential_v2_terms_receipts.sql','0052_prospective_job_execution.sql','0053_property_schedule_revisions.sql','0054_rental_charge_receipts.sql','0057_residential_v2_execution_receipts.sql'])
   await pg.exec(fs.readFileSync(path.join(root,'db/supabase/migrations',file),'utf8'));
  assert.equal(await history(),before);
 });
 await test('provider truth rejects wrong currency, missing money and full/partial/pending refunds',async()=>{
  const paid={id:'pi_synthetic',status:'succeeded',currency:'usd',amount:13500,amount_received:13500,
   latest_charge:{amount:13500,currency:'usd',amount_refunded:0,refunded:false,paid:true,captured:true}};
  const client={refunds:{list:async()=>({data:[],has_more:false})}};
  await verifySettledPayment(client,paid,13500);
  for(const change of [{currency:'eur'},{amount:10000},{amount_received:0},{status:'requires_capture'},
   {latest_charge:{...paid.latest_charge,amount_refunded:13500,refunded:true}},
   {latest_charge:{...paid.latest_charge,amount_refunded:100}}])
    await assert.rejects(()=>verifySettledPayment(client,{...paid,...change},13500));
  for(const status of ['pending','succeeded','requires_action'])await assert.rejects(()=>verifySettledPayment({refunds:{list:async()=>({data:[{status}],has_more:false})}},paid,13500));
 });
 await test('new residential sale rejects fractional area before a payment can start',async()=>{
  const {evaluateResidentialSale}=require(path.join(root,'lib/pricing/residential-sales.ts'));
  assert.equal(evaluateResidentialSale({cleaningLevel:'standard',bedrooms:1,bathrooms:1,sqft:750.5,petsAllowed:false}).ok,false);
  assert.equal(evaluateResidentialSale({cleaningLevel:'deep',bedrooms:1,bathrooms:1,sqft:750,petsAllowed:false}).ok,true);
 });
 const fixture=await seed();
 await db.update(schema.cleaners).set({eligibleForAssignments:true,accountStatus:'active',residentialQualified:true,petComfortable:true,hourlyRateCents:2150}).where(eq(schema.cleaners.id,fixture.cleaner.id));
 await db.update(schema.properties).set({bedCount:1,bathCount:'1',sqFt:750,serviceType:'residential_one_time'}).where(eq(schema.properties.id,fixture.property.id));
 const quote=residential.evaluateResidentialPrice({cleaningLevel:'standard',bedrooms:1,bathrooms:1,sqft:750,petsAllowed:false});assert.equal(quote.ok,true);
 const staffing=residential.buildResidentialJobStaffing(quote.terms,0,0,quote.terms.amountCents);
 const now=new Date(),day=formatInTimeZone(now,'America/New_York','yyyy-MM-dd');
 await db.insert(schema.availabilityDays).values({cleanerId:fixture.cleaner.id,date:day,isAvailable:true,onCallEligible:false,openPoolEligible:false,actorId:'synthetic'});
 let issued;
 await test('new residential job enrolls with frozen Standard checklist, rooms and person-specific pay',async()=>{
  const {createChecklistSnapshot}=require(path.join(root,'lib/cleaner/checklist-snapshot.ts'));
  [issued]=await contracts.insertIssuedJobs(db,[{propertyId:fixture.property.id,serviceType:'residential_one_time',jobSource:'manual',calendarEventUid:uuid(),status:'unassigned',checkInTime:new Date(+now-60000),checkOutTime:new Date(+now+8*3600000),expectedHours:staffing.expectedHours,addonsSnapshot:staffing.addonsSnapshot,
   checklistSnapshot:createChecklistSnapshot({...fixture.property,bedCount:1,bathCount:'1',serviceType:'residential_one_time',cleaningLevel:'standard',residentialPricing:staffing.addonsSnapshot.residentialPricing},[])}]);
  await db.transaction(async tx=>{await tx.insert(schema.jobsToCleaners).values({jobId:issued.id,cleanerId:fixture.cleaner.id,role:'primary'});await tx.update(schema.jobs).set({status:'assigned'}).where(eq(schema.jobs.id,issued.id));});
  const assigned=await db.query.jobsToCleaners.findFirst({where:eq(schema.jobsToCleaners.jobId,issued.id)});
  assert.equal(assigned.frozenHourlyRateCents,2150);
  const contract=await contracts.getExecutionContract(issued.id);assert.ok(contract.checklist.some(i=>i.id.startsWith('res-')));assert.ok(contract.rooms.some(r=>r.roomKey.includes('bed')));
 });
 await test('issued missing-photo explanation persists but cannot waive final photo minimums',async()=>{
  await service.recordExecutionVisit(issued.id,fixture.cleaner.id,'arrival',null);
  const contract=await contracts.getExecutionContract(issued.id),room=contract.rooms.find(r=>r.minPhotos>0);
  await service.saveExecutionDraft(issued.id,fixture.cleaner.id,{revision:0,items:[],notes:'Synthetic draft',explanations:{[room.roomKey]:'Connection failed; photo retained on device'}});
  const form=await service.getExecutionEvidence(issued.id,fixture.cleaner.id);assert.ok(form.explanations[room.roomKey]);
  await service.recordExecutionVisit(issued.id,fixture.cleaner.id,'departure',null);
  await assert.rejects(()=>service.saveExecutionDraft(issued.id,fixture.cleaner.id,{revision:1,items:contract.checklist.map(i=>({id:i.id,completed:true})),notes:'Synthetic draft',explanations:form.explanations},true));
 });
 await test('issued gallery evidence settles without a nested transaction lock and retains original worker rate',async()=>{
  const contract=await contracts.getExecutionContract(issued.id);
  for(const room of contract.rooms)for(let i=0;i<room.minPhotos;i++){
   const input={...reserveInput(room.roomKey),source:'gallery',capturedAt:null};
   const reservation=await service.reserveExecutionUpload(issued.id,fixture.cleaner.id,input);media.set(reservation.path,jpeg);
   await service.acknowledgeExecutionUpload(issued.id,fixture.cleaner.id,input.uploadId);
  }
  await service.saveExecutionDraft(issued.id,fixture.cleaner.id,{revision:1,items:contract.checklist.map(i=>({id:i.id,completed:true})),notes:'Synthetic draft'},true);
  await db.update(schema.cleaners).set({hourlyRateCents:9999}).where(eq(schema.cleaners.id,fixture.cleaner.id));
  const capture=require(path.join(root,'lib/services/payment/capture-and-payout.service.ts'));
  const result=await capture.captureAndCreatePayouts(issued.id);assert.equal(result.ok,true,JSON.stringify(result));
  const payouts=await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,issued.id));assert.equal(payouts.length,1);
  const expected=require(path.join(root,'lib/pricing/cleaner-pay.ts')).computeCleanerPay({residentialPricing:staffing.addonsSnapshot.residentialPricing,expectedHours:Number(staffing.expectedHours),hourlyRateCents:2150,role:'primary',arrivalDelayMinutes:1});
  assert.equal(Number(payouts[0].amount),expected.total);
  assert.equal((await capture.captureAndCreatePayouts(issued.id)).ok,true);
  assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,issued.id))).length,1);
 });
 const rental=await seed();let revised;
 replace('lib/admin-auth.ts',{getAdminAuth:async()=>({isAdmin:true,actorId:'synthetic-admin',userId:'synthetic-admin'})});
 const route=require(path.join(root,'app/api/admin/jobs/[id]/checklist/reissue/route.ts'));
 await test('audited rental checklist reissue changes effective tasks without rewriting issued originals',async()=>{
  [revised]=await contracts.insertIssuedJobs(db,[{propertyId:rental.property.id,calendarEventUid:uuid(),status:'unassigned',jobSource:'ical',checkInTime:new Date('2030-11-04T15:00Z'),checkOutTime:new Date('2030-11-04T21:00Z'),expectedHours:'3',addonsSnapshot:{laundryType:'none',teamSize:1}}]);
  revised=await row(schema.jobs,schema.jobs.id,revised.id);
  const original=JSON.stringify(await row(schema.jobs,schema.jobs.id,revised.id)),contract=JSON.stringify((await db.select().from(schema.jobExecutionContracts).where(eq(schema.jobExecutionContracts.jobId,revised.id)))[0]);
  const snapshot=await effectiveChecklist(revised.id,revised.checklistSnapshot);
  const response=await route.POST(new Request('http://synthetic.invalid/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedSnapshotHash:crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),expectedPropertyRevision:0,reason:'Apply published company checklist'})}),{params:Promise.resolve({id:revised.id})});
  assert.equal(response.status,200,JSON.stringify(await response.json()));
  assert.equal(JSON.stringify(await row(schema.jobs,schema.jobs.id,revised.id)),original);
  assert.equal(JSON.stringify((await db.select().from(schema.jobExecutionContracts).where(eq(schema.jobExecutionContracts.jobId,revised.id)))[0]),contract);
  const effective=await effectiveChecklist(revised.id,revised.checklistSnapshot),live=await contracts.getExecutionContract(revised.id);
  assert.deepEqual(live.checklist.map(i=>i.id),effective.items.map(i=>i.id));
  const audits=await db.select().from(schema.phase2cAudit).where(and(eq(schema.phase2cAudit.subjectId,revised.id),eq(schema.phase2cAudit.kind,'checklist_reissued')));assert.equal(audits.length,1);
 });
 await test('stale checklist reissue conflicts and preserves the winning revision',async()=>{
  const response=await route.POST(new Request('http://synthetic.invalid/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedSnapshotHash:'0'.repeat(64),expectedPropertyRevision:0,reason:'Stale admin request'})}),{params:Promise.resolve({id:revised.id})});assert.equal(response.status,409);
 });
 await test('legacy multipart gallery upload remains accepted during an active visit without inventing a camera time',async()=>{
  const fixture=await seed(),now=new Date(),day=formatInTimeZone(now,'America/New_York','yyyy-MM-dd');
  await db.update(schema.cleaners).set({eligibleForAssignments:true,accountStatus:'active'}).where(eq(schema.cleaners.id,fixture.cleaner.id));
  await db.insert(schema.availabilityDays).values({cleanerId:fixture.cleaner.id,date:day,isAvailable:true,onCallEligible:false,openPoolEligible:false,actorId:'synthetic'});
  const {createChecklistSnapshot}=require(path.join(root,'lib/cleaner/checklist-snapshot.ts'));
  const [job]=await db.insert(schema.jobs).values({propertyId:fixture.property.id,calendarEventUid:uuid(),status:'unassigned',jobSource:'manual',checkInTime:new Date(+now-60000),checkOutTime:new Date(+now+5*3600000),expectedHours:'3',addonsSnapshot:{laundryType:'none',teamSize:1},checklistSnapshot:createChecklistSnapshot(fixture.property,[])}).returning();
  await db.transaction(async tx=>{await tx.insert(schema.jobsToCleaners).values({jobId:job.id,cleanerId:fixture.cleaner.id,role:'primary'});await tx.update(schema.jobs).set({status:'assigned'}).where(eq(schema.jobs.id,job.id));});
  await require(path.join(root,'lib/services/job-visit.ts')).recordJobArrival({jobId:job.id,cleanerId:fixture.cleaner.id,now:new Date()});
  replace('lib/cleaner-auth.ts',{getCleanerAuth:async()=>({cleanerId:fixture.cleaner.id}),cleanerAuthErrorStatus:()=>401,requireCleanerJobAssignment:async()=>({assignment:{role:'primary'}})});
  const storage={from:()=>({upload:async(p,file)=>{media.set(p,Buffer.from(await file.arrayBuffer()));return {data:{path:p},error:null}},download:async p=>({data:new Blob([media.get(p)]),error:null})})};
  replace('lib/supabase/server.ts',{createAdminClient:()=>({storage}),createClient:async()=>({storage})});
  const handler=require(path.join(root,'app/api/cleaner/jobs/[id]/evidence/upload/route.ts'));
  const body=new FormData();body.append('file',new File([jpeg],'gallery.jpg',{type:'image/jpeg'}));body.append('roomKey','living');
  const response=await handler.POST(new Request('http://synthetic.invalid/api',{method:'POST',body}),{params:Promise.resolve({id:job.id})});
  assert.equal(response.status,200,JSON.stringify(await response.json()));
 });
 await require('./test-residential-v2-services.cjs').verify(ctx);
};
if(require.main===module){const result=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'test-job-execution.cjs'),'--with-schedule-upgrade','--phase2c'],{stdio:'inherit',env:process.env,windowsHide:true});process.exitCode=result.status??1;}
