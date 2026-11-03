// Loaded by the combined actual Drizzle/PGlite suite; providers remain controlled.
const path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs');
exports.verify=async function(ctx){
 const {db,pg,schema,seed,contracts,service,test,replace,jpeg,media,reserveInput,root,uuid}=ctx;
 const {eq}=require('drizzle-orm');
 const {formatInTimeZone}=require('date-fns-tz');
 const pricing=require(path.join(root,'lib/pricing/residential.ts'));
 const pay=require(path.join(root,'lib/pricing/cleaner-pay.ts'));
 const receipt=require(path.join(root,'lib/pricing/residential-v2/contracts.ts'));
 const {createChecklistSnapshot}=require(path.join(root,'lib/cleaner/checklist-snapshot.ts'));
 const capture=require(path.join(root,'lib/services/payment/capture-and-payout.service.ts'));
 const cancellation=require(path.join(root,'lib/services/payment/execution-cancellation.ts'));
 const base={bedrooms:1,bathrooms:1,sqft:750,cleaningLevel:'standard',petsAllowed:false,hotTub:'none',inUnitLaundryLoads:0};
 async function makeV2({delay=0,future=false,urgent=false,old=false}={}){
  const f=await seed(),now=new Date();
  await db.update(schema.cleaners).set({eligibleForAssignments:true,accountStatus:'active',residentialQualified:true,petComfortable:true,hourlyRateCents:9999}).where(eq(schema.cleaners.id,f.cleaner.id));
  await db.update(schema.properties).set({bedCount:1,bathCount:'1',sqFt:750,serviceType:'residential_one_time'}).where(eq(schema.properties.id,f.property.id));
  const start=new Date(+now+(future?3600000:-Math.max(delay,1)*60000)),day=formatInTimeZone(start,'America/New_York','yyyy-MM-dd');
  await db.insert(schema.availabilityDays).values({cleanerId:f.cleaner.id,date:day,isAvailable:true,onCallEligible:false,openPoolEligible:false,actorId:'synthetic'});
  const terms=pricing.buildResidentialV2AnalysisTerms(base);if(old)delete terms.executionPolicy;
  const staffing=pricing.buildResidentialJobStaffing(terms,terms.amountCents);
  const [job]=await contracts.insertIssuedJobs(db,[{propertyId:f.property.id,serviceType:'residential_one_time',jobSource:'manual',calendarEventUid:uuid(),status:'unassigned',checkInTime:start,checkOutTime:new Date(+now+6*3600000),expectedHours:staffing.expectedHours,addonsSnapshot:staffing.addonsSnapshot,
   checklistSnapshot:createChecklistSnapshot({...f.property,bedCount:1,bathCount:'1',serviceType:'residential_one_time',cleaningLevel:'standard',residentialPricing:staffing.addonsSnapshot.residentialPricing},[])}]);
  await db.transaction(async tx=>{await tx.insert(schema.jobsToCleaners).values({jobId:job.id,cleanerId:f.cleaner.id,role:'primary',urgentBonus:urgent});await tx.update(schema.jobs).set({status:'assigned'}).where(eq(schema.jobs.id,job.id));});
  return {...f,job,terms};
 }
 for(const [delay,urgent,expected]of [[0,true,65],[30,false,40],[40,false,35],[50,false,30],[60,true,0]]){
  await test(`V2 actual issued settlement at ${delay} minutes records $${expected} and replays once`,async()=>{
   const f=await makeV2({delay,urgent});
   await service.recordExecutionVisit(f.job.id,f.cleaner.id,'arrival',null);
   await service.recordExecutionVisit(f.job.id,f.cleaner.id,'departure',null);
   const issued=await contracts.getExecutionContract(f.job.id);
   for(const room of issued.rooms)for(let i=0;i<room.minPhotos;i++){
    const input={...reserveInput(room.roomKey),source:'gallery',capturedAt:null};
    const upload=await service.reserveExecutionUpload(f.job.id,f.cleaner.id,input);media.set(upload.path,jpeg);
    await service.acknowledgeExecutionUpload(f.job.id,f.cleaner.id,input.uploadId);
   }
   await service.saveExecutionDraft(f.job.id,f.cleaner.id,{revision:0,items:issued.checklist.map(i=>({id:i.id,completed:true})),notes:'Synthetic V2 acceptance'},true);
   const result=await capture.captureAndCreatePayouts(f.job.id);assert.equal(result.ok,true,JSON.stringify(result));
   const rows=await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.job.id));assert.equal(rows.length,1);assert.equal(Number(rows[0].amount),expected);
   assert.equal(receipt.payReceiptSchema.parse(rows[0].payReceipt).totalCents,expected*100);
   await capture.captureAndCreatePayouts(f.job.id);assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.job.id))).length,1);
  });
 }
 await test('V2 actual late customer cancellation pays frozen minimum plus urgent, survives assignment deletion and replay',async()=>{
  const f=await makeV2({future:true,urgent:true});
  const result=await cancellation.cancelExecutionJob(f.job.id,'customer');assert.equal(result.lateCancel,true);assert.equal(result.cleanerPaid,true);
  const rows=await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.job.id));assert.equal(rows.length,1);assert.equal(Number(rows[0].amount),65);assert.equal(rows[0].payReceipt.settlement,'late_cancellation');assert.equal(rows[0].urgentBonusAmount,'10.00');
  assert.equal((await db.select().from(schema.jobsToCleaners).where(eq(schema.jobsToCleaners.jobId,f.job.id))).length,0);
  await cancellation.cancelExecutionJob(f.job.id,'customer');assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.job.id))).length,1);
  await db.update(schema.payouts).set({status:'released'}).where(eq(schema.payouts.id,rows[0].id));
  await assert.rejects(()=>db.update(schema.payouts).set({amount:'66.00'}).where(eq(schema.payouts.id,rows[0].id)));
 });
 await test('V2 admin cancellation inside 24h does not penalize customer or create cleaner cancellation pay',async()=>{
  const f=await makeV2({future:true,urgent:true});
  const result=await cancellation.cancelExecutionJob(f.job.id,'admin');assert.equal(result.lateCancel,false);assert.equal(result.cleanerPaid,false);
  assert.equal((await db.select().from(schema.payouts).where(eq(schema.payouts.jobId,f.job.id))).length,0);
 });
 await test('V2 SQL guard rejects balanced forged bonus/deduction/policy and preserves old receipt history on reapply',async()=>{
  const f=await makeV2({future:true,urgent:true});
  const assignment=await db.query.jobsToCleaners.findFirst({where:eq(schema.jobsToCleaners.jobId,f.job.id)});
  const p=pay.computeCleanerPay({residentialPricing:f.job.addonsSnapshot.residentialPricing,assignmentTerms:assignment.residentialPayTerms,expectedHours:1.75,hourlyRateCents:9999,role:'primary',urgentBonus:true});
  for(const patch of [{urgentBonusCents:0,totalCents:5500},{executionPolicy:'forged'},{urgentBonusEligible:false,urgentBonusCents:0,totalCents:5500}])
   await assert.rejects(()=>db.insert(schema.payouts).values({jobId:f.job.id,cleanerId:f.cleaner.id,amount:'55.00',urgentBonusAmount:null,status:'pending',payReceipt:{...p.receipt,...patch}}));
  await db.insert(schema.payouts).values({jobId:f.job.id,cleanerId:f.cleaner.id,amount:'65.00',urgentBonusAmount:'10.00',status:'pending',payReceipt:p.receipt});
  const before=JSON.stringify((await pg.query('select to_jsonb(p) as value from payouts p order by id')).rows);
  for(let i=0;i<2;i++)await pg.exec(fs.readFileSync(path.join(root,'db/supabase/migrations/0057_residential_v2_execution_receipts.sql'),'utf8'));
  assert.equal(JSON.stringify((await pg.query('select to_jsonb(p) as value from payouts p order by id')).rows),before);
  const old=await makeV2({future:true,old:true});
  const a=await db.query.jobsToCleaners.findFirst({where:eq(schema.jobsToCleaners.jobId,old.job.id)});
  const oldPay=pay.computeCleanerPay({residentialPricing:old.job.addonsSnapshot.residentialPricing,assignmentTerms:a.residentialPayTerms,expectedHours:1.75,hourlyRateCents:1900,role:'primary'});
  assert.equal(oldPay.receipt.executionPolicy,undefined);
  await db.insert(schema.payouts).values({jobId:old.job.id,cleanerId:old.cleaner.id,amount:'55.00',status:'pending',payReceipt:oldPay.receipt});
 });
};
