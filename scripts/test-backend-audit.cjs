'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {database,admin:baseAdmin}=require('./lib/test-firestore.cjs');
const {createAccountDeletion}=require('../functions/lib/account-deletion');
const {waitOperation,runBackup}=require('../functions/lib/firestore-backup');
const admin={...baseAdmin,firestore:{...baseAdmin.firestore,Timestamp:{fromMillis:stamp=>({stamp}),fromDate:d=>({stamp:d.getTime()})}}};
const quiet={log(){},error(){},warn(){}};let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};
async function rejects(fn,re){await assert.rejects(fn,re);checks++;}
const wrap=(...args)=>args.at(-1),wrappers={onRequest:wrap,onSchedule:wrap,onDocumentCreated:wrap,onDocumentUpdated:wrap,withAuth:f=>f};
function load(name,shared,extra={}){const filename=path.resolve('functions/modules/'+name+'.js'),req=createRequire(filename),ex={};const c={module:{exports:ex},exports:ex,require:p=>p==='../lib/shared'?shared:req(p),console:quiet,process:{env:{}},Buffer,Date,URL,URLSearchParams,AbortSignal,setTimeout,clearTimeout,...extra};vm.runInNewContext(fs.readFileSync(filename,'utf8'),c,{filename});return c;}
const response=()=>({code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;},set(){},send(){}});
const B='users/u/businesses/b';
function deletionFixture(failure){
 const now=Date.now(),m=database({'users/u':{plan:'pro'},'subscriptions/u':{squareSubscriptionId:'sub'},[B]:{uid:'u'},[B+'/listingDrafts/d/private/receipt']:{receipt:true},'copyLibrary/c':{uid:'u'},'copyLibrary/other':{uid:'other'},'webhookEvents/keep':{uid:'u'}});
 const events=[];
 m.db.recursiveDelete=async ref=>{events.push('firestore');for(const p of Object.keys(m.all()))if(p===ref.path||p.startsWith(ref.path+'/'))await m.db.doc(p).delete();};
 const a={...admin,storage:()=>({bucket:()=>({deleteFiles:async()=>{events.push('storage');if(failure==='storage')throw Error('offline');}})}),auth:()=>({deleteUser:async()=>{events.push('auth');if(failure==='auth')throw Error('offline');}})};
 const square={subscriptions:{cancel:async()=>{events.push('square');if(failure==='square')throw Error('offline');return {subscription:{status:'ACTIVE',canceledDate:'2026-10-01'}};},get:async()=>({subscription:{status:'ACTIVE'}})}};
 return {m,events,now,purge:createAccountDeletion({db:m.db,admin:a,getSquare:()=>square,revokeConnections:async()=>{},clock:()=>now})};
}
async function deletion(){
 for(const failure of ['square','storage']){const f=deletionFixture(failure);await rejects(()=>f.purge('u'),/incomplete/);ok(!!f.m.get('users/u')&&!!f.m.get('subscriptions/u')&&!f.events.includes('auth'),'failure preserves identity and billing linkage');ok(f.m.get('accountDeletions/u').status==='retry_required','durable retry record');if(failure==='square')ok(!f.events.includes('storage'),'billing failure prevents cleanup');}
 const good=deletionFixture();await good.purge('u');ok(!good.m.get(B+'/listingDrafts/d/private/receipt')&&!good.m.get('copyLibrary/c'),'deep private and top-level owned data removed');ok(!!good.m.get('copyLibrary/other')&&!!good.m.get('webhookEvents/keep'),'other owners and accounting ledger preserved');ok(good.events.indexOf('square')<good.events.indexOf('storage')&&good.events.indexOf('storage')<good.events.indexOf('firestore')&&good.events.indexOf('firestore')<good.events.indexOf('auth'),'failure-safe operation order');ok(good.m.get('accountDeletions/u').status==='completed','completion recorded');const n=good.events.length;await good.purge('u');ok(good.events.length===n,'completed retry does not repeat provider work');
 const auth=deletionFixture('auth');await rejects(()=>auth.purge('u'),/incomplete/);ok(!!auth.m.get('subscriptions/u')&&auth.m.get('accountDeletions/u').subscriptionCancelled,'auth failure keeps cancelled billing receipt for retry');
 const active=deletionFixture();await active.m.db.doc('users/u').set({plan:'starter',lastActiveAt:{stamp:active.now},dormancyWarnedAt:{stamp:1},dormancyPurgeAt:{stamp:1}});const r=await active.purge('u',{retention:{cutoff:active.now-1000,lastActiveAt:1,purgeAt:1}});ok(r.skipped&&!active.events.length&&!active.m.get('accountDeletions/u'),'fresh activity defeats stale retention candidate before any deletion');
 const concurrent=deletionFixture();await concurrent.m.db.doc('accountDeletions/u').set({status:'running',leaseUntil:concurrent.now+60000});await rejects(()=>concurrent.purge('u'),/already running/);ok(!concurrent.events.length,'concurrent deletion cannot race cleanup');
}
async function payments(){
 const original={proMonthly:19,squareProMonthlyPlanId:'old'},m=database({'settings/pricing':original,'subscriptions/u':{squareSubscriptionId:'existing',status:'ACTIVE'}});let mode='throw',links=0,i=0;
 const square={catalog:{object:{upsert:async()=>{if(mode==='throw')throw Error('provider down');return mode==='missing'?{}:{catalogObject:{id:'plan-'+(++i)}};}}},checkout:{paymentLinks:{create:async()=>{links++;return {paymentLink:{url:'https://example.invalid'}};}}}};
 const c=load('payments',{...wrappers,db:m.db,admin,getSquare:()=>square,checkUidRateLimit:async()=>true});
 const req={body:{proMonthly:29,agencyMonthly:129,proAnnual:299,agencyAnnual:1299}};
 for(mode of ['throw','missing']){const r=response();await c.exports.adminUpdatePricing(req,r,{uid:'admin'});ok(r.code===502&&JSON.stringify(m.get('settings/pricing'))===JSON.stringify(original),'failed/incomplete Square response preserves complete pricing set');}
 mode='success';const r=response();await c.exports.adminUpdatePricing(req,r,{uid:'admin'});ok(r.body.ok&&m.get('settings/pricing').proMonthly===29&&m.get('settings/pricing').squareAgencyAnnualPlanId,'all valid plans committed with prices');
 const checkout=response();await c.exports.createCheckoutSession({body:{plan:'pro'}},checkout,{uid:'u'});ok(checkout.code===409&&links===0,'existing subscription cannot start duplicate checkout');
}
async function aiAndEmail(){
 const source=fs.readFileSync('functions/lib/shared.js','utf8');
 const r={db:{collection:()=>({doc:()=>({})}),runTransaction:async()=>{throw Error('offline');}},admin,console:quiet};vm.runInNewContext(source.slice(source.indexOf('async function checkUidRateLimit'),source.indexOf('\nfunction setCors')),r);ok(await r.checkUidRateLimit('limit','u',3,1000)===false,'rate limiter fails closed');
 let aiCalls=0,reservations=0;const ai=load('ai',{...wrappers,db:{collection:()=>({doc:()=>({onSnapshot(){}})})},admin:{...admin,auth:()=>({verifyIdToken:async()=>({uid:'u'})})},setCors(){},callAI:async()=>{aiCalls++;return {text:'{"score":8}',usage:{}};},trackAiUsage:async()=>{},reserveAiAction:async()=>{reservations++;throw Error('LIMIT_REACHED');},AI_DEFAULTS:{}});
 const res=response();await ai.exports.scoreFact({headers:{authorization:'Bearer fixture'},body:{text:'A fact'}},res);ok(reservations===1&&aiCalls===0&&res.body.score===5,'fact scorer preserves useful fallback without bypassing quota');
 let accepted=false,attempts=0;const keys=[],email={process:{env:{RESEND_API_KEY:'fixture'}},console:quiet,fetch:async(url,o)=>{attempts++;keys.push(o.headers['Idempotency-Key']);return {ok:accepted,status:429,text:async()=>''};}};
 vm.runInNewContext(source.slice(source.indexOf('async function sendResendEmail'),source.indexOf('// ── Lazy-init Square')),email);
 const m=database({'users/u':{email:'fixture@example.invalid'},'setupNudges/n':{uid:'u',email:'fixture@example.invalid',sent:false,sendAfter:{stamp:1}}});
 const scheduled=load('scheduled',{...wrappers,db:m.db,admin,sendResendEmail:email.sendResendEmail,makeUnsubSig:()=>'',_unsubSecret:()=>'',APP_BASE_URL:'https://example.invalid'});
 await scheduled.exports.scheduledSetupNudge();ok(attempts===1&&!m.get('setupNudges/n').sent&&m.get('setupNudges/n').deliveryStatus==='rejected','rejected email remains retryable and unsent');accepted=true;await scheduled.exports.scheduledSetupNudge();ok(m.get('setupNudges/n').sent&&keys[0]===keys[1],'successful retry reuses frozen idempotent email');await scheduled.exports.scheduledSetupNudge();ok(attempts===2,'confirmed email is not sent again');
}
async function imports(){
 const m=database({'users/u':{},[B]:{}}),c=load('publishing',{...wrappers,db:m.db,admin,userBizRef:(u,b)=>m.db.doc(`users/${u}/businesses/${b}`)});
 const r1=response(),r2=response();await c.exports.importGooglePhotos({body:{bizId:'b'}},r1,{uid:'u'});await c.exports.importGooglePhotos({body:{bizId:'b'}},r2,{uid:'u'});
 ok(r1.body.jobId!==r2.body.jobId,'re-import creates distinct durable jobs');ok(m.get('importJobs/'+r1.body.jobId).status==='queued'&&m.get('importJobs/'+r2.body.jobId).status==='queued','success response only after queue commit');
 m.failNext();await rejects(()=>c.exports.importGooglePhotos({body:{bizId:'b'}},response(),{uid:'u'}),/offline/);
 const ref=m.db.doc('importJobs/'+r1.body.jobId);await m.db.doc('users/u').update({deletionRequestedAt:{stamp:1}});await c.exports.onGoogleImportQueued({data:await ref.get()});ok(m.get(ref.path).status==='skipped','queued import does not recreate deleted account data');
}
async function photoCounts(){
 const m=database({'users/u':{},[B]:{},[B+'/platformConnections/google']:{status:'connected',accountId:'a',locationId:'l'},'importJobs/photo':{status:'queued'}});
 let saves=0;
 const a={...admin,storage:()=>({bucket:()=>({name:'fixture-bucket',file:()=>({save:async()=>{saves++;},makePublic:async()=>{}})})})};
 const c=load('publishing',{...wrappers,db:m.db,admin:a,crypto:require('node:crypto'),userBizRef:(u,b)=>m.db.doc(`users/${u}/businesses/${b}`),userBizConnsRef:()=>m.db.collection(B+'/platformConnections'),_getConnTokens:async()=>({accessToken:'fixture'}),axios:{get:async url=>{
  if(url.endsWith('/media'))return {data:{mediaItems:['one','duplicate','invalid','failure'].map(googleUrl=>({googleUrl}))}};
  if(url==='failure')throw Error('download failed');return {data:Buffer.from(url==='invalid'?[0,0]:[255,216,255])};
 }}});
 await c._runGooglePhotoImport('u','b',m.db.doc('importJobs/photo'));
 const result=m.get('importJobs/photo');ok(result.status==='partial'&&result.done===4&&result.imported===1&&result.skipped===2&&result.failed===1,'import progress distinguishes imported, skipped and failed items');ok(saves===1,'duplicate bytes are not uploaded twice');
}
async function backups(){
 const {target}=require('./repair-backup-recovery.cjs');
 const env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'123'};
 ok(target(['--project=blastybiz-9523e'],env)==='bb-restore-check-123','restore target is isolated and bound to current run');
 assert.throws(()=>target(['--project=other'],env));checks++;
 assert.throws(()=>target(['--project=blastybiz-9523e'],{...env,GITHUB_REF:'refs/heads/preview'}));checks++;
 let now=0;const opts={sleep:async()=>{now+=1;},clock:()=>now,timeoutMs:10};
 await rejects(()=>waitOperation(async()=>({done:true,error:{code:13}}),{name:'projects/blastybiz-9523e/databases/(default)/operations/x'},opts),/failed/);
 await rejects(()=>waitOperation(async()=>({done:true}),{name:'projects/other/databases/(default)/operations/x'},opts),/target/);
 const m=database();let starts=0;const request=async()=>{starts++;return {name:'projects/blastybiz-9523e/databases/(default)/operations/x'};};
 await rejects(()=>runBackup({db:m.db,admin,request,wait:async()=>{throw Error('export failed');}}),/export failed/);ok(Object.values(m.all())[0].status==='failed','failed backup is recorded and thrown to Scheduler');
 const result=await runBackup({db:m.db,admin,request,wait:async()=>({done:true,response:{outputUriPrefix:'gs://blastybiz-firestore-backups/export'}})});ok(starts===1&&result.status==='completed','retry resumes recorded operation and waits for completion');
}
(async()=>{for(const test of [deletion,payments,aiAndEmail,imports,photoCounts,backups]){await test();console.log('PASS '+test.name);}console.log(checks+' backend audit repair assertions passed; isolated providers, no live side effects.');})().catch(e=>{console.error(e);process.exitCode=1;});
