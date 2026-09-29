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
    JOB_STATUS:{PROCESSING:'processing',FAILED:'failed',MANUAL_REQUIRED:'manual_required'},
    userBizJobsRef:()=>({doc:()=>ref}),
    userBizConnsRef:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({status:'connected'}),ref:{}})})}),
    _getConnTokens:async()=>({}),_publishGoogleJob:publish,_publishFacebookJob:publish,_publishInstagramJob:publish,
    db:{runTransaction(fn){const run=lock.then(()=>fn({get:async()=>snap(),update:(_,patch)=>{writes.push(patch);Object.assign(job,patch);}}));lock=run.catch(()=>{});return run;}}
  };
  vm.runInNewContext(retrySource,c);
  return {get job(){return job},get calls(){return calls},writes,async run(extra={}){
    const res={code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}};
    await c.exports.adminRetryJob({body:{uid:'u',businessId:'b',jobId:'j',...extra}},res);return res;
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
(async()=>{
  let e=retryEnv({planGated:true});ok((await e.run()).code===409&&!e.calls&&!e.writes.length,'plan-gated job cannot publish');
  e=retryEnv({status:'processing',updatedAt:{toMillis:()=>Date.now()}});ok((await e.run({recovery:'not_published'})).code===409&&!e.calls,'active processing cannot be stolen');
  e=retryEnv({status:'processing',updatedAt:{toMillis:()=>Date.now()-16*60000}});ok((await e.run()).code===409&&!e.calls,'stale retry requires confirmation');ok((await e.run({recovery:'not_published'})).body.ok&&e.calls===1,'confirmed stale recovery publishes once');
  e=retryEnv({status:'paused'});ok((await e.run()).code===409&&!e.calls,'paused requires resume');ok((await e.run({resume:true})).body.ok,'explicit resume publishes');
  e=retryEnv({publicationUncertain:true});ok((await e.run()).code===409&&!e.calls,'uncertain publication requires platform check');
  e=retryEnv({}, {failSuccessWrite:true});let r=await e.run();ok(r.code===500&&e.job.status==='manual_required'&&e.job.publicationUncertain&&r.body.error.includes('may be live'),'successful provider plus failed write enters manual recovery');
  e=retryEnv({}, {providerFails:true});await e.run();ok(e.job.status==='failed'&&e.job.adminRetry===true,'admin failure flagged to suppress repeated customer email');
  e=retryEnv({}, {manual:true});r=await e.run();ok(r.body.manual&&!r.body.ok&&e.job.status==='manual_required','manual fallback never reported published');
  e=retryEnv({});await Promise.all([e.run(),e.run()]);ok(e.calls===1,'two retry claims publish only once');
  const source=fs.readFileSync('functions/modules/publishing.js','utf8');
  const trigger=source.slice(source.indexOf('exports.jobFailedTrigger ='),source.indexOf('exports.jobCompletedTrigger ='));
  let reads=0;const c={exports:{},onDocumentUpdated:(_,fn)=>fn,db:{collection:()=>{reads++;throw Error('unexpected email lookup')}},console};vm.runInNewContext(trigger,c);
  await c.exports.jobFailedTrigger({data:{before:{data:()=>({status:'processing'})},after:{data:()=>({status:'failed',adminRetry:true})}},params:{userId:'u'}});ok(reads===0,'admin failure trigger exits before email lookup');
  await photos();revenue();
  const setup=fs.readFileSync('public/BlastyBiz-CreateBiz.html','utf8');
  const normalize=setup.slice(setup.indexOf('function cbNormalizeWebsite'),setup.indexOf('// The real input constraints'));
  const cc={};vm.runInNewContext(normalize,cc);
  ok(cc.cbNormalizeWebsite(' example.com ')==='https://example.com','bare website normalized');
  ok(cc.cbNormalizeWebsite('https://example.com')==='https://example.com'&&cc.cbNormalizeWebsite('')==='','existing scheme and empty optional value preserved');
  console.log(`PASS: ${checks} review regression assertions (actual code; mocked services).`);
})().catch(error=>{console.error(error);process.exitCode=1});
