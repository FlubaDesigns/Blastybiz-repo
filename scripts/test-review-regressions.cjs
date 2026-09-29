'use strict';
// Executes actual changed code with isolated services; no live publishing or customer writes.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
let checks = 0;
function ok(value, message) { assert(value, message); checks++; }
const adminSource = fs.readFileSync('functions/modules/admin.js', 'utf8');
const retrySource = adminSource.slice(adminSource.indexOf('exports.adminRetryJob ='), adminSource.indexOf('// ── adminMarkManualFollowup'));
function retryEnv(data, {failSuccessWrite = false, providerFails = false, manual = false} = {}) {
  let job = {platform:'google', status:'failed', ...data}, calls = 0, writes = [], lock = Promise.resolve();
  const snap = () => ({exists:true, data:()=>({...job})});
  const ref = {get:async()=>snap(), update:async patch => {
    if (failSuccessWrite && patch.status === 'success') throw Error('success write failed');
    writes.push(patch); Object.assign(job, patch);
  }};
  const publish = async()=>{calls++; if(providerFails)throw Error('provider error'); return manual ? {manualFallback:true} : {postId:'one'};};
  const c = {exports:{},console:{error(){}},Date,Set,
    onRequest:(_,fn)=>fn,withAuth:fn=>fn,
    admin:{firestore:{FieldValue:{serverTimestamp:()=>({toMillis:()=>Date.now()})}}},
    JOB_STATUS:{PROCESSING:'processing',FAILED:'failed',MANUAL_REQUIRED:'manual_required',MANUAL_FOLLOWUP:'manual_followup'},
    userBizJobsRef:()=>({doc:()=>ref}),
    userBizConnsRef:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({status:'connected'}),ref:{}})})}),
    _getConnTokens:async()=>({}),_publishGoogleJob:publish,_publishFacebookJob:publish,_publishInstagramJob:publish,
    db:{runTransaction(fn){const run=lock.then(()=>fn({get:async()=>snap(),update:(_,patch)=>{writes.push(patch);Object.assign(job,patch);}}));lock=run.catch(()=>{});return run;}}
  };
  vm.runInNewContext(retrySource + adminSource.slice(adminSource.indexOf('exports.adminMarkManualFollowup ='), adminSource.indexOf('// ── adminListBusinesses')),c);
  return {get job(){return job},get calls(){return calls},writes,async run(extra={},endpoint='adminRetryJob'){
    const res={code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}};
    await c.exports[endpoint]({body:{uid:'u',businessId:'b',jobId:'j',...extra}},res);return res;
  }};
}
async function photos() {
  const html=fs.readFileSync('public/BlastyBiz.html','utf8');
  const code=html.slice(html.indexOf('async function deletePhotoRecords'), html.indexOf('window._bbDeleteGlobalImage'));
  function env({fail=false,featured='photo',active='b'}={}) {
    const writes=[], business={featuredPhoto:featured}, campaign={photos:['photo',{url:'photo'},'keep']};
    const c={db:{},activeBizId:active,currentUser:{uid:'u'},campaigns:[{id:'c',photos:[...campaign.photos]}],window:{_bbFeaturedPhotoUrl:'photo'},
      doc:(_, ...p)=>({path:p.join('/')}),
      runTransaction:async(_,fn)=>{const pending=[];await fn({get:async r=>({exists:()=>true,data:()=>r.path.endsWith('/c')?campaign:business}),update:(r,d)=>pending.push({path:r.path,data:d}),delete:r=>pending.push({path:r.path,deleted:true})});if(fail)throw Error('denied');writes.push(...pending);}
    }; vm.runInNewContext(code,c); return {c,writes};
  }
  let e=env();await e.c.deletePhotoRecords({id:'i',url:'photo',bizId:'b'},'c');
  ok(e.writes.some(w=>w.data?.featuredPhoto===''),'featured record cleared');
  ok(e.c.window._bbFeaturedPhotoUrl==='','featured cache cleared');
  ok(JSON.stringify(e.c.campaigns[0].photos)==='["keep"]','both legacy representations removed');
  ok(e.writes.some(w=>w.deleted&&w.path.endsWith('/images/i')),'image document removed');
  e=env({fail:true});await assert.rejects(e.c.deletePhotoRecords({id:'i',url:'photo'},'c'));
  ok(!e.writes.length&&e.c.window._bbFeaturedPhotoUrl==='photo'&&e.c.campaigns[0].photos.length===3,'failed transaction preserves cached records');
  e=env({featured:'other'});await e.c.deletePhotoRecords({id:'i',url:'photo'},'c');ok(!e.writes.some(w=>w.data?.featuredPhoto===''),'unrelated featured image preserved');
  e=env({active:'new'});await e.c.deletePhotoRecords({id:'i',url:'photo',bizId:'b'},'c');ok(e.writes.every(w=>w.path==='users/u/businesses/b'||w.path.startsWith('users/u/businesses/b/'))&&e.c.campaigns[0].photos.length===3,'captured business used without changing new business cache');
}
function revenue() {
  const html=fs.readFileSync('public/BlastyBiz-Admin-Subscriptions.html','utf8');
  const code=html.slice(html.indexOf('let billingBusinesses'),html.indexOf('onAuthStateChanged(auth'));
  const nodes={},body={}; const c={window:{},document:{getElementById:id=>nodes[id]||(nodes[id]={}),querySelectorAll:()=>[{querySelector:()=>body}]}};
  vm.createContext(c);vm.runInContext(code,c);
  vm.runInContext(`billingBusinesses=[{ownerUid:'a',currentPlan:'Pro',subscriptionStatus:'active'},{ownerUid:'a',currentPlan:'pro',subscriptionStatus:'active'},{ownerUid:'b',currentPlan:'Agency',subscriptionStatus:'active'},{ownerUid:'c',currentPlan:'Pro',subscriptionStatus:'canceled'}];billingPrices={pro:25,agency:80};renderRevenue();`,c);
  ok(nodes['stat-mrr'].textContent==='$105.00','mixed-case plans and repeated owner produce correct estimate');
  vm.runInContext('billingPrices=null;renderRevenue()',c);ok(nodes['stat-mrr'].textContent==='Unavailable','missing prices never become invented revenue');
}
async function dispatcherAndQueue() {
  const source=fs.readFileSync('functions/modules/publishing.js','utf8');
  const dispatch=source.slice(source.indexOf('exports.dispatchPublishJob ='),source.indexOf('exports.jobFailedTrigger ='));
  function env({failWrites=false,providerFails=false}={}) {
    const original={platform:'google',status:'pending',payload:{adaptedContent:'old'}};
    let state={...original,payload:{adaptedContent:'current'}},calls=0,seen;
    const snapshot=()=>({exists:true,data:()=>({...state})});
    const ref={get:async()=>snapshot(),update:async patch=>{if(patch.status==='success'||failWrites)throw Error('database write');Object.assign(state,patch)}};
    const publish=async job=>{calls++;seen=job.payload.adaptedContent;if(providerFails)throw Error('provider rejected');return {postId:'posted'}};
    const c={exports:{},console:{error(){}},onDocumentCreated:(_,fn)=>fn,admin:{firestore:{FieldValue:{serverTimestamp:()=>({toMillis:()=>Date.now()})}}},db:{runTransaction:async fn=>fn({get:async()=>snapshot(),update:(_,patch)=>Object.assign(state,patch)})},userBizConnsRef:()=>({doc:()=>({get:async()=>({exists:true,ref:{},data:()=>({status:'connected'})})})}),_getConnTokens:async()=>({}),_publishGoogleJob:publish,_publishFacebookJob:publish,_publishInstagramJob:publish};
    vm.runInNewContext(dispatch,c);
    return {get state(){return state},get calls(){return calls},get seen(){return seen},run:()=>c.exports.dispatchPublishJob({data:{data:()=>original,ref},params:{userId:'u',bizId:'b',jobId:'j'}})};
  }
  let e=env();await e.run();ok(e.state.status==='manual_required'&&e.state.publicationUncertain,'normal dispatcher preserves accepted publication after write failure');await e.run();ok(e.calls===1,'create-event redelivery does not republish accepted post');ok(e.seen==='current','publisher uses transaction-current payload, not stale event');
  e=env({failWrites:true});await e.run();await e.run();ok(e.state.status==='processing'&&e.calls===1,'total write outage retains claim and prevents automatic duplicate');
  e=env({providerFails:true});await assert.rejects(e.run());ok(e.state.status==='pending'&&e.state.retryCount===1,'existing provider-failure retry remains available');
  const html=fs.readFileSync('public/BlastyBiz-Admin-Queue-Manager.html','utf8');
  const action=html.slice(html.indexOf('async function jobAction('),html.indexOf('window.jobAction ='));
  const writes=[],messages=[];let state={status:'processing',updatedAt:{toMillis:()=>Date.now()}};
  const c={db:{},jobRefMap:{j:{}},jobDataMap:{j:{}},Date,console,serverTimestamp:()=>({server:true}),showQueueMsg:m=>messages.push(m),runTransaction:async(_,fn)=>fn({get:async()=>({exists:()=>true,data:()=>state}),update:(_,patch)=>writes.push(patch)})};
  vm.runInNewContext(action,c);await c.jobAction('j','pause');ok(!writes.length&&messages.length===1,'stale pending row cannot pause a processing claim');await c.jobAction('j','complete');ok(!writes.length,'stale recovery row cannot complete a fresh claim');state={status:'pending'};await c.jobAction('j','pause');ok(writes.at(-1).status==='paused','unclaimed pending job can pause');state={status:'manual_required',publicationUncertain:true};await c.jobAction('j','complete');ok(writes.at(-1).publicationUncertain===false&&writes.at(-1).status==='manual_completed','manual completion clears recovery flag');
}
async function adminViews() {
  function env(page) {
    const html=fs.readFileSync('public/'+page,'utf8');
    const code=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)][0][1].replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g,'');
    const nodes={},stats=Array.from({length:4},()=>({textContent:''})),tables=[{body:{}},{body:{}}],listeners=[];let auth;
    const node=id=>nodes[id]||(nodes[id]={value:id==='log-type'?'All Types':id==='log-level'?'All Levels':'',style:{},textContent:'',innerHTML:'',addEventListener(){}});
    const c={console:{warn(){},error(){}},Date,Map,Set,window:{escHtml:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')},auth:{},db:{},document:{getElementById:node,querySelector:()=>tables[0].body,querySelectorAll:s=>s==='table'?tables.map(t=>({querySelector:()=>t.body})):stats},onAuthStateChanged:(_,fn)=>auth=fn,onSnapshot:(q,fn,error)=>listeners.push({q,fn,error}),collection:(_,path)=>path,collectionGroup:(_,path)=>path,query:(...args)=>args,where:(...args)=>args,orderBy:(...args)=>args,limit:n=>n,doc:(_, ...p)=>p.join('/'),getDoc:async()=>({exists:()=>true,data:()=>({businessName:'Business'})}),Timestamp:{fromDate:d=>d}};
    vm.runInNewContext(code,c);auth(null);ok(!listeners.length,page+' signed out does not subscribe');auth({uid:'u'});
    const snap=items=>({empty:!items.length,docs:items.map((data,i)=>({id:'j'+i,ref:{path:'users/u/businesses/b/publishJobs/j'+i},data:()=>data}))});
    return {c,node,stats,tables,listeners,snap};
  }
  let e=env('BlastyBiz-Admin-Logs.html');e.listeners[0].fn(e.snap([{listingName:'<Business>',action:'manual_copy_paste',note:'Copied',platform:'Google'}]));ok(e.tables[0].body.innerHTML.includes('&lt;Business&gt;')&&e.tables[0].body.innerHTML.includes('Copied'),'logs render escaped real writer fields');e.node('log-type').value='Manual';e.node('log-search').value='absent';e.c.renderLogs();ok(e.tables[0].body.innerHTML.includes('No matching'),'logs combine filters');e.listeners[0].error({message:'<denied>'});e.c.renderLogs();ok(e.tables[0].body.innerHTML.includes('&lt;denied&gt;'),'filter cannot restore stale logs after read error');
  e=env('BlastyBiz-Admin-Users.html');e.listeners[0].fn(e.snap([{businessName:'<Business>',subscriptionStatus:'canceled',onboarded:false}]));ok(e.stats[0].textContent===0&&e.stats[3].textContent===1,'users active count not inflated; explicit incomplete counted');e.listeners[0].error({message:'denied'});ok(e.stats.every(s=>s.textContent==='—'),'users errors clear totals');
  e=env('BlastyBiz-Admin-Subscriptions.html');e.listeners.find(l=>l.q==='settings/pricing').fn({exists:()=>true,data:()=>({proMonthly:25,agencyMonthly:80})});const biz=e.listeners.find(l=>Array.isArray(l.q)&&l.q[0]==='businesses');biz.fn(e.snap([{currentPlan:'pro',subscriptionStatus:'active'}]));ok(e.node('stat-mrr').textContent==='$25.00','subscriptions render source prices through listeners');biz.error({message:'denied'});ok(e.c.window.__latestBusinesses.length===0&&e.node('stat-mrr').textContent==='Unavailable','failed business read clears exports and money');const ai=e.listeners.find(l=>Array.isArray(l.q)&&l.q[0]==='aiUsageLogs');ai.fn(e.snap([{costUsd:0.25},{costUsd:0.1}]));ok(e.node('stat-aispend').textContent==='$0.35','AI spend remains independent of business read');ai.error({});ok(e.node('stat-aispend').textContent==='Unavailable','AI failure is not zero spend');
  e=env('BlastyBiz-Admin-Failed-Jobs.html');ok(e.listeners[0].q.some(a=>Array.isArray(a)&&a[0]==='status'&&a[2].includes('manual_followup')),'follow-up remains in failed-job query');await e.listeners[0].fn(e.snap([{status:'manual_followup',businessId:'b'}]));ok(e.tables[0].body.innerHTML.includes('Mark Complete'),'follow-up renders manual action');e.listeners[0].error({message:'<denied>'});ok(e.tables[0].body.innerHTML.includes('&lt;denied&gt;'),'failed jobs error escaped');await e.listeners[0].fn(e.snap([]));ok(e.tables[0].body.innerHTML.includes('No failed jobs'),'failed jobs recover to empty state');
}
(async()=>{
  let e=retryEnv({planGated:true});ok((await e.run()).code===409&&!e.calls&&!e.writes.length,'plan-gated job cannot publish');
  e=retryEnv({status:'processing',updatedAt:{toMillis:()=>Date.now()}});ok((await e.run({recovery:'not_published'})).code===409&&!e.calls,'active processing cannot be stolen');
  e=retryEnv({status:'processing',updatedAt:{toMillis:()=>Date.now()-16*60000}});ok((await e.run()).code===409&&!e.calls,'stale retry requires confirmation');ok((await e.run({recovery:'not_published'})).body.ok&&e.calls===1,'confirmed stale recovery publishes once');
  e=retryEnv({status:'paused'});ok((await e.run()).code===409&&!e.calls,'paused requires resume');ok((await e.run({resume:true})).body.ok,'explicit resume publishes');
  e=retryEnv({publicationUncertain:true});ok((await e.run()).code===409&&!e.calls,'uncertain publication requires platform check');
  e=retryEnv({status:'manual_completed',publicationUncertain:true});ok((await e.run({recovery:'not_published'})).code===409&&!e.calls,'completed uncertain job must never reopen through recovery');
  e=retryEnv({status:'processing'});ok((await e.run({},'adminMarkManualFollowup')).code===409&&!e.writes.length,'follow-up cannot erase active processing claim');
  e=retryEnv({status:'failed'});ok((await e.run({},'adminMarkManualFollowup')).body.ok&&e.job.status==='manual_followup','failed job can enter manual follow-up');
  e=retryEnv({}, {failSuccessWrite:true});let r=await e.run();ok(r.code===500&&e.job.status==='manual_required'&&e.job.publicationUncertain&&r.body.error.includes('may be live'),'successful provider plus failed write enters manual recovery');
  e=retryEnv({}, {providerFails:true});await e.run();ok(e.job.status==='failed'&&e.job.adminRetry===true,'admin failure flagged to suppress repeated customer email');
  e=retryEnv({}, {manual:true});r=await e.run();ok(r.body.manual&&!r.body.ok&&e.job.status==='manual_required','manual fallback never reported published');
  e=retryEnv({});await Promise.all([e.run(),e.run()]);ok(e.calls===1,'two retry claims publish only once');
  const source=fs.readFileSync('functions/modules/publishing.js','utf8');
  const trigger=source.slice(source.indexOf('exports.jobFailedTrigger ='),source.indexOf('exports.jobCompletedTrigger ='));
  let reads=0;const c={exports:{},onDocumentUpdated:(_,fn)=>fn,db:{collection:()=>{reads++;throw Error('unexpected email lookup')}},console};vm.runInNewContext(trigger,c);
  await c.exports.jobFailedTrigger({data:{before:{data:()=>({status:'processing'})},after:{data:()=>({status:'failed',adminRetry:true})}},params:{userId:'u'}});ok(reads===0,'admin failure trigger exits before email lookup');
  await photos();revenue();await dispatcherAndQueue();await adminViews();
  const setup=fs.readFileSync('public/BlastyBiz-CreateBiz.html','utf8');
  const normalize=setup.slice(setup.indexOf('function cbNormalizeWebsite'),setup.indexOf('// The real input constraints'));
  const cc={};vm.runInNewContext(normalize,cc);
  ok(cc.cbNormalizeWebsite(' example.com ')==='https://example.com','bare website normalized');
  ok(cc.cbNormalizeWebsite('https://example.com')==='https://example.com'&&cc.cbNormalizeWebsite('')==='','existing scheme and empty optional value preserved');
  console.log(`PASS: ${checks} review regression assertions (actual code; mocked services).`);
})().catch(error=>{console.error(error);process.exitCode=1});
