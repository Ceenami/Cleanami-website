// Actual URL-claim helper; no network, database or provider access.
process.env.TSX_TSCONFIG_PATH=require('node:path').join(__dirname,'../tsconfig.json');
require('tsx/cjs');
const assert=require('node:assert/strict');
const {claimBookingResume}=require('../lib/booking/claim-resume.ts');
function browser(url){const location={href:url},writes=[],state={__NA:true,tree:['preserved'],custom:'preserved'};return{location,writes,history:{state,replaceState(value,title,path){writes.push({value,title,path});location.href=new URL(path,location.href).href;}}};}
(async()=>{
 const b=browser('https://test.example/?resume=one&utm_source=fixture#pricing');let resolveLoad,loads=0,opened=0;
 const load=new Promise(resolve=>{resolveLoad=resolve;});
 const tasks=['header','hero','footer'].map(async()=>{if(!claimBookingResume('one',b.location,b.history))return;loads++;await load;opened++;});
 assert.equal(loads,1,'Only one mounted CTA may start the delayed session load');assert.equal(opened,0);resolveLoad();await Promise.all(tasks);assert.equal(opened,1);assert.equal(b.writes.length,1);assert.equal(b.location.href,'https://test.example/?utm_source=fixture#pricing');assert.equal(b.writes[0].value,b.history.state);
 assert.equal(claimBookingResume('one',b.location,b.history),false,'Effect replay cannot open another modal');assert.equal(b.writes.length,1);
 b.location.href='https://test.example/?resume=two&campaign=next';assert.equal(claimBookingResume('one',b.location,b.history),false);assert.equal(b.writes.length,1);assert.equal(claimBookingResume('two',b.location,b.history),true,'A later valid resume URL can open its booking');assert.equal(b.location.href,'https://test.example/?campaign=next');
 console.log('PASS three simultaneous booking entry points open one delayed resume; effect replay, later resume, query/hash/history preservation');
})().catch(error=>{console.error(error);process.exitCode=1;});
