'use strict';
// Exercise production handlers with isolated persistence and provider doubles.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
const read = p => fs.readFileSync(p, 'utf8');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const quiet = { error(){}, warn(){} };
const response = () => ({code:200, status(n){this.code=n;return this},json(body){this.body=body;return this}});
function pendingEnv(overrides = {}) {
  let post = {uid:'u',bizId:'b',status:'pending',platforms:[{id:'facebook',type:'api'}],adaptations:{facebook:'Approved copy'},imageUrls:['https://example.com/floor.jpg'],...overrides};
  const jobs = new Map(); let lock=Promise.resolve(),fail=false;
  const c = {exports:{},console:quiet,crypto:require('node:crypto'),onRequest:(_,f)=>f,withAuth:f=>f,
    admin:{firestore:{FieldValue:{serverTimestamp:()=>1}}},
    userBizPostsRef:(uid,biz)=>({doc:id=>({kind:'post',uid,biz,id})}),
    userBizJobsRef:(uid,biz)=>({doc:id=>({kind:'job',uid,biz,id})}),
    db:{collection:()=>({doc:()=>({kind:'user'})}),runTransaction(fn){
      const next=lock.then(async()=>{const writes=[];const result=await fn({
        get:async ref=>({exists:true,data:()=>ref.kind==='user'?{plan:'pro'}:{...post}}),
        create:(ref,data)=>writes.push(()=>{assert(!jobs.has(ref.id));jobs.set(ref.id,data)}),
        update:(ref,data)=>writes.push(()=>Object.assign(post,data)),
      });if(fail)throw Error('write failed');writes.forEach(f=>f());return result;});lock=next.catch(()=>{});return next;
    }}
  };
  vm.runInNewContext(section(read('functions/modules/publishing.js'),'exports.approvePendingPost =','exports.approveDraft ='),c);
  return {jobs,get post(){return post},set fail(v){fail=v},async run(action='approve',body={}) {const r=response();await c.exports.approvePendingPost({method:'POST',body:{bizId:'b',pendingPostId:'p',action,...body}},r,{uid:'u'});return r;}};
}
async function pendingTests() {
  let e=pendingEnv();const r=await Promise.all([e.run(),e.run()]);ok(r.every(x=>x.code===200)&&e.jobs.size===1,'concurrent approvals create one deterministic job');
  const job=[...e.jobs.values()][0];ok(job.payload.imageUrls[0]==='https://example.com/floor.jpg'&&job.payload.adaptedContent==='Approved copy','approval retains approved copy and images');
  ok((await e.run('dismiss')).code===409&&e.post.status==='approved','dismiss cannot overturn approved work');
  e=pendingEnv();await e.run('dismiss');await e.run('dismiss');ok(e.post.status==='dismissed'&&!e.jobs.size,'dismiss retries are idempotent without jobs');
  ok((await e.run()).code===409,'dismissed post cannot subsequently publish');
  e=pendingEnv();e.fail=true;ok((await e.run()).code===500&&e.post.status==='pending'&&!e.jobs.size,'failed commit preserves pending work');e.fail=false;await e.run();ok(e.jobs.size===1,'failed approval can be retried');
  e=pendingEnv({bizId:'other'});ok((await e.run()).code===403&&!e.jobs.size,'stored business mismatch rejected');
  e=pendingEnv({uid:'other'});ok((await e.run()).code===403&&!e.jobs.size,'stored owner mismatch rejected');
  e=pendingEnv({adaptations:{}});ok((await e.run()).code===400&&e.post.status==='pending','empty generated content cannot be marked approved');
  e=pendingEnv({imageUrls:['javascript:bad']});ok((await e.run()).code===400&&!e.jobs.size,'invalid media fails atomically');
  e=pendingEnv();ok((await e.run('approve',{bizId:'a/b'})).code===400,'path injection rejected');
  for (const type of [undefined, 'legacy']) {
    e=pendingEnv({platforms:[{id:'facebook',type},{id:'facebook',type}]});
    const result=await e.run();const manual=[...e.jobs.values()][0];
    ok(result.code===200&&e.jobs.size===1&&manual.status==='manual_required'&&manual.capabilityLevel==='manual_assisted'&&!manual.planGated,'missing or legacy platform type creates one manual job');
  }
}
async function setupTests() {
  for (const name of ['Profile','Story']) {
    const html=read('public/BlastyBiz-'+name+'.html');
    const code=section(html,'let '+name.toLowerCase()+'Saving =','await auth.authStateReady()');
    const nodes={},storage=new Map([['bb_bizId','b']]),writes=[];let fail=true;
    const c={window:{_bbUid:'u',location:{href:'unchanged'}},console:quiet,auth:{currentUser:{uid:'u'}},db:{},
      document:{getElementById:id=>nodes[id]||(nodes[id]={hidden:true,scrollIntoView(){}})},
      sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
      doc:(_, ...p)=>({path:p.join('/'),id:p.at(-1)||'new'}),collection:()=>({}),serverTimestamp:()=>1,
      writeBatch:()=>{const pending=[];return {set:(r,d)=>pending.push({r,d}),commit:async()=>{if(fail)throw Error('offline');writes.push(...pending);}}},
      setDoc:async(r,d)=>{if(fail)throw Error('offline');writes.push({r,d});}
    };
    // Include only the save declaration, excluding the auth listener below it.
    vm.runInNewContext(code,c);
    await c.window['_bbSave'+name]({email:'business@example.com',bizName:'Floors',story:'Original answers'}, {}, 'skip');
    ok(c.window.location.href==='unchanged'&&!writes.length&&!nodes[name.toLowerCase()+'-save-error'].hidden,name+' failed write stays on page with retry');
    fail=false;await c.window['_bbRetry'+name]();
    ok(c.window.location.href.includes('BlastyBiz-CreateBiz.html')&&writes.length>0,name+' retry saves before advancing');
    if(name==='Story') {
      for (const missing of ['business','user']) {
        storage.set('bb_bizId',missing==='business'?'':'b');c.window._bbUid=missing==='user'?null:'u';
        c.window.location.href='unchanged';const before=writes.length;
        await c.window._bbSaveStory({story:'Retained answers'});
        ok(c.window.location.href==='BlastyBiz-CreateBiz.html'&&writes.length===before&&nodes['story-save-error'].hidden,'missing '+missing+' context redirects without a write or dead-end retry');
      }
    }
    if(name==='Profile')ok(writes.length===2&&!('email' in writes[1].d)&&writes[0].d.email==='business@example.com','profile batch keeps business contact separate from account email');
  }
}
async function chatTests() {
  const code=section(read('functions/modules/ai.js'),'exports.chatCampaign =','exports.scoreFact =');
  let blocked='LIMIT_REACHED',calls=0,reservations=0,logs=0;
  const c={exports:{},console:quiet,onRequest:(_,f)=>f,withAuth:f=>f,
    reserveAiAction:async()=>{reservations++;if(blocked)throw Error(blocked);},
    callAI:async()=>{calls++;return {text:'{"done":false,"message":"Next?"}',model:'test',usage:{}}},
    trackAiUsage:async()=>{logs++;}
  };vm.runInNewContext(code,c);
  const run=async body=>{const r=response();await c.exports.chatCampaign({method:'POST',body},r,{uid:'u'});return r;};
  const first=[{role:'assistant',content:'What is the hook?'},{role:'user',content:'Spring offer'}];
  ok((await run({conversationHistory:first})).code===429&&!calls,'exhausted allowance never calls provider');
  blocked='database unavailable';ok((await run({conversationHistory:first})).code===503&&!calls,'allowance outage fails closed');
  blocked=null;ok((await run({conversationHistory:first})).body.message==='Next?'&&calls===1&&logs===1,'allowed chat reserves and logs one call');
  const spent=reservations;const history=[...first];
  for(let i=2;i<=5;i++) {
    history.push({role:'assistant',content:'Next?'},{role:'user',content:'Answer '+i});
    ok((await run({conversationHistory:history})).code===200,'conversation message '+i+' succeeds');
  }
  ok(reservations===spent&&calls===5&&logs===5,'five chat messages spend only one action and log every provider call');
  const before=reservations;ok((await run({conversationHistory:[{role:'system',content:'bad'}]})).code===400&&reservations===before,'invalid history rejected before consuming allowance');
}
async function draftTests() {
  const html=read('public/BlastyBiz.html');
  const code=section(html,'window._afterAdaptation =','document.addEventListener(\'bb:savePlatforms\'');
  const writes=[];let fail=true,next=0;
  const c={window:{},currentUser:{uid:'u'},activeBizId:'b',activeCampaignId:'c',activeCampaignName:'Campaign',console:quiet,db:{},
    document:{getElementById:()=>({value:'value'})},serverTimestamp:()=>1,increment:n=>n,
    collection:(_, ...p)=>({path:p.join('/')}),doc:(base,...p)=>({id:p.length?p.at(-1):'draft'+(++next),path:p.length?p.join('/'):base.path}),
    setDoc:async(ref,data)=>{writes.push({ref,data});if(fail)throw Error('offline')},updateDoc:async(ref,data)=>{writes.push({ref,data});if(fail)throw Error('offline')}
  };vm.runInNewContext(code,c);
  const platforms=[{id:'facebook',enabled:true,adaptedContent:'Saved<br/>copy'}];
  await assert.rejects(c.window._afterAdaptation(platforms));ok(!c.window._currentDraftId&&!!c.window._bbPendingDraft,'failed new draft retains retry identity without claiming saved');
  fail=false;const id=await c.window._afterAdaptation(platforms);ok(writes[0].ref===writes[1].ref&&id===c.window._currentDraftId&&next===1,'retry uses same draft identity');
  ok(writes[1].data.adaptations.facebook==='Saved\ncopy','retry preserves generated text without AI');
  fail=true;await assert.rejects(c.window._afterAdaptation(platforms));ok(next===1,'failed existing draft update does not create a second draft');
  const nodes={},messages=[];let saved=false;
  const d={window:{activeBizId:'b',_afterAdaptation:async()=>{if(!saved)throw Error('offline');return 'd';}},platforms,console:quiet,showToast:m=>messages.push(m),document:{getElementById:id=>nodes[id]||(nodes[id]={hidden:true,disabled:true,classList:{remove(){},add(){}}})}};
  vm.runInNewContext(section(html,'let generatedDraftSaving =','async function runAdaptation()'),d);
  await d.retryGeneratedDraftSave();ok(d.window._bbDraftSavePending&&!nodes['draft-save-error'].hidden,'draft UI exposes failed save and blocks continuation');
  saved=true;await d.retryGeneratedDraftSave();ok(!d.window._bbDraftSavePending&&nodes['draft-save-error'].hidden&&!nodes['review-output-btn'].disabled&&nodes['review-listings-btn'].href.includes('draftId=d'),'successful retry restores review navigation');
}
async function deletionTests() {
  const source=read('functions/modules/business.js');
  const code=section(source,'exports.deleteBusiness =','exports.deleteAccount =');
  function env(ids,active) {
    const user={activeBusiness:active,businessIds:[...ids]};let lock=Promise.resolve(),cleanup=[];
    const collection={doc:id=>({kind:'business',id})};const userRef={kind:'user',collection:()=>collection};
    const c={exports:{},console:quiet,onRequest:(_,f)=>f,withAuth:f=>f,db:{collection:()=>({doc:()=>userRef}),recursiveDelete:async ref=>cleanup.push(ref.id),runTransaction(fn){const run=lock.then(async()=>{const writes=[];const r=await fn({get:async ref=>ref===userRef?{exists:true,data:()=>({...user})}:{docs:ids.map(id=>({id}))},delete:ref=>writes.push(()=>ids.splice(ids.indexOf(ref.id),ids.includes(ref.id)?1:0)),update:(_,data)=>writes.push(()=>Object.assign(user,data))});writes.forEach(f=>f());return r;});lock=run.catch(()=>{});return run;}}};
    vm.runInNewContext(code,c);return {user,ids,cleanup,run:async id=>{const r=response();await c.exports.deleteBusiness({method:'POST',body:{bizId:id}},r,{uid:'u'});return r;}};
  }
  let e=env(['a','b'],'a');ok((await e.run('a')).body.activeBusiness==='b'&&e.user.activeBusiness==='b'&&e.user.businessIds.join()==='b','deletion repairs account pointers server-side');
  ok((await e.run('a')).code===200&&e.cleanup.length===2,'cleanup can retry after parent removal');
  e=env(['a'],'a');ok((await e.run('a')).code===409&&e.ids.length===1&&!e.cleanup.length,'last business is retained');
  e=env(['a','b'],'a');const r=await Promise.all([e.run('a'),e.run('b')]);ok(r.filter(x=>x.code===200).length===1&&e.ids.includes(e.user.activeBusiness),'concurrent deletions retain a valid active business');
}
async function campaignTests() {
  const html=read('public/BlastyBiz.html'),nodes={},messages=[],writes=[];let fail=true;
  const node=id=>nodes[id]||(nodes[id]={value:id==='new-campaign-input'?'Spring Floors':'Brief',focus(){},classList:{add(){},remove(){}}});
  const c={window:{activeBizId:'b',_bbSaveCampaigns:async data=>{writes.push(data);if(fail)throw Error('offline')}},document:{getElementById:node},crypto:require('node:crypto'),campaigns:[],activeCampaignId:null,activeCampaignName:null,showToast:m=>messages.push(m),_sortCampaigns(){},renderCampaignChips(){}};
  vm.runInNewContext(section(html,'let quickCampaignSaving =','async function deleteCampaign('),c);
  await c.saveNewCampaign();ok(c.campaigns.length===0&&!c.activeCampaignId&&node('new-campaign-input').value==='Spring Floors','failed Quick Create retains answers without reporting creation');
  fail=false;await c.saveNewCampaign();ok(c.campaigns.length===1&&writes[0][0].id===writes[1][0].id&&c.activeCampaignId===writes[1][0].id,'Quick Create retry preserves one identity and selects only after saving');
  const ccNodes={},ccMessages=[],ccWrites=[];let ccFail=true;
  const ccNode=id=>ccNodes[id]||(ccNodes[id]={innerHTML:'',appendChild(b){this.button=b;}});
  const d={window:{activeBizId:'b',_bbSaveCampaigns:async data=>{ccWrites.push(data);if(ccFail)throw Error('offline')}},ccCol:{campaignName:'Chat Campaign'},crypto:require('node:crypto'),campaigns:[],activeCampaignId:null,activeCampaignName:null,
    document:{createElement:()=>({})},$cc:ccNode,ccSetLabel(){},ccAddMsg:(_,m)=>ccMessages.push(m),_sortCampaigns(){},ccSetProgress(){},setTimeout(){}};
  vm.runInNewContext(section(html,'let ccCampaignSaving =','// ── Public API'),d);
  await d.ccCreateCampaign({campaignMemory:'Original brief'});ok(!d.campaigns.length&&!!ccNode('cc-options').button,'chat save failure exposes retry without claiming campaign created');
  ccFail=false;await ccNode('cc-options').button.onclick();ok(d.campaigns.length===1&&ccWrites[0][0].id===ccWrites[1][0].id,'chat retry reuses identity and retained brief');
}
async function gatewayTests() {
  const html=read('public/BlastyBiz.html'),messages=[];
  const c={window:{activeBizId:'b',_bbGetToken:async()=>'token'},showToast:m=>messages.push(m),
    fetch:async()=>({ok:false,json:async()=>{throw new SyntaxError('Unexpected token <')}})};
  vm.runInNewContext(section(html,'const pendingDecisions =','// ══════════════════════════════════════════'),c);
  await c._decidePendingPost('p','approve');
  ok(messages.pop()==='Could not save your decision. You can retry.','HTML approval failure displays friendly fallback');
  const button={disabled:false};let reloaded=false;
  const d={window:{BUSINESSES:[{id:'a',name:'A'},{id:'b',name:'B'}],activeBizId:'a',showToast:m=>messages.push(m),location:{reload(){reloaded=true;}}},
    currentUser:{getIdToken:async()=>'token'},confirm:()=>true,document:{querySelector:()=>button},console:quiet,fetch:c.fetch};
  vm.runInNewContext(section(html,'window.deleteBusiness =','\n  try {\n    const bizSnap'),d);
  await d.window.deleteBusiness('a');
  ok(messages.pop()==='Could not delete business.'&&!button.disabled&&d.window.BUSINESSES.length===2&&!reloaded,'HTML deletion failure preserves business and displays friendly fallback');
}
function presentationTests() {
  const page=read('public/BlastyBiz-Publishing-Status.html');
  const c={};vm.runInNewContext(section(page,'const STATUS_CONFIG =','function renderJobs(')+';globalThis.statuses=STATUS_CONFIG;',c);
  ok(c.statuses.processing.label==='Publishing'&&c.statuses.manual_followup.label==='Action Needed','dispatcher states have accurate owner labels');
  for(const file of ['public/BlastyBiz.html','public/BlastyBiz-Account.html']) {
    const s=read(file);ok(!s.includes('acct-ai-usage')&&!s.includes('1 credit')&&!s.includes('Try again (free)'),'owner credits and usage meter removed from '+file);
  }
}
(async()=>{await pendingTests();await setupTests();await chatTests();await draftTests();await deletionTests();await campaignTests();await gatewayTests();presentationTests();console.log(`PASS: ${checks} Pass 6 behavior assertions (actual code; isolated services).`);})().catch(e=>{console.error(e);process.exitCode=1;});
