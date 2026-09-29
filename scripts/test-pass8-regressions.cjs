'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {database,admin}=require('./lib/test-firestore.cjs');
const read=p=>fs.readFileSync(p,'utf8'),cut=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const quiet={log(){},error(){},warn(){}};let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};
const result=()=>({code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}});
function context(seed={}){
 const state=database(seed),{db}=state;
 const c={db,admin,console:quiet,crypto,Date,require:p=>require('../functions/lib/ads'),exports:{},onRequest:(_,f)=>f,withAuth:f=>f,onSchedule:(_,f)=>f,onDocumentCreated:(_,f)=>f,onDocumentUpdated:(_,f)=>f,
 userBizRef:(u,b)=>db.doc(`users/${u}/businesses/${b}`),userBizCol:u=>db.collection(`users/${u}/businesses`),userBizJobsRef:(u,b)=>db.collection(`users/${u}/businesses/${b}/publishJobs`),
 getPlanConfig:async()=>({bizLimits:{starter:1,pro:3,agency:10}}),...require('../functions/lib/schedule'),
 PLATFORM_CAPABILITY_MAP:require('../functions/lib/platforms').PLATFORM_CAPABILITY_MAP,sendResendEmail:async()=>{},APP_BASE_URL:'https://example.com'};
 return {state,c};
}
async function businessTests(){
 let e=context({'users/u':{plan:'starter'}});vm.runInNewContext(cut(read('functions/modules/business.js'),'exports.createBusiness =','exports.deleteBusiness ='),e.c);
 const run=async(body)=>{const r=result();await e.c.exports.createBusiness({method:'POST',body},r,{uid:'u'});return r;};
 const make=id=>({bizId:id,isNew:true,profileData:{name:'Test',email:'business@example.com',plan:'agency'},campaignData:{id:'c',name:'Campaign'}});
 const both=await Promise.all([run(make('a')),run(make('b'))]);ok(both.filter(r=>r.code===200).length===1,'concurrent starter creation permits exactly one business');
 const saved=both.find(r=>r.code===200).body.bizId;ok(!e.state.get(`users/u/businesses/${saved}`).plan,'business creation ignores server-owned plan injection');
 ok(e.state.get('users/u').activeBusiness===saved&&e.state.get(`users/u/businesses/${saved}/campaigns/c`).uid==='u','business, account pointer and first campaign commit together');
 ok((await run(make(saved))).code===200&&e.state.get('users/u').businessIds.length===1,'same stable creation ID retries without spending capacity');
 ok((await run({...make('other'),isNew:false})).code===404,'update mode cannot bypass business limit');
 e.state.failNext();ok((await run({...make(saved),profileData:{name:'Changed'}})).code===500&&e.state.get(`users/u/businesses/${saved}`).name==='Test','failed transaction leaves prior details intact');
 e=context({'users/u':{plan:'starter'},'users/u/businesses/a':{onboarded:false}});vm.runInNewContext(cut(read('functions/modules/business.js'),'exports.createBusiness =','exports.deleteBusiness ='),e.c);
 ok((await run(make('b'))).code===403,'unfinished business counts toward capacity');
 ok((await run({...make('a'),isNew:false})).code===200,'ordinary existing-business editing remains available at capacity');
 const rules=read('firestore.rules');ok(cut(rules,'match /businesses/{bizId}','allow update:').includes('allow create: if isAdmin();'),'browser cannot bypass server creation');
}
const draftPath='users/u/businesses/b/listingDrafts/d';
function scheduledEnv(extra={}){
 const now=new Date(),e=context({'users/u':{plan:'pro'},'users/u/businesses/b':{approvalCount:0},'users/u/businesses/b/campaigns/c':{status:'active'},[draftPath]:{campaignId:'c',enabledPlatforms:['facebook'],adaptations:{facebook:'Selected copy',google:'Unselected old copy'},imagesByPlatform:{facebook:['https://example.com/photo.jpg']},schedule:{enabled:true,frequency:'daily',timeSlot:'morning',approved:true,nextRunAt:new Date(now-3600000).toISOString()},...extra}});
 vm.runInNewContext(cut(read('functions/modules/scheduled.js'),'async function* scheduledDraftPages','// ── scheduledDraftPreview'),e.c);return {...e,now};
}
async function scheduleTests(){
 let e=scheduledEnv(),run=()=>e.c.queueScheduledDraft(e.c.db.doc(draftPath),e.now);
 await Promise.all([run(),run()]);let jobs=Object.entries(e.state.all()).filter(([p])=>p.includes('/publishJobs/'));ok(jobs.length===1,'overlapping workers create one job for one occurrence');
 const job=jobs[0][1];ok(job.platform==='facebook'&&job.payload.adaptedContent==='Selected copy'&&job.payload.imageUrls[0].endsWith('photo.jpg'),'selected destination and images preserved in normal publisher payload');
 ok(e.state.get(draftPath).schedule.nextRunAt>e.now.toISOString()&&!e.state.get(draftPath).schedule.approved,'cycle advances with durable jobs and consumes approval');
 ok(Object.entries(e.state.all()).some(([p,v])=>p.includes('/private/')&&v.jobIds[0]===job.jobId),'cycle receipt links durable per-destination results');
 await e.c.db.doc(jobs[0][0]).update({status:'failed'});await run();ok(Object.entries(e.state.all()).filter(([p])=>p.includes('/publishJobs/')).length===1&&e.state.get(jobs[0][0]).status==='failed','failed work stays actionable without recreating or reposting the cycle');
 e=scheduledEnv();e.state.failNext();await assert.rejects(run());ok(e.state.get(draftPath).schedule.approved&&!Object.keys(e.state.all()).some(p=>p.includes('/publishJobs/')),'failed enqueue transaction does not advance the cycle');await run();ok(Object.keys(e.state.all()).some(p=>p.includes('/publishJobs/')),'failed enqueue retries successfully');
 e=scheduledEnv({enabledPlatforms:[]});await run();ok(!e.state.get(draftPath).schedule.enabled&&!Object.keys(e.state.all()).some(p=>p.includes('/publishJobs/')),'missing saved destinations pauses instead of publishing old copy');
 e=scheduledEnv({enabledPlatforms:['facebook','google'],adaptations:{facebook:'copy'}});await run();ok(!e.state.get(draftPath).schedule.enabled&&!Object.keys(e.state.all()).some(p=>p.includes('/publishJobs/')),'missing selected copy pauses atomically');
 e=scheduledEnv({enabledPlatforms:['yelp'],adaptations:{yelp:'Manual copy'}});await run();jobs=Object.entries(e.state.all()).filter(([p])=>p.includes('/publishJobs/'));ok(jobs[0][1].status==='manual_required','selected manual destinations retain actionable jobs');
 e=scheduledEnv();await e.c.db.doc('users/u/businesses/b/campaigns/c').update({status:'archived'});await run();ok(!e.state.get(draftPath).schedule.enabled,'archived campaign stops future scheduled jobs');
 const source=read('functions/modules/scheduled.js');ok(!source.includes('async function publishFacebook')&&!source.includes('_runScheduledPost'),'duplicate scheduled publisher adapters removed');
 // Invalid schedules must remain isolated after changing from inline publishing to jobs.
 for(const bad of [{timeSlot:'bad'},{timezone:'Bad/Zone'},{frequency:'weekly',dayOfWeek:9},{frequency:'monthly',dayOfMonth:0}]){
   e=scheduledEnv();await e.c.db.doc(draftPath).update({'schedule':{...e.state.get(draftPath).schedule,...bad}});await run();ok(!e.state.get(draftPath).schedule.enabled&&!!e.state.get(draftPath).schedule.pauseReason,'invalid schedule pauses with reason');
 }
}
async function dispatchTests(){
 const source=read('functions/modules/publishing.js');let e=scheduledEnv(),calls=[];
 await e.c.queueScheduledDraft(e.c.db.doc(draftPath),e.now);
 let jobPath=Object.keys(e.state.all()).find(p=>p.includes('/publishJobs/'));
 await e.c.db.doc('users/u/businesses/b/platformConnections/facebook').set({status:'connected',pageId:'page',accessToken:'test'});
 e.c.userBizConnsRef=(u,b)=>e.c.db.collection('users/'+u+'/businesses/'+b+'/platformConnections');e.c._getConnTokens=async()=>({});
 e.c.axios={post:async(url,data)=>{calls.push({url,data});return {data:{id:'published'}}}};
 vm.runInNewContext(cut(source,'async function _publicationPost','// Export for use'),e.c);
 vm.runInNewContext(cut(source,'exports.dispatchPublishJob =','exports.jobFailedTrigger ='),e.c);
 const event=()=>({data:{data:()=>({status:'pending'}),ref:e.c.db.doc(jobPath)},params:{userId:'u',bizId:'b',jobId:jobPath.split('/').at(-1)}});
 await e.c.exports.dispatchPublishJob(event());await e.c.exports.dispatchPublishJob(event());
 ok(e.state.get(jobPath).status==='success'&&calls.length===1&&calls[0].data.url==='https://example.com/photo.jpg','scheduled job uses normal image publisher once and records success');
 // A different destination can fail without replaying the successful job.
 const second=jobPath+'second';await e.c.db.doc(second).set({...e.state.get(jobPath),jobId:'second',status:'pending'});jobPath=second;
 e.c.axios.post=async()=>{throw Object.assign(Error('refused'),{code:'ECONNREFUSED'});};
 await assert.rejects(e.c.exports.dispatchPublishJob(event()));ok(e.state.get(second).status==='pending'&&e.state.get(second).retryCount===1,'definite connection failure retains retryable scheduled job');
 e.c.axios.post=async()=>{throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});};await e.c.exports.dispatchPublishJob(event());ok(e.state.get(second).publicationUncertain&&e.state.get(second).status==='manual_required','uncertain scheduled publication retains manual recovery');
 await e.c.db.doc(second).update({status:'pending',publicationUncertain:false});await e.c.db.doc('users/u/businesses/b/campaigns/c').update({status:'archived'});await e.c.exports.dispatchPublishJob(event());ok(e.state.get(second).status==='canceled','queued campaign job stops before external publish after archive');
 // Two successful destination notifications credit only one approved occurrence.
 vm.runInNewContext(cut(source,'exports.jobCompletedTrigger =','// ── Google Business Profile photo import'),e.c);
 if(e.c.exports.jobCompletedTrigger){
   const originalPath=Object.keys(e.state.all()).find(p=>p.includes('/publishJobs/')&&p!==second);
   const after=e.state.get(originalPath),notice={params:{userId:'u',bizId:'b'},data:{before:{data:()=>({status:'processing'})},after:{data:()=>after}}};
   await e.c.exports.jobCompletedTrigger(notice);await e.c.exports.jobCompletedTrigger(notice);
   ok(e.state.get('users/u/businesses/b').approvalCount===1,'approved scheduled occurrence counts once across completion redelivery');
   calls=[];e.c.axios.post=async(url,data)=>{calls.push({url,data});return {data:{id:'photo'+calls.length}}};
   await e.c._publishFacebookJob({payload:{adaptedContent:'Two photos',imageUrls:['https://example.com/a.jpg','https://example.com/b.jpg']}},{pageId:'page',accessToken:'test'});
   ok(calls.length===3&&calls[0].data.published===false&&calls[1].data.published===false&&calls[2].data.attached_media.length===2,'multi-photo Facebook post stages unpublished images then publishes once');
 }
}
async function pageTests(){
 const seed={};for(let i=0;i<5001;i++)seed[`users/u/businesses/b/listingDrafts/d${String(i).padStart(5,'0')}`]={schedule:{enabled:true,nextRunAt:'2026-01-01T00:00:00.000Z'}};
 seed['users/u/businesses/b/listingDrafts/future']={schedule:{enabled:true,nextRunAt:'2099-01-01T00:00:00.000Z'}};
 const e=context(seed);vm.runInNewContext(cut(read('functions/modules/scheduled.js'),'async function* scheduledDraftPages','async function queueScheduledDraft'),e.c);
 let count=0;for await(const page of e.c.scheduledDraftPages('cursor',new Date('2026-09-29')))count+=page.length;
 ok(count===5000&&e.state.get('maintenance/cursor'),'bounded worker saves progress through 25 pages');count=0;
 for await(const page of e.c.scheduledDraftPages('cursor',new Date('2026-09-29')))count+=page.length;
 ok(count===1&&!e.state.get('maintenance/cursor'),'next invocation reaches work after 5000 blocked records and wraps cursor');
 ok(e.state.reads.filter(q=>q.group).every(q=>q.filters.some(f=>f[0]==='schedule.nextRunAt'&&f[1]==='<=')),'future records excluded from due selection');
}
function paymentEvent(id,order='order'){return {event_id:id,type:'payment.updated',created_at:'2026-09-29T12:00:00Z',data:{object:{payment:{id:'payment',status:'COMPLETED',order_id:order,customer_id:'customer'}}}};}
function subscriptionEvent(id,subId='new',status='ACTIVE',version=1){return {event_id:id,type:status==='ACTIVE'?'subscription.created':'subscription.updated',created_at:'2026-09-29T12:00:00Z',data:{object:{subscription:{id:subId,status,version,customer_id:'customer',plan_variation_id:'plan',created_at:subId==='old'?'2026-01-01T00:00:00Z':'2026-09-29T11:00:00Z'}}}};}
function paymentEnv(){const e=context({'users/u':{plan:'starter'},'users/u/businesses/b':{currentPlan:'starter'},'pendingCheckouts/order':{uid:'u',plan:'pro',billingPeriod:'monthly',subscriptionPlanId:'plan',createdAt:{stamp:Date.parse('2026-09-29T10:00:00Z')}}});e.c.Date=class extends Date{constructor(...args){super(...(args.length?args:['2026-09-29T12:00:00Z']));}static now(){return Date.parse('2026-09-29T12:00:00Z');}};vm.runInNewContext(cut(read('functions/modules/payments.js'),'async function applySquareEvent','exports.squareWebhook ='),e.c);return e;}
async function paymentTests(){
 let e=paymentEnv();e.state.failNext();await assert.rejects(e.c.applySquareEvent(paymentEvent('paid')));ok(!e.state.get('webhookEvents/paid')&&e.state.get('users/u').plan==='starter'&&!e.state.get('pendingCheckouts/order').fulfilledPaymentId,'failed payment transaction retains linkage and no false completion');
 let effects=await Promise.all([e.c.applySquareEvent(paymentEvent('paid')),e.c.applySquareEvent(paymentEvent('paid'))]);ok(effects.filter(Boolean).length===1&&e.state.get('users/u').plan==='pro'&&e.state.get('subscriptions/u').status==='active','payment redelivery applies entitlements exactly once');
 ok(e.state.get('pendingCheckouts/order').fulfilledPaymentId==='payment'&&e.state.get('webhookEvents/paid').status==='completed'&&e.state.get('users/u/businesses/b').currentPlan==='pro','checkout linkage retained; event completes with all durable effects');
 e=paymentEnv();await e.c.applySquareEvent(subscriptionEvent('created'));ok(!e.state.get('subscriptions/u'),'early subscription waits in existing ledger');await e.c.applySquareEvent(paymentEvent('paid'));ok(e.state.get('subscriptions/u').squareSubscriptionId==='new','payment reconciles previously unmatched subscription');
 e=paymentEnv();await e.c.applySquareEvent(paymentEvent('paid'));await e.c.applySquareEvent(subscriptionEvent('created'));ok(e.state.get('subscriptions/u').squareSubscriptionId==='new','subscription also links when payment arrives first');
 await e.c.applySquareEvent(subscriptionEvent('old-cancel','old','CANCELED',2));ok(e.state.get('users/u').plan==='pro'&&e.state.get('subscriptions/u').squareSubscriptionId==='new','old subscription cancellation cannot revoke replacement');
 await e.c.applySquareEvent(subscriptionEvent('new-cancel','new','CANCELED',2));ok(e.state.get('users/u').plan==='starter'&&e.state.get('users/u/businesses/b').subscriptionStatus==='canceled','matching cancellation atomically revokes account and business entitlement');
 await e.c.applySquareEvent(subscriptionEvent('late-created','new','ACTIVE',1));ok(e.state.get('users/u').plan==='starter','older subscription version cannot undo cancellation');
 e=paymentEnv();await e.c.applySquareEvent(subscriptionEvent('cancel-first','new','CANCELED',2));await e.c.applySquareEvent(paymentEvent('paid'));ok(e.state.get('users/u').plan==='starter'&&e.state.get('subscriptions/u').status==='canceled','payment cannot resurrect already canceled subscription arriving out of order');
 e=paymentEnv();await assert.rejects(e.c.applySquareEvent(paymentEvent('missing','unknown')));ok(!e.state.get('webhookEvents/missing'),'missing checkout remains retryable rather than acknowledged completed');
 await e.c.db.doc('webhookEvents/legacy').set({receivedAt:1,type:'payment.updated'});await e.c.applySquareEvent(paymentEvent('legacy'));ok(e.state.get('users/u').plan==='pro','old received-only event can recover while linkage exists');
}
async function paymentBoundaryTests(){
 let e=paymentEnv();const legacy=subscriptionEvent('legacy-plan');legacy.data.object.subscription.plan_id='plan';legacy.data.object.subscription.plan_variation_id='variation';
 await e.c.applySquareEvent(legacy);await e.c.applySquareEvent(paymentEvent('legacy-paid'));
 ok(e.state.get('subscriptions/u').squareSubscriptionId==='new','legacy plan ID and current variation ID both support checkout linkage');
 e=paymentEnv();await e.c.applySquareEvent(paymentEvent('paid'));
 await e.c.applySquareEvent(subscriptionEvent('old-cancel','old','CANCELED',2));
 ok(e.state.get('users/u').plan==='pro'&&!e.state.get('subscriptions/u').squareSubscriptionId,'old cancellation cannot attach while replacement linkage is pending');
 await e.c.applySquareEvent(subscriptionEvent('new-created'));ok(e.state.get('subscriptions/u').squareSubscriptionId==='new','replacement links after old cancellation was ignored');
 const source=read('functions/modules/payments.js'),key='test-signature-key';e.c.process={env:{SQUARE_WEBHOOK_SIGNATURE_KEY:key}};e.c.Buffer=Buffer;
 vm.runInNewContext(cut(source,'exports.squareWebhook =','exports.adminUpdatePricing ='),e.c);
 const event=paymentEvent('retry-http','missing'),body=JSON.stringify(event),signature=crypto.createHmac('sha256',key).update('https://us-central1-blastybiz-9523e.cloudfunctions.net/squareWebhook'+body).digest('base64');
 let r=result();await e.c.exports.squareWebhook({rawBody:Buffer.from(body),body:event,headers:{'x-square-hmacsha256-signature':signature}},r);
 ok(r.code===503&&!e.state.get('webhookEvents/retry-http'),'HTTP webhook fails retryably if durable update cannot complete');
 r=result();await e.c.exports.squareWebhook({rawBody:Buffer.from(body),body:event,headers:{'x-square-hmacsha256-signature':'bad'}},r);ok(r.code===403,'webhook signature still required before any account mutation');
}

