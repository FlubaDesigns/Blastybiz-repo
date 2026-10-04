'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const A=require('../functions/lib/platforms'),{database,admin}=require('./lib/test-firestore.cjs');
const read=p=>fs.readFileSync(p,'utf8'),cut=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i,'test source boundaries exist');return s.slice(i,j)};
let checks=0;const ok=(v,m)=>{assert(v,m);checks++};
const response=()=>({code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}});
const quiet={error(){},warn(){},log(){}};
function env(plan){
 const state=database({'users/u':{plan},'users/u/businesses/b':{},'users/u/businesses/b/listingDrafts/d':{uid:'u',status:'ready',adaptations:{facebook:'Facebook copy',bing:'Bing copy',invented:'Unknown copy'}}});
 const {db}=state;
 const c={...A,db,admin,console:quiet,crypto,exports:{},onRequest:(_,f)=>f,withAuth:f=>f,
 userBizRef:(u,b)=>db.doc(`users/${u}/businesses/${b}`),userBizDraftsRef:(u,b)=>db.collection(`users/${u}/businesses/${b}/listingDrafts`),userBizJobsRef:(u,b)=>db.collection(`users/${u}/businesses/${b}/publishJobs`),userBizPostsRef:(u,b)=>db.collection(`users/${u}/businesses/${b}/posts`)};
 // The reusable fixture does not allocate auto IDs; production Firestore does.
 let n=0;c.userBizJobsRef=(u,b)=>({doc:id=>db.doc(`users/${u}/businesses/${b}/publishJobs/${id || 'job'+ ++n}`)});
 vm.runInNewContext(cut(read('functions/modules/publishing.js'),'exports.approvePendingPost =','let dispatchHandler;'),c);
 return {c,state};
}
async function publishing(){
 for(const plan of ['trial','starter','pro','agency']){
  const {c,state}=env(plan),r=response();await c.exports.approveDraft({method:'POST',body:{businessId:'b',draftId:'d'}},r,{uid:'u'});
  const jobs=Object.entries(state.all()).filter(([k])=>k.includes('/publishJobs/')).map(([,v])=>v);
  ok(r.code===200&&jobs.find(j=>j.platform==='facebook').status==='pending',plan+': approved automatic platform queues normally');
  ok(jobs.filter(j=>j.platform!=='facebook').every(j=>j.status==='manual_required'),plan+': manual and unknown platforms remain manual');
  ok(jobs.every(j=>!j.planGated),plan+': no paid publishing feature gate');
  const r2=response();await c.exports.approveDraft({method:'POST',body:{businessId:'b',draftId:'d'}},r2,{uid:'u'});ok(r2.code===409,plan+': duplicate approval remains blocked');
  await c.db.doc('users/u/businesses/b/posts/p').set({uid:'u',bizId:'b',status:'pending',platforms:[{id:'facebook',type:'api'},{id:'bing',type:'api'}],adaptations:{facebook:'copy',bing:'copy'}});
  const p=response();await c.exports.approvePendingPost({method:'POST',body:{pendingPostId:'p',bizId:'b',action:'approve'}},p,{uid:'u'});
  const pending=Object.values(state.all()).filter(j=>j.jobType==='scheduled_approved');
  ok(p.code===200&&pending.find(j=>j.platform==='facebook').status==='pending',plan+': explicit pending-post approval queues automatic destination');
  ok(pending.find(j=>j.platform==='bing').status==='manual_required',plan+': forged automatic type cannot enable Bing publisher');
 }
}
async function migration(){
 const {migrate}=require('./migrate-platform-config.cjs');
 const state=database({'config/platforms':{facebook:{capabilityLevel:'partial_auto',proOnly:true,name:'Custom',enabled:false},bing:{capabilityLevel:'full_auto',proOnly:true},custom:{capabilityLevel:'partial_auto'},note:'retain'}});
 const before=JSON.stringify(state.all());let r=await migrate(state.db);
 ok(!r.applied&&JSON.stringify(state.all())===before,'migration defaults to dry-run');
 ok(r.patch['facebook.capabilityLevel']==='full_auto'&&r.patch['bing.capabilityLevel']==='manual_assisted','migration corrects known delivery overrides');
 await migrate(state.db,true);const after=state.get('config/platforms');
 ok(after.facebook.name==='Custom'&&!after.facebook.enabled&&after.note==='retain'&&after.custom.capabilityLevel==='partial_auto','migration preserves presentation and unrelated data');
 ok(!after.facebook.proOnly&&after.facebook.deliveryMode==='auto','migration removes obsolete plan gate');
 ok(Object.keys((await migrate(state.db,true)).patch).length===0,'migration is idempotent');
 const fail=database({'config/platforms':{facebook:{capabilityLevel:'partial_auto'}}});fail.failNext();await assert.rejects(migrate(fail.db,true));ok(fail.get('config/platforms').facebook.capabilityLevel==='partial_auto','failed migration is atomic');
}
async function prompts(){
 const s=read('functions/modules/ai.js');let prompt='',reserved=0;
 const c={...A,platformAuthority:A,console:quiet,exports:{},onRequest:(_,f)=>f,withAuth:f=>f,
 _getAdminPlatformDocs:async()=>({bing:{purpose:'Reviewed Bing guidance'}}),reserveAiAction:async()=>reserved++,
 loggedAI:async(u,f,b,p)=>{prompt=p;return {text:'{"suggestions":{}}',model:'fixture'}},classifyAiError:()=> 'error'};
 vm.runInNewContext(cut(s,'function _mergeAdminPlatformDoc','exports.adaptListing =')+cut(s,'exports.suggestPlatforms =','exports.chatCampaign ='),c);
 const r=response();await c.exports.suggestPlatforms({body:{name:'Fixture shop'}},r,{uid:'u'});
 ok(r.code===200&&reserved===1,'suggestion handler still checks its AI allowance once');
 ok(prompt.includes('bing: Bing Places — Ready for You to Post. Purpose: Reviewed Bing guidance'),'suggestions use canonical delivery plus admin writing guidance');
 ok(prompt.includes('pinterest:')&&!prompt.includes('unsexy')&&!prompt.includes('API available'),'all platforms included without old duplicated provider/rule claims');
 vm.runInNewContext(cut(read('functions/lib/shared.js'),'function buildPlatformBlock','// ── Account activity signal'),c);
 ok(c.buildPlatformBlock({id:'bing',name:'Bing',type:'api',doc:A.PLATFORM_DOCS.bing}).includes('Ready for You to Post'),'adaptation ignores a client claim that Bing publishes automatically');
}
async function browser(){
 const browser={};vm.runInNewContext(read('public/platforms-authority.js'),browser);
 ok(JSON.stringify(browser.BBPlatforms.records)===JSON.stringify(A.records),'browser and server facts match');
 const def=A.PLATFORM_DEFAULTS.find(d=>d.slug==='bing'),merged=A.mergeDisplay(def,{capabilityLevel:'full_auto',deliveryMode:'auto',proOnly:true,name:'Local name',enabled:false});
 ok(merged.deliveryMode==='manual'&&!merged.proOnly&&merged.name==='Local name'&&!merged.enabled,'display overrides preserve customization but cannot forge access or publishers');
 ok(A.normalizeSelection({id:'bing',type:'api'}).type==='manual'&&A.normalizeSelection({id:'unknown',type:'api'}).type==='manual','cached and unknown selections fail closed');
 const html=read('public/BlastyBiz-Listing-Preview.html'),c={BBPlatforms:A,window:{}};
 vm.runInNewContext(cut(html,'var PLATFORM_META =','function showToast'),c);
 for(const plan of ['starter','trial','pro','agency']){c.window.setPubPlan(plan);ok(c.isAutoCapable('facebook')&&!c.isAutoCapable('bing')&&!c.isAutoCapable('unknown'),plan+': preview matches server delivery');}
 const main=read('public/BlastyBiz.html');const elements={};const make=id=>elements[id]||=( {id,style:{},classList:{values:new Set(['visible']),add(k){this.values.add(k)},remove(k){this.values.delete(k)},contains(k){return this.values.has(k)},toggle(k,on){on?this.add(k):this.remove(k)}},getAttribute:()=> 'trial starter'} );
 const overlays=['history-pro-overlay','schedule-pro-overlay','library-overlay'].map(make);
 const ctx={window:{_bbUserPlan:'starter'},document:{getElementById:make,querySelectorAll:()=>overlays}};
 vm.runInNewContext(cut(main,'window._applyPlanOverlays =','// Show deferred fixed overlays'),ctx);ctx.window._applyPlanOverlays();
 ok(!elements['history-pro-overlay']._pendingVisible&&!elements['library-overlay'].classList.contains('visible'),'history/library overlay does not block starter');
 ok(elements['schedule-pro-overlay']._pendingVisible,'unresolved free recurring policy remains unchanged');
 ctx.window._bbUserPlan='pro';ctx.window._applyPlanOverlays();ok(!elements['schedule-pro-overlay']._pendingVisible,'plan switch clears obsolete deferred overlay state');
 vm.runInNewContext(cut(main,'function photoCap()','function updatePhotoCapLabel()'),ctx);ok(ctx.photoCap()===20,'shared 20-photo capacity does not vary by plan');
 // Execute the existing library action to distinguish a real guard removal from changed copy.
 const nodes={'qp-copy-text-facebook':{textContent:'reviewed copy'}},saves=[];
 const lib={window:{_bbUserPlan:'starter',_bbSaveLibraryItem:async v=>saves.push(v)},document:{getElementById:id=>nodes[id],querySelector:()=>null},setTimeout(){},activeCampaignName:'Campaign',activeCampaignId:'c',platforms:[{id:'facebook',name:'Facebook'}],profile:{},showToast(){}};
 vm.runInNewContext(cut(main,'async function saveCopyToLibrary','async function approvePlatformCopy'),lib);await lib.saveCopyToLibrary('facebook');ok(saves.length===1,'starter actually saves approved copy to the library');
}
(async()=>{await publishing();await migration();await prompts();await browser();console.log('PASS: '+checks+' Pass 9 behavior assertions.');})().catch(e=>{console.error(e);process.exitCode=1});
