// Actual pricing/receipt/readers. No env files, network, database or provider calls.
const path=require('node:path'),assert=require('node:assert/strict');
process.env.TSX_TSCONFIG_PATH=path.join(__dirname,'../tsconfig.json');
require('tsx/cjs');
const root=path.resolve(__dirname,'..');
const {buildResidentialV2AnalysisTerms,buildResidentialJobStaffing,evaluateResidentialPrice}=require(path.join(root,'lib/pricing/residential.ts'));
const {computeCleanerPay}=require(path.join(root,'lib/pricing/cleaner-pay.ts'));
const {payReceiptSchema}=require(path.join(root,'lib/pricing/residential-v2/contracts.ts'));
const {buildPayBreakdownFromPayout}=require(path.join(root,'lib/cleaner/pay-breakdown.ts'));
const {calculateV2Contribution}=require(path.join(root,'lib/pricing/residential-v2/contribution.ts'));
const {V2_CONFIG_HASH}=require(path.join(root,'lib/pricing/residential-v2/rules.ts'));
let passed=0;
const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const input={bedrooms:1,bathrooms:1,sqft:750,cleaningLevel:'standard',petsAllowed:false,hotTub:'none',inUnitLaundryLoads:0};
function fixture(patch={}){
 const terms=buildResidentialV2AnalysisTerms({...input,...patch});
 const snapshot=buildResidentialJobStaffing(terms,terms.amountCents);
 const assignment={version:'residential-v2',configHash:V2_CONFIG_HASH,policyRevision:'flat_1900_min_5500',hourlyRateCents:1900,minimumBaseCents:5500,baseHours:terms.expectedHoursPerCleaner,leadHours:terms.model.leadPaidHours,addonLead:terms.model.leadPaidHours>0,hotTub:terms.input.hotTub,inUnitLaundryLoads:terms.input.inUnitLaundryLoads};
 const args={residentialPricing:snapshot.addonsSnapshot.residentialPricing,assignmentTerms:assignment,expectedHours:terms.expectedHoursPerCleaner,hourlyRateCents:9999,role:'primary'};
 return {terms,snapshot,assignment,args};
}
const f=fixture();
test('short-job base minimum and urgent bonus are separate',()=>{
 const p=computeCleanerPay({...f.args,urgentBonus:true});assert.equal(p.total,65);assert.equal(p.basePay,55);assert.equal(p.urgentBonus,10);assert.equal(p.minimumTopUp,21.75);
});
for(const [delay,total]of [[-5,55],[0,55],[29,55],[30,40],[39,40],[40,35],[49,35],[50,30],[59,30],[60,0],[90,0]])test('lateness boundary '+delay,()=>{
 const p=computeCleanerPay({...f.args,arrivalDelayMinutes:delay});assert.equal(p.total,total);assert.equal(payReceiptSchema.parse(p.receipt).totalCents,total*100);
 const d=buildPayBreakdownFromPayout({pricingVersion:'residential-v2',payReceipt:p.receipt,amount:p.total,urgentBonusAmount:0,laundryBonusAmount:0,latePenalty:p.lateDeduction??0});assert.equal(d.total,total);
});
test('urgent bonus remains separate under completed-job penalty',()=>assert.equal(computeCleanerPay({...f.args,urgentBonus:true,arrivalDelayMinutes:30}).total,50));
const lead=fixture({inUnitLaundryLoads:1});
test('removed cleaner earns zero including lead pay and urgent bonus',()=>{
 const p=computeCleanerPay({...lead.args,urgentBonus:true,arrivalDelayMinutes:60});assert.equal(p.total,0);assert.equal(p.leadPay,0);assert.equal(p.urgentBonus,null);assert.equal(p.receipt.settlement,'removed');
});
test('customer late cancellation protects base and earned urgent bonus but not unperformed lead work',()=>{
 const p=computeCleanerPay({...lead.args,urgentBonus:true,settlement:'late_cancellation',arrivalDelayMinutes:50});assert.equal(p.total,65);assert.equal(p.leadPay,0);assert.equal(p.receipt.arrivalDelayMinutes,0);assert.equal(p.receipt.leadHours,0);
});
for(const role of ['backup','on-call'])test('unpaid '+role+' cannot earn minimum or bonus',()=>assert.equal(computeCleanerPay({...f.args,role,assignmentTerms:null,urgentBonus:true}).total,0));
test('historical V2 terms and receipts keep their original policy',()=>{
 const terms={...f.terms};delete terms.executionPolicy;
 const args={...f.args,residentialPricing:buildResidentialJobStaffing(terms,terms.amountCents).addonsSnapshot.residentialPricing};
 const p=computeCleanerPay(args);assert.equal(p.total,55);assert.equal(p.receipt.executionPolicy,undefined);payReceiptSchema.parse(p.receipt);
 for(const patch of [{urgentBonus:true},{arrivalDelayMinutes:30},{settlement:'late_cancellation'}])assert.throws(()=>computeCleanerPay({...args,...patch}),/policy requires approval/);
});
test('legacy and V1 expected pay/bonus history are unchanged',()=>{
 const v1=evaluateResidentialPrice(input);assert.ok(v1.ok);
 for(const residentialPricing of [undefined,buildResidentialJobStaffing(v1.terms,v1.terms.amountCents).addonsSnapshot.residentialPricing]){
  assert.equal(computeCleanerPay({residentialPricing,expectedHours:2,hourlyRateCents:1700,role:'primary',urgentBonus:true}).total,44);
  assert.equal(computeCleanerPay({residentialPricing,expectedHours:2,hourlyRateCents:1700,role:'primary',arrivalDelayMinutes:30}).total,19);
 }
});
test('receipt rejects balanced but unauthorized penalty/bonus/minimum changes',()=>{
 const p=computeCleanerPay({...f.args,arrivalDelayMinutes:30});
 for(const patch of [{lateDeductionCents:0,totalCents:5500},{urgentBonusCents:1000,totalCents:5000},{minimumBaseCents:1},{executionPolicy:'forged'},{arrivalDelayMinutes:0},{settlement:'late_cancellation'}])
  assert.equal(payReceiptSchema.safeParse({...p.receipt,...patch}).success,false);
});
test('actual contribution includes extra urgent cost without changing customer quote',()=>{
 const p=computeCleanerPay({...f.args,urgentBonus:true});
 const contribution=calculateV2Contribution({paymentStatus:'captured',addonsSnapshot:f.snapshot.addonsSnapshot,cleaners:[{cleanerId:'worker',role:'primary',residentialPayTerms:f.assignment,urgentBonus:true}],payouts:[]});
 assert.equal(contribution.laborCents,6500);assert.equal(contribution.revenueCents,f.terms.amountCents);assert.equal(contribution.contribution.floorStatus,'EXCEPTION');
 assert.equal(buildPayBreakdownFromPayout({pricingVersion:'residential-v2',amount:p.total,payReceipt:p.receipt,urgentBonusAmount:10,laundryBonusAmount:0}).urgentBonus,10);
});
console.log(JSON.stringify({passed,boundary:'Actual pure modules and immutable receipts; no hosted I/O'}));