async function campaignTests(){
 const e=scheduledEnv();vm.runInNewContext(cut(read('functions/modules/business.js'),'exports.deleteCampaign =','exports.deleteBusiness ='),e.c);
 const r=result();await e.c.exports.deleteCampaign({method:'POST',body:{bizId:'b',campaignId:'c'}},r,{uid:'u'});
 ok(r.code===200&&e.state.get('users/u/businesses/b/campaigns/c').status==='archived'&&!e.state.get(draftPath).schedule.enabled,'removal archives campaign and pauses drafts without deleting history');
 const html=read('public/BlastyBiz.html');let fail=true;const messages=[];
 const c={window:{_bbDeleteCampaign:async()=>{if(fail)throw Error('offline');}},confirm:()=>true,campaigns:[{id:'c'}],activeCampaignId:'c',activeCampaignName:'Campaign',document:{getElementById:()=>({classList:{add(){}}})},showToast:m=>messages.push(m),renderCampaignChips(){}};
 vm.runInNewContext(cut(html,'const deletingCampaigns =','function _sortCampaigns()'),c);await c.deleteCampaign('c','Campaign');ok(c.campaigns.length===1&&c.activeCampaignId==='c'&&messages.at(-1).includes('retry'),'failed campaign delete keeps visible selection and retry');fail=false;await c.deleteCampaign('c','Campaign');ok(!c.campaigns.length&&!c.activeCampaignId&&messages.at(-1).includes('History kept'),'campaign removed only after successful server reply');
}
(async()=>{await businessTests();await scheduleTests();await dispatchTests();await pageTests();await paymentTests();await paymentBoundaryTests();await campaignTests();console.log(`PASS: ${checks} Pass 8 behavior assertions.`);})().catch(e=>{console.error(e);process.exitCode=1;});
