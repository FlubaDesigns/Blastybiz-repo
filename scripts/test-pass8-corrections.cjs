'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {database,admin}=require('./lib/test-firestore.cjs');
const read=p=>fs.readFileSync(p,'utf8');
function cut(s,a,b){const start=s.indexOf(a),end=s.indexOf(b,start);assert(start>=0&&end>start,'fixture source boundaries');return s.slice(start,end);}
const quiet={log(){},warn(){},error(){}};
let checks=0,failed=0;
const ok=(v,m)=>{assert(v,m);checks++;};
const result=()=>({code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
function server(seed={}){
 const state=database(seed),{db}=state;
 const c={db,admin,crypto,Date,console:quiet,exports:{},onRequest:(_,f)=>f,withAuth:f=>f,userBizRef:(u,b)=>db.doc(`users/${u}/businesses/${b}`),userBizCol:u=>db.collection(`users/${u}/businesses`),getPlanConfig:async()=>({bizLimits:{starter:1,pro:3}})};
 vm.runInNewContext(cut(read('functions/modules/business.js'),'exports.createBusiness =','exports.deleteBusiness ='),c);
 return {state,c};
}
async function dashboard(){
 const e=server({'users/u':{},'users/u/businesses/b':{activeCampaign:'c'},'users/u/businesses/b/campaigns/c':{status:'active'},'users/u/businesses/b/listingDrafts/d':{campaignId:'c',schedule:{enabled:true}}});
 const calls=[],reloads=[],messages=[];let mode='ok',confirmation='';
 const c={window:{activeBizId:'b'},currentUser:{uid:'u',getIdToken:async()=> 'token'},console:quiet,confirm:text=>{confirmation=text;return true;},showToast:text=>messages.push(text),loadBusinessContextFirestore:async id=>reloads.push(id),db:e.c.db,doc:(db,...p)=>db.doc(p.join('/')),deleteDoc:async()=>{throw Error('permission-denied');},fetch:async(url,options)=>{
  calls.push({url,...options});if(mode==='offline')throw Error('offline');if(mode==='html')return {ok:false,json:async()=>{throw Error('HTML response');}};
  const r=result();await e.c.exports.deleteCampaign({method:options.method,body:JSON.parse(options.body)},r,{uid:'u'});return {ok:r.code===200,status:r.code,json:async()=>r.body};
 }};
 vm.runInNewContext(cut(read('public/BlastyBiz-Dashboard.html'),'  window.deleteCampaign =','  window.deleteBusiness ='),c);
 await c.window.deleteCampaign('c');
 ok(calls.length===1&&calls[0].url.endsWith('/deleteCampaign')&&calls[0].headers.Authorization==='Bearer token','Dashboard uses authenticated archive endpoint');
 ok(e.state.get('users/u/businesses/b/campaigns/c').status==='archived'&&!e.state.get('users/u/businesses/b/listingDrafts/d').schedule.enabled,'Dashboard removal archives and stops scheduled drafts');
 ok(reloads.length===1&&confirmation==='Remove campaign? Scheduled posts will stop. Its history will be kept.','Dashboard reloads only after success and explains history retention');
 mode='html';await c.window.deleteCampaign('c');ok(reloads.length===1&&messages.at(-1).includes('Could not'),'non-JSON HTTP failure keeps current list');
 mode='offline';await c.window.deleteCampaign('c');ok(reloads.length===1,'network failure does not remove the campaign locally');
 mode='ok';await c.window.deleteCampaign('c');ok(reloads.length===2,'Dashboard removal remains retryable');
}
function onboardingEnv(seed,addingNew=false){
 const e=server(seed),calls=[],messages=[],button={disabled:false,textContent:''};let mode='ok',cleared=0;
 const c={window:{currentStep:6,_buildProfileData:()=>({businessName:'Test',updatedAt:1}),escHtml:s=>s},currentUser:{uid:'u',getIdToken:async()=> 'token'},crypto,console:quiet,document:{getElementById:id=>id==='btn-next'?button:null,querySelector:()=>null},showToast:m=>messages.push(m),_isNew:()=>addingNew,_clearDraft:()=>cleared++,db:e.c.db,collection:(db,...p)=>db.collection(p.join('/')),doc:(db,...p)=>db.doc(p.join('/')),getDocs:q=>q.get(),getDoc:async ref=>{const s=await ref.get();return {...s,exists:()=>s.exists};},fetch:async(url,options)=>{
  calls.push({url,...options,body:JSON.parse(options.body)});if(mode==='offline')throw Error('offline');
  const r=result();await e.c.exports.createBusiness({method:options.method,body:JSON.parse(options.body)},r,{uid:'u'});if(mode==='lost-response')throw Error('response lost after commit');return {ok:r.code===200,status:r.code,json:async()=>r.body};
 }};
 vm.runInNewContext(cut(read('public/BlastyBiz-Onboarding.html'),'const origNextStep =','</script>'),c);
 const submit=c.window.nextStep;
 return {...e,c,calls,messages,button,submit,setMode:m=>mode=m,cleared:()=>cleared};
}
async function onboarding(){
 let e=onboardingEnv({'users/u':{plan:'starter'}});await e.submit();
 ok(e.calls[0].body.bizId&&e.calls[0].body.isNew===true&&e.cleared()===1,'default first-time onboarding sends a stable ID and creation mode');
 ok(e.state.get('users/u').activeBusiness===e.calls[0].body.bizId,'first-time Onboarding actually creates a business through the server');
 e=onboardingEnv({'users/u':{plan:'pro'}},true);e.setMode('lost-response');await e.submit();const id=e.calls[0].body.bizId;
 ok(e.cleared()===0&&!e.button.disabled,'lost response retains form and enables retry');
 e.setMode('ok');await e.submit();ok(e.calls[1].body.bizId===id&&Object.keys(e.state.all()).filter(p=>/^users\/u\/businesses\/[^/]+$/.test(p)).length===1,'retry after committed save reuses the same business ID');
 e=onboardingEnv({'users/u':{plan:'starter',activeBusiness:'saved'},'users/u/businesses/saved':{onboarded:false}});await e.submit();
 ok(e.calls[0].body.bizId==='saved'&&e.calls[0].body.isNew===false&&e.cleared()===1,'unfinished active business is resumed rather than duplicating capacity');
 e=onboardingEnv({'users/u':{plan:'starter'},'users/u/businesses/u':{onboarded:false}});await e.submit();ok(e.calls[0].body.bizId==='u'&&e.cleared()===1,'legacy UID-based unfinished business still saves');
 e=onboardingEnv({'users/u':{plan:'starter'},'users/u/businesses/existing':{onboarded:true}},true);await e.submit();ok(e.cleared()===0&&!e.button.disabled&&!e.state.get('users/u').activeBusiness,'Add New still enforces capacity and retains answers on rejection');
 e=onboardingEnv({'users/u':{plan:'starter'}});e.c.currentUser=null;await e.submit();ok(!e.calls.length&&e.cleared()===0,'signed-out completion cannot show false save success');
}
const NOW=Date.parse('2026-09-29T12:00:00Z');
function payment(id,age=0,order='missing'){return {event_id:id,type:'payment.updated',created_at:new Date(NOW-age).toISOString(),data:{object:{payment:{id:'payment-'+id,status:'COMPLETED',order_id:order,customer_id:'customer'}}}};}
function paymentEnv(seed={}){
 const e=server(seed),logs=[];
 e.c.Date=class extends Date{constructor(...a){super(...(a.length?a:[NOW]));}static now(){return NOW;}};
 e.c.console={...quiet,error:(...a)=>logs.push(a)};e.c.process={env:{SQUARE_WEBHOOK_SIGNATURE_KEY:'fixture-key'}};e.c.Buffer=Buffer;
 vm.runInNewContext(cut(read('functions/modules/payments.js'),'async function applySquareEvent','exports.adminUpdatePricing ='),e.c);
 const send=async event=>{const body=JSON.stringify(event),signature=crypto.createHmac('sha256','fixture-key').update('https://us-central1-blastybiz-9523e.cloudfunctions.net/squareWebhook'+body).digest('base64'),r=result();await e.c.exports.squareWebhook({body:event,rawBody:Buffer.from(body),headers:{'x-square-hmacsha256-signature':signature}},r);return r;};
 return {...e,send,logs};
}
async function missingCheckout(){
 let e=paymentEnv();let r=await e.send(payment('recent',24*3600000-1));ok(r.code===503&&!e.state.get('webhookEvents/recent'),'recent missing checkout retries until the 24-hour boundary');
 const event=payment('aged',24*3600000);r=await e.send(event);const record=e.state.get('webhookEvents/aged');
 ok(r.code===200&&record.status==='completed'&&record.unlinked===true,'24-hour missing checkout becomes durably completed and unlinked');
 ok(record.orderId==='missing'&&record.paymentId==='payment-aged'&&record.customerId==='customer'&&record.reason==='checkout_missing','unlinked record retains reconciliation identifiers');
 ok(e.logs.some(a=>a.some(x=>typeof x==='object'&&x.eventId==='aged')),'aged unmatched payment emits an error after commit');
 const writes=e.state.writes.length;await e.send(event);ok(e.state.writes.length===writes,'unlinked payment redelivery is a terminal no-op');
 e=paymentEnv();e.state.failNext();r=await e.send(event);ok(r.code===503&&!e.state.get('webhookEvents/aged'),'failure to save the unlinked receipt still retries');
 r=await e.send(event);ok(r.code===200&&e.state.get('webhookEvents/aged').unlinked,'retry after ledger failure can complete');
 e=paymentEnv();r=await e.send(payment('future',-3600000));ok(r.code===503,'future timestamp is not falsely treated as an old payment');
 const malformed=payment('bad-time');malformed.created_at='invalid';r=await e.send(malformed);ok(r.code===200&&e.state.get('webhookEvents/bad-time').status==='needs_review','invalid timestamp is retained for review instead of an endless retry');
}
async function sharedCustomer(){
 const path='webhookEvents/customer_'+crypto.createHash('sha256').update('customer').digest('hex');
 const seed={'users/u':{plan:'starter'},'users/v':{plan:'pro'},'users/u/businesses/b':{currentPlan:'starter'},'subscriptions/v':{status:'active',squareSubscriptionId:'other-sub'},'pendingCheckouts/order':{uid:'u',plan:'pro'},[path]:{recordType:'customer',uid:'v'}};
 let e=paymentEnv(seed),event=payment('conflict',0,'order'),r=await e.send(event),record=e.state.get('webhookEvents/conflict');
 ok(r.code===200&&record.status==='needs_review','shared customer acknowledges a durable needs-review entry');
 ok(record.uid==='u'&&record.linkedUid==='v'&&record.orderId==='order'&&record.paymentId==='payment-conflict','shared customer record identifies both accounts and payment');
 ok(e.state.get(path).uid==='v'&&e.state.get('users/u').plan==='starter'&&e.state.get('users/v').plan==='pro'&&!e.state.get('pendingCheckouts/order').fulfilledPaymentId&&!e.state.get('subscriptions/u'),'conflict does not transfer customer, grant entitlements or mark checkout fulfilled');
 ok(e.logs.some(a=>a.some(x=>typeof x==='object'&&x.eventId==='conflict')),'shared customer logs the review requirement');
 const writes=e.state.writes.length;await e.send(event);ok(e.state.writes.length===writes&&e.state.get('webhookEvents/conflict').status==='needs_review','redelivery retains review state without new mutations');
 e=paymentEnv(seed);e.state.failNext();r=await e.send(event);ok(r.code===503&&!e.state.get('webhookEvents/conflict'),'review ledger commit failure cannot be falsely acknowledged');
 r=await e.send(event);ok(r.code===200&&e.state.get('webhookEvents/conflict').status==='needs_review','conflict retry succeeds when durable ledger recovers');
}
(async()=>{for(const [name,run] of Object.entries({dashboard,onboarding,missingCheckout,sharedCustomer})){try{await run();console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}console.log(`${checks} correction assertions passed; ${failed} scenarios failed.`);process.exitCode=failed?1:0;})();
