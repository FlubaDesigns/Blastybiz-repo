'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const {database,admin:baseAdmin}=require('./lib/test-firestore.cjs');
const recovery=require('./repair-backup-recovery.cjs');
const admin={...baseAdmin,firestore:{...baseAdmin.firestore,Timestamp:{fromMillis:stamp=>({stamp})}}};
const quiet={log(){},error(){},warn(){}};
const wrap=(...a)=>a.at(-1),wrappers={onRequest:wrap,onSchedule:wrap,onDocumentCreated:wrap,onDocumentUpdated:wrap,withAuth:f=>f};
const response=()=>({code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
function load(name,shared){const file=path.resolve('functions/modules/'+name+'.js'),req=createRequire(file),exports={};const c={exports,module:{exports},require:p=>p==='../lib/shared'?shared:req(p),console:quiet,process:{env:{}},Date,Intl,URL,URLSearchParams,Buffer,AbortSignal,setTimeout};vm.runInNewContext(fs.readFileSync(file,'utf8'),c,{filename:file});return c;}
const B='users/u/businesses/b';
async function activity(){
 const source=fs.readFileSync('functions/lib/shared.js','utf8'),code=source.slice(source.indexOf('async function touchLastActive'),source.indexOf('// Best available evidence'));
 function fixture(seed,between){
  const m=database(seed);let transactions=0;
  m.db.getAll=async(...refs)=>{const s=await Promise.all(refs.map(r=>r.get()));if(between)await between(m);return s;};
  const original=m.db.runTransaction;m.db.runTransaction=fn=>{transactions++;return original(fn);};
  const c={db:m.db,admin,Date,_LAST_ACTIVE_THROTTLE_MS:6*3600000};vm.runInNewContext(code,c);
  return {m,run:()=>c.touchLastActive('u'),transactions:()=>transactions};
 }
 await test('recent activity checks journal without opening a transaction',async()=>{const f=fixture({'users/u':{lastActiveAt:{stamp:Date.now()}}});await f.run();assert.equal(f.transactions(),0);assert.equal(f.m.writes.length,0);});
 await test('existing deletion journal blocks throttled request',async()=>{const f=fixture({'users/u':{lastActiveAt:{stamp:Date.now()}},'accountDeletions/u':{status:'retry_required'}});await assert.rejects(f.run,e=>e.httpStatus===409&&e.code==='ACCOUNT_DELETION_PENDING');assert.equal(f.transactions(),0);});
 await test('deletion claim between read and write is rechecked in transaction',async()=>{const f=fixture({'users/u':{lastActiveAt:{stamp:1}}},m=>m.db.doc('accountDeletions/u').set({status:'running'}));await assert.rejects(f.run,/Deletion in progress/);assert.equal(f.m.get('users/u').lastActiveAt.stamp,1);});
 await test('pending purge forces serialized activity even inside throttle window',async()=>{const f=fixture({'users/u':{lastActiveAt:{stamp:Date.now()},dormancyPurgeAt:{stamp:1},dormancyWarnedAt:{stamp:1}}});await f.run();assert.equal(f.transactions(),1);assert.equal(f.m.get('users/u').dormancyPurgeAt,undefined);});
 await test('missing user is not recreated',async()=>{const f=fixture({});await f.run();assert.equal(f.transactions(),0);assert.equal(f.m.get('users/u'),undefined);});
 await test('new concurrent activity avoids redundant write',async()=>{const f=fixture({'users/u':{lastActiveAt:{stamp:1}}},m=>m.db.doc('users/u').update({lastActiveAt:{stamp:Date.now()}}));await f.run();assert.equal(f.m.writes.length,1);});
 await test('missing email credential is definitely not sent',async()=>{let called=false;const c={process:{env:{}},fetch:()=>{called=true;},console:quiet};vm.runInNewContext(source.slice(source.indexOf('async function sendResendEmail'),source.indexOf('// ── Lazy-init Square')),c);await assert.rejects(()=>c.sendResendEmail({strict:true}),e=>e.providerRejected===true);assert.equal(called,false);});
}
async function payments(){
 function fixture(status='ACTIVE',sub={}){
  const m=database({'subscriptions/u':{squareSubscriptionId:'sub',status},'settings/pricing':{squareProMonthlyPlanId:'plan'}});let links=0;
  const square={subscriptions:{get:async()=>({subscription:{id:'sub',status,chargedThroughDate:'2020-01-01',...sub}})},checkout:{paymentLinks:{create:async()=>{links++;return {paymentLink:{url:'https://example.invalid'}};}}}};
  const c=load('payments',{...wrappers,db:m.db,admin,checkUidRateLimit:async()=>true,getSquare:()=>square,APP_BASE_URL:'https://example.invalid'});
  return {c,square,links:()=>links,run:async()=>{const r=response();await c.exports.createCheckoutSession({body:{plan:'pro'}},r,{uid:'u'});return r;}};
 }
 await test('active subscription receives support guidance with no new checkout',async()=>{const f=fixture();const r=await f.run();assert.equal(r.code,409);assert.equal(r.body.code,'EXISTING_SUBSCRIPTION');assert.match(r.body.error,/support@blastybiz.com/);assert.equal(f.links(),0);});
 for(const status of ['CANCELED','DEACTIVATED'])await test(status+' allows checkout after confirmed paid period',async()=>{const f=fixture(status);assert.equal((await f.run()).code,200);assert.equal(f.links(),1);});
 await test('terminal subscription with future paid period remains blocked',async()=>{const f=fixture('CANCELED',{chargedThroughDate:'2099-01-01'});assert.equal((await f.run()).code,409);assert.equal(f.links(),0);});
 await test('missing paid-through date fails closed',async()=>{const f=fixture('CANCELED',{chargedThroughDate:undefined});assert.equal((await f.run()).code,409);});
 await test('Square lookup failure fails closed',async()=>{const f=fixture('CANCELED');f.square.subscriptions.get=async()=>{throw Error('offline');};assert.equal((await f.run()).code,503);assert.equal(f.links(),0);});
 await test('wrong subscription identity cannot authorize checkout',async()=>{const f=fixture('CANCELED',{id:'other'});assert.equal((await f.run()).code,409);});
 await test('paid-through comparison respects subscription timezone',async()=>{const f=fixture();assert.equal(f.c.paidPeriodEnded({status:'CANCELED',chargedThroughDate:'2026-09-29',timezone:'America/Los_Angeles'},new Date('2026-09-30T02:00:00Z')),false);assert.equal(f.c.paidPeriodEnded({status:'CANCELED',chargedThroughDate:'2026-09-29',timezone:'America/Los_Angeles'},new Date('2026-09-30T08:00:00Z')),true);});
}
async function imports(){
 function fixture(seed={},allowed=true){const m=database({'users/u':{},[B]:{},...seed}),calls=[];const c=load('publishing',{...wrappers,db:m.db,admin,userBizRef:(u,b)=>m.db.doc(`users/${u}/businesses/${b}`),checkUidRateLimit:async(...a)=>{calls.push(a);return allowed;}});return {m,c,calls,run:async()=>{const r=response();await c.exports.importGooglePhotos({body:{bizId:'b'}},r,{uid:'u'});return r;}};}
 for(const status of ['queued','running'])await test('manual import reuses '+status+' job including OAuth-created jobs',async()=>{const f=fixture({'importJobs/google-choice':{uid:'u',bizId:'b',status,queuedAt:{stamp:Date.now()}}});assert.equal((await f.run()).body.jobId,'google-choice');assert.deepEqual(f.calls[0],['photoImportRateLimit','u',5,3600000]);});
 for(const data of [{status:'completed',stamp:Date.now()},{status:'queued',stamp:Date.now()-16*60000}])await test('finished/expired import permits a new job',async()=>{const f=fixture({'importJobs/old':{uid:'u',bizId:'b',status:data.status,queuedAt:{stamp:data.stamp}}});assert.notEqual((await f.run()).body.jobId,'old');});
 await test('parallel requests share one durable job',async()=>{const f=fixture();const [a,b]=await Promise.all([f.run(),f.run()]);assert.equal(a.body.jobId,b.body.jobId);assert.equal(Object.keys(f.m.all()).filter(p=>p.startsWith('importJobs/')).length,1);});
 await test('rate limit rejection queues nothing',async()=>{const f=fixture({},false);assert.equal((await f.run()).code,429);assert.equal(Object.keys(f.m.all()).filter(p=>p.startsWith('importJobs/')).length,0);});
 await test('deletion claim blocks job creation inside transaction',async()=>{const f=fixture({'accountDeletions/u':{status:'running'}});await assert.rejects(f.run,/unavailable/);assert.equal(Object.keys(f.m.all()).filter(p=>p.startsWith('importJobs/')).length,0);});
}
async function restores(){
 const counts={users:18,businesses:10,listingDrafts:42,publishJobs:35};
 const requestFor=values=>async(url,method,body)=>url.includes('runAggregationQuery')?[{result:{aggregateFields:{total:{integerValue:String(values[body.structuredAggregationQuery.structuredQuery.from[0].collectionId])}}}}]:{fields:{value:{stringValue:'stable'}}};
 const baseline=await recovery.captureRestoreBaseline(requestFor(counts),'source');
 await test('restore compares all four pre-export collection counts',async()=>{const r=await recovery.verifyRestore(requestFor(counts),baseline,'restore');assert.deepEqual(Object.keys(r),Object.keys(counts));});
 for(const group of ['businesses','listingDrafts','publishJobs'])await test('missing '+group+' causes restore failure',async()=>{await assert.rejects(()=>recovery.verifyRestore(requestFor({...counts,[group]:0}),baseline,'restore'),new RegExp(group));});
 await test('small collections require exact counts',async()=>{await assert.rejects(()=>recovery.verifyRestore(requestFor({...counts,publishJobs:34}),baseline,'restore'),/publishJobs/);});
 await test('large group drift capped at two documents',async()=>{const b=await recovery.captureRestoreBaseline(requestFor({...counts,publishJobs:500}),'source');await recovery.verifyRestore(requestFor({...counts,publishJobs:498}),b,'restore');await assert.rejects(()=>recovery.verifyRestore(requestFor({...counts,publishJobs:497}),b,'restore'),/publishJobs/);});
 const now=Date.parse('2026-09-30T12:00:00Z'),old='2026-09-20T12:00:00Z',fresh='2026-09-29T12:00:00Z';
 const db=(id,date=old,extra={})=>({name:'projects/blastybiz-9523e/databases/'+id,uid:id,createTime:date,type:'FIRESTORE_NATIVE',deleteProtectionState:'DELETE_PROTECTION_DISABLED',...extra});
 await test('expiry cleanup selects only old unprotected restore-run databases',async()=>{const items=[db('bb-restore-check-1'),db('bb-restore-check-2',fresh),db('bb-restore-check-3'),db('(default)'),db('customer-data'),db('bb-restore-check-invalid'),db('bb-restore-check-4',old,{deleteProtectionState:'DELETE_PROTECTION_ENABLED'})],removed=[],report={};const req=async(url,method)=>{if(method==='DELETE'){removed.push(url.split('/').at(-1));return {name:'operation'};}return url.endsWith('/databases')?{databases:items}:items.find(x=>url.endsWith('/'+x.uid));};await recovery.cleanupExpiredRestores(req,'bb-restore-check-3',report,()=>{},{now,wait:async()=>{}});assert.deepEqual(removed,['bb-restore-check-1']);assert.equal(report.expiredRestoreCleanup[0].removed,true);});
 await test('incomplete database inventory aborts before deletion',async()=>{await assert.rejects(()=>recovery.cleanupExpiredRestores(async()=>({databases:[],unreachable:['x']}),'bb-restore-check-3',{},()=>{},{now}),/Incomplete/);});
 await test('recreated restore target is never deleted',async()=>{const d=db('bb-restore-check-1');let reads=0;await assert.rejects(()=>recovery.cleanupExpiredRestores(async()=>++reads===1?{databases:[d]}:{...d,uid:'changed'},'bb-restore-check-3',{},()=>{},{now}),/target changed/);});
}
async function ui(){
 await test('Dashboard deletion uses server result and preserves server error',async()=>{
  const src=fs.readFileSync('public/BlastyBiz-Dashboard.html','utf8');const start=src.indexOf('  window.deleteBusiness = async');const code=src.slice(start,src.indexOf('  async function loadBusinessContextFirestore',start));
  const calls=[],toasts=[],window={BUSINESSES:[{id:'b',name:'First'},{id:'c',name:'Second'}],activeBizId:'b'};
  let reject=false;const c={window,currentUser:{getIdToken:async()=>'token'},BUSINESSES:window.BUSINESSES,activeBizId:'b',confirm:()=>true,fetch:async(url,opts)=>{calls.push({url,opts});return {ok:!reject,json:async()=>reject?{error:'You need at least one business.'}:{activeBusiness:'c'}};},renderSwitcherBar(){},renderAgencyBar(){},loadBusinessContextFirestore:async()=>{},showToast:m=>toasts.push(m),console:quiet};vm.runInNewContext(code,c);
  await window.deleteBusiness('b');assert.equal(window.activeBizId,'c');assert.equal(JSON.parse(calls[0].opts.body).bizId,'b');assert.match(calls[0].url,/\/deleteBusiness$/);assert.equal(calls[0].opts.headers.Authorization,'Bearer token');
  reject=true;window.BUSINESSES=[{id:'b',name:'First'},{id:'c',name:'Second'}];await window.deleteBusiness('b');assert.equal(toasts.at(-1),'You need at least one business.');assert.equal(window.BUSINESSES.length,2);
 });
 await test('TestBlasty deletion reloads from the server pointer',async()=>{const src=fs.readFileSync('public/BlastyBiz-TestBlasty.html','utf8'),start=src.indexOf('    window._tcDeleteBiz = async'),code=src.slice(start,src.indexOf('    window._tcLoadBizList();',start));let loaded=0;const c={window:{_tcLoadBizList:async()=>loaded++},user:{getIdToken:async()=>'token'},activeBizId:'b',confirm:()=>true,fetch:async()=>({ok:true,json:async()=>({activeBusiness:'c'})}),alert:()=>{throw Error('unexpected alert');}};vm.runInNewContext(code,c);await c.window._tcDeleteBiz('b',{disabled:false,textContent:'Delete'});assert.equal(c.activeBizId,'c');assert.equal(loaded,1);});
}
(async()=>{for(const suite of [activity,payments,imports,restores,ui,require('./test-story-extraction.cjs')])await suite();console.log(checks+' backend review scenarios passed; no live provider or customer mutations.');})().catch(e=>{console.error(e);process.exitCode=1;});
