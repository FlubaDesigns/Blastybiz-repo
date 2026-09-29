'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8'),cut=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};const quiet={error(){},warn(){},log(){}};
const schedule=require('../functions/lib/schedule');
function calendarTests(){
  const s={frequency:'daily',timezone:'America/New_York',timeSlot:'morning'};
  for(const [after,expected] of [['2026-03-07T14:00:00Z','2026-03-08T13:00:00.000Z'],['2026-10-31T13:00:00Z','2026-11-01T14:00:00.000Z'],['2026-09-29T12:59:59Z','2026-09-29T13:00:00.000Z']])ok(schedule.computeNextRunAt(s,new Date(after)).toISOString()===expected,'daily wall time '+after);
  ok(schedule.computeNextRunAt({...s,frequency:'weekly',dayOfWeek:1},new Date('2026-03-02T14:00:00Z')).toISOString()==='2026-03-09T13:00:00.000Z','weekly retains Monday 9am across DST');
  for(const [after,expected] of [['2026-01-31T14:00:00Z','2026-02-28T14:00:00.000Z'],['2028-01-31T14:00:00Z','2028-02-29T14:00:00.000Z'],['2026-02-28T14:00:00Z','2026-03-31T13:00:00.000Z']])ok(schedule.computeNextRunAt({...s,frequency:'monthly',dayOfMonth:31},new Date(after)).toISOString()===expected,'month end '+after);
  ok(schedule.computeNextRunAt({...s,timezone:'Asia/Kathmandu'},new Date('2026-09-29T01:00:00Z')).toISOString()==='2026-09-29T03:15:00.000Z','quarter-hour timezone');
  for(const frequency of ['biweekly','custom']){ok(schedule.normalizeSchedule({frequency,enabled:true}).enabled===false,'unsupported '+frequency+' paused');assert.throws(()=>schedule.computeNextRunAt({frequency},new Date()));checks++;}
  assert.throws(()=>schedule.computeNextRunAt({...s,timezone:'Not/AZone'},new Date()));checks++;
  const c={Intl,Date};vm.runInNewContext(read('public/schedule-utils.js'),c);ok(c.BBSchedule.computeNextRunAt(s,new Date('2026-03-07T14:00:00Z')).toISOString()==='2026-03-08T13:00:00.000Z','browser and server run same recurrence code');
  ok(read('functions/lib/schedule.js')===read('public/schedule-utils.js'),'generated browser asset exactly matches authority');
}
function emailEnv(){
  const shared=read('functions/lib/shared.js'),source=read('functions/modules/publishing.js');
  const cycle=String(Date.now()+3600000);let draft={uid:'u',businessId:'b',schedule:{enabled:true,nextRunAt:new Date(Number(cycle)).toISOString()}},used=null,fail=false,writes=0,lock=Promise.resolve();
  const ref=(kind,id)=>({kind,id,collection:name=>({doc:id=>ref(name==='businesses'?'biz':'draft',id)}),get:async()=>snapshot({kind,id})});
  const snapshot=r=>({exists:r.kind==='action'?!!used:true,data:()=>r.kind==='draft'?draft:r.kind==='action'?used:{}});
  const c={exports:{},console:quiet,crypto,Buffer,URLSearchParams,Date,APP_BASE_URL:'https://example.com',onRequest:(_,f)=>f,
    admin:{firestore:{FieldValue:{serverTimestamp:()=>1}}},_actionSecret:()=> 'key',
    db:{collection:name=>({doc:id=>ref(name==='draftActions'?'action':'user',id)}),runTransaction(fn){const next=lock.then(async()=>{const pending=[];const result=await fn({get:async r=>snapshot(r),create:(_,data)=>pending.push(()=>used=data),update:(r,data)=>pending.push(()=>{writes++;if(r.kind==='draft')Object.assign(draft.schedule,data['schedule.approved']?{approved:true}:{skipCycle:true});})});if(fail)throw Error('offline');pending.forEach(f=>f());return result;});lock=next.catch(()=>{});return next;}}
  };
  vm.runInNewContext(cut(shared,'function makeActionSig','function _actionSecret'),c);
  vm.runInNewContext(cut(source,'function _actionHtmlPage','// ─────────────────────────────────────────────────────────────────────────────'),c);
  const query=action=>({uid:'u',biz:'b',draft:'d',action,cycle,sig:c.makeActionSig('u','b','d',action,cycle,'key')});
  return {c,query,get writes(){return writes},get used(){return used},get draft(){return draft},set fail(v){fail=v},async run(method='GET',action='approve',patch={},body={confirm:'1'}){const res={code:200,set(){},status(n){this.code=n;return this},send(body){this.body=body;return this},redirect(n,url){this.code=n;this.url=url;return this}};await c.exports.draftAction({method,query:{...query(action),...patch},body},res);return res;}};
}
async function emailTests(){
  let e=emailEnv();for(const action of ['approve','skip','pause']){const r=await e.run('GET',action);ok(r.code===200&&r.body.includes('method="post"')&&!e.writes&&!e.used,'scanner GET '+action+' does not mutate');}
  let r=await e.run('GET','change');ok(r.code===302&&r.url.includes('bizId=b')&&r.url.includes('draftId=d')&&r.url.includes('ownerUid=u')&&!r.url.includes('edit=1')&&!e.writes,'Change targets exact business/draft/account');
  ok((await e.run('GET','approve',{biz:'other'})).code===400&&!e.writes,'business bound to signature');
  ok((await e.run('POST','approve',{},{})).code===400&&!e.writes,'POST requires explicit confirmation');
  e.draft.schedule.nextRunAt=new Date(Date.now()+7200000).toISOString();ok((await e.run('POST')).code===409&&!e.writes&&!e.used,'changed cycle invalidates old email');
  e=emailEnv();e.draft.schedule.enabled=false;ok((await e.run('POST')).code===409&&!e.used,'disabled schedule cannot be approved');
  e=emailEnv();e.fail=true;ok((await e.run('POST')).code===500&&!e.used&&!e.writes,'failed action transaction is not consumed');e.fail=false;ok((await e.run('POST')).code===200&&e.used.action==='approve','failed action can retry');
  e=emailEnv();const both=await Promise.all([e.run('POST','approve'),e.run('POST','skip')]);ok(both.every(r=>r.code===200)&&e.used.action==='approve'&&!e.draft.schedule.skipCycle,'simultaneous mutually-exclusive actions commit only one decision');
  ok((await e.run('PUT')).code===405,'other mutation methods rejected');
}
async function scheduleSaveTests(){
  const html=read('public/BlastyBiz.html'),messages=[],saved=[],nodes={};let fail=true;
  const initial={enabled:false,frequency:'weekly',timeSlot:'morning',timezone:'America/New_York',dayOfWeek:1};
  const c={window:{activeBizId:'b',_currentDraftId:'d',_bbUpdateDraftSchedule:async(id,change)=>{saved.push({schedule:change});if(fail)throw Error('offline')}},BBSchedule:schedule,_quickSched:{...initial},_draftSchedules:{d:{schedule:{...initial}}},_defaultSched:()=>({...initial}),_computeNextRunDate:s=>schedule.computeNextRunAt(s),_getDraftSchedEntry:()=>c._draftSchedules.d,loadQuickSchedFromDraft:s=>c._quickSched=s,_renderSchedTabFromData(){},showToast:m=>messages.push(m),document:{getElementById:id=>nodes[id]}};
  vm.runInNewContext(cut(html,'var _scheduleSaving =','function _saveQuickSchedToDraft('),c);
  ok(await c._persistSchedule('d',{enabled:true},true)===false&&!c._quickSched.enabled&&!c._draftSchedules.d.schedule.enabled&&messages.at(-1).includes('not saved'),'failed quick schedule restores saved state');
  fail=false;ok(await c._persistSchedule('d',{enabled:true},false)===true&&c._draftSchedules.d.schedule.enabled&&c._quickSched.enabled,'successful per-draft save updates both views after persistence');
  ok(!!saved.at(-1).schedule.nextRunAt,'next run saved with recurrence');
  fail=true;ok(await c._persistSchedule('d',{frequency:'monthly'},false)===false&&c._draftSchedules.d.schedule.frequency==='weekly','failed per-draft save keeps old frequency');
  ok(await c._persistSchedule(null,{enabled:true},true)===false,'unsaved draft cannot appear scheduled');
}
async function publisherTests(){
  const source=read('functions/modules/publishing.js');let reject=Object.assign(Error('timeout'),{code:'ETIMEDOUT'});
  const c={...require('../functions/lib/provider-api'),axios:{post:async()=>{throw reject}},module:{exports:{}},console:quiet};
  vm.runInNewContext(cut(source,'async function _publicationPost','// Export for use'),c);
  await assert.rejects(c._publishFacebookJob({payload:{adaptedContent:'copy'}},{pageId:'p'}),e=>e.publicationUncertain===true);checks++;
  reject=Object.assign(Error('rejected'),{response:{status:400,data:{}}});await assert.rejects(c._publishFacebookJob({},{pageId:'p'}),e=>e.publicationUncertain===false);checks++;
  reject=Object.assign(Error('server error'),{response:{status:503,data:{}}});await assert.rejects(c._publicationPost('url',{}),e=>e.publicationUncertain===true);checks++;
  let state={status:'pending',platform:'facebook'},calls=0;
  const ref={get:async()=>({data:()=>state}),update:async patch=>Object.assign(state,patch)};
  const d={exports:{},console:quiet,onDocumentCreated:(_,f)=>f,onDocumentUpdated:(_,f)=>f,admin:{firestore:{FieldValue:{serverTimestamp:()=>1}}},db:{runTransaction:async fn=>fn({get:async()=>({exists:true,data:()=>state}),update:(_,p)=>Object.assign(state,p)})},userBizConnsRef:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({status:'connected'}),ref:{}})})}),_getConnTokens:async()=>({}),_publishFacebookJob:async()=>{calls++;throw Object.assign(Error('timeout'),{publicationUncertain:true})}};
  vm.runInNewContext(cut(source,'exports.dispatchPublishJob =','exports.jobFailedTrigger ='),d);
  const event={data:{data:()=>({status:'pending'}),ref},params:{userId:'u',bizId:'b',jobId:'j'}};
  await d.exports.dispatchPublishJob(event);await d.exports.dispatchPublishJob(event);ok(state.status==='manual_required'&&state.publicationUncertain&&calls===1,'ambiguous timeout blocks automatic repost on event redelivery');
}
async function allowanceTests(){
  const source=read('functions/lib/shared.js');
  function env(grant){let used=0,lock=Promise.resolve();const user={kind:'user'},privateRef={kind:'private'},draft={kind:'draft',collection:()=>({doc:()=>privateRef})};
    const c={Date,db:{collection:name=>({doc:()=>name==='accountDeletions'?{kind:'deletion'}:user}),runTransaction(fn){const next=lock.then(()=>fn({get:async r=>({exists:r.kind==='deletion'?false:r===privateRef?!!grant:true,data:()=>r===privateRef?grant:r===draft?{freeRegenUsed:false}:{plan:'pro',aiActionsUsed:used,aiActionsResetAt:{toDate:()=>new Date(Date.now()+86400000)}}}),set:(r,data)=>{if(r===user)used+=1;},update:(_,data)=>Object.assign(grant,data)}));lock=next.catch(()=>{});return next;}},getPlanConfig:async()=>({aiLimits:{pro:100}}),admin:{firestore:{FieldValue:{increment:n=>n,serverTimestamp:()=>1}}}};
    vm.runInNewContext(cut(source,'async function reserveAiAction','// ── fetchWithTimeout'),c);return {run:()=>c.reserveAiAction('u',{draftRef:draft,isRegeneration:true}),get used(){return used}};
  }
  let e=env(null);ok(!(await e.run()).freeRegen&&e.used===1,'client-created draft/false marker cannot fabricate free eligibility');
  e=env({uid:'other',freeRegenUsed:false});ok(!(await e.run()).freeRegen&&e.used===1,'grant must belong to requesting user');
  e=env({uid:'u',freeRegenUsed:false});const results=await Promise.all([e.run(),e.run()]);ok(results.filter(x=>x.freeRegen).length===1&&e.used===1,'one server grant supports only one concurrent free regeneration');
  ok(!(await e.run()).freeRegen&&e.used===2,'resetting public marker cannot reset consumed private grant');
  const rules=cut(read('firestore.rules'),'match /listingDrafts/{draftId}','// Publish jobs');ok(rules.includes("hasAny(['uid', 'freeRegenUsed', 'freeRegenEligible', 'packet', 'packetFrozenAt',")&&rules.includes('match /private/{document} { allow read, write: if false; }'),'draft rules protect markers and private grant');
}
async function logTests(){
  const source=read('functions/modules/ai.js'),events=[];let done,fail=false;
  const gate=new Promise(r=>done=r);
  const c={Date,AI_DEFAULTS:{fastModel:'fast'},classifyAiError:()=> 'timeout',callAI:async()=>{if(fail)throw Error('provider');return {text:'answer',model:'fast',usage:{input_tokens:1}}},trackAiUsage:async(...args)=>{events.push(args);await gate;}};
  vm.runInNewContext(cut(source,'function aiRequestContext','exports.generateEnrichmentQuestions ='),c);
  let returned=false;const p=c.loggedAI('u','chatCampaign',{businessId:'b',campaignId:'c'},'prompt',{}).then(()=>returned=true);await new Promise(r=>setImmediate(r));ok(!returned&&events.length===1,'request awaits AI log before returning');done();await p;ok(events[0][4].context.businessId==='b'&&events[0][4].context.campaignId==='c','log receives request business/campaign');
  fail=true;await assert.rejects(c.loggedAI('u','chatCampaign',{bizId:'b'},'prompt',{}));ok(events[1][4].failureType==='timeout'&&events[1][4].context.businessId==='b','chat provider failure logged with context before rejection');
}
function websiteTests(){
  const c={URL};vm.runInNewContext(read('public/website-utils.js'),c);
  ok(c.BBWebsite.normalize(' example.com ')==='https://example.com','bare website normalized');
  ok(!!c.BBWebsite.error('',true)&&!c.BBWebsite.error('',false),'online website required while explicit No may omit it');
  for(const bad of ['javascript:alert(1)','ftp://example.com','not a website','https://user:pass@example.com'])ok(!!c.BBWebsite.error(bad,true),'invalid website rejected '+bad);
  const html=read('public/BlastyBiz-Profile.html');ok(html.includes('BlastyBiz-CreateBiz.html')&&html.includes('location.replace'),'retired profile routes to canonical validated form; website branches covered by setup suite');
}
async function destinationTests(){
  const saved=new Map(),guard=read('public/auth-guard.js');
  const c={URLSearchParams,JSON,sessionStorage:{setItem:(k,v)=>saved.set(k,v)},window:{location:{pathname:'/BlastyBiz.html',search:'?bizId=b&draftId=d&ownerUid=u'}}};
  vm.runInNewContext(read('public/auth-return.js').replace(/^export /gm,''),c);
  vm.runInNewContext(cut(guard,'function rememberDraftDestination','// Safety valve:'),c);c.rememberDraftDestination();
  ok(JSON.parse(saved.get('bb_draft_return')).params.draftId==='d','auth redirect retains exact draft destination');
  const d={restoreAuthReturn:c.restoreAuthReturn,db:{},doc(){},getDoc:async()=>({exists:()=>true}),localStorage:{removeItem(){}},URLSearchParams,JSON,sessionStorage:{getItem:k=>saved.get(k),removeItem:k=>saved.delete(k)},window:{location:{href:''},showToast(){}},showLoginForm(){}};
  vm.runInNewContext(cut(read('public/BlastyBiz-Login.html'),'async function afterAuth','function showLoginForm'),d);
  await d.afterAuth({uid:'other'});ok(!d.window.location.href&&saved.has('bb_draft_return'),'different signed-in account cannot consume draft return');
  await d.afterAuth({uid:'u'});ok(d.window.location.href==='BlastyBiz.html?bizId=b&ownerUid=u&draftId=d'&&!saved.size,'sign-in resumes exact draft in correct account');
  const html=read('public/BlastyBiz.html'),e={window:{_bbLoadDraft:async()=>({campaignId:'c',campaignName:'Original',adaptations:{facebook:'Saved copy'},enabledPlatforms:['facebook'],schedule:{enabled:false}})},campaigns:[{id:'c',name:'Original'}],platforms:[{id:'facebook'},{id:'google'}],selectCampaign:(id)=>e.selected=id,loadQuickSchedFromDraft:s=>e.schedule=s,showToast(){},showTab(){},createWizGoTo(){},console:quiet};
  vm.runInNewContext(cut(html,'async function loadHistoryDraft','function timeAgo'),e);await e.loadHistoryDraft('d');
  ok(e.window._currentDraftId==='d'&&e.selected==='c'&&e.platforms[0].adaptedContent==='Saved copy'&&e.platforms[0].enabled&&!e.platforms[1].enabled,'draft loader restores exact campaign, copy, destinations and schedule');
}
(async()=>{calendarTests();await emailTests();await scheduleSaveTests();await publisherTests();await allowanceTests();await logTests();websiteTests();await destinationTests();console.log(`PASS: ${checks} Pass 7 focused assertions.`);})().catch(e=>{console.error(e);process.exitCode=1;});
