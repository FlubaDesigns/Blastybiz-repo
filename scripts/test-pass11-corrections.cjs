'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {database,admin}=require('./lib/test-firestore.cjs');
const service=require('../functions/lib/lifecycle');
const {configure}=require('./migrate-pass11.cjs');
const {rollupCosts}=require('../functions/lib/ai-rollups');
let checks=0;function ok(value,message){assert.ok(value,message);checks++;}
const B='users/u/businesses/b',D=B+'/listingDrafts/',J=B+'/publishJobs/';
const cutoff='2026-01-01T00:00:00.000Z',after='2026-01-02T00:00:00.000Z';
function fixture(seed={},override){
 const m=database({'users/u':{email:'test@example.com'},[B]:{},...seed}),sent=[],errors=[];
 let transactions=0;const run=m.db.runTransaction.bind(m.db);m.db.runTransaction=fn=>{transactions++;return run(fn);};
 const out={};const shared={db:m.db,admin,onRequest:(_,fn)=>fn,withAuth:fn=>fn,sendResendEmail:async e=>sent.push(e)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../functions/modules/lifecycle'),'utf8'),{exports:out,console:{error:(...args)=>errors.push(args)},require:name=>{
   if(name==='../lib/shared')return shared;
   if(name==='../lib/schedule-image')return require('../functions/lib/schedule-image');
   if(name==='firebase-functions/v2/firestore')return {onDocumentWritten:(_,fn)=>fn};
   if(name==='../lib/lifecycle')return override||service;
   if(name==='../lib/ai-rollups')return {rollupCosts};
   throw Error('Unexpected import '+name);
 }});
 return {...m,sent,errors,module:out,worker:out._worker,transactions:()=>transactions};
}
function blastSeed(id,extra={}){return {[D+id]:{status:'approved',startedAt:after,...extra},[J+id]:{draftId:id,status:'manual_required',platform:'craigslist'}};}
async function main(){
 for(const config of [undefined,{}, {remindersStartAt:'invalid'}]){
   const f=fixture({...blastSeed('old',{startedAt:'2020-01-01',reminders:{finalSentAt:'2020-01-03'}}),...(config?{'config/lifecycle':config}:{})});
   const before=JSON.stringify(f.all());await f.worker.runManualReminders();
   await f.worker.lifecycle.notify(f.db.doc(D+'old'),'lapse');
   ok(f.transactions()===0,'missing/invalid cutoff does not enter transactions');
   ok(f.sent.length===0&&JSON.stringify(f.all())===before,'missing/invalid cutoff cannot email or mutate old work');
 }
 let f=fixture({'config/lifecycle':{remindersStartAt:cutoff},...blastSeed('old',{startedAt:'2020-01-01',reminders:{finalSentAt:'2020-01-03'}}),...blastSeed('missing',{startedAt:null}),...blastSeed('done',{completedAt:after}),[D+'terminal']:{status:'approved',startedAt:after},[J+'terminal']:{draftId:'terminal',status:'manual_posted'}});
 const before=JSON.stringify(Object.fromEntries(Object.entries(f.all()).filter(([p])=>!p.startsWith('maintenance/'))));
 await f.worker.runManualReminders();
 for(const kind of ['ready','first','final','lapse'])await f.worker.lifecycle.notify(f.db.doc(D+'old'),kind);
 ok(f.transactions()===0,'historical, missing-date, completed and no-manual-work drafts skip transactions');
 ok(f.sent.length===0,'old drafts never email');
 ok(JSON.stringify(Object.fromEntries(Object.entries(f.all()).filter(([p])=>!p.startsWith('maintenance/'))))===before,'historical records and jobs stay unchanged');
 f=fixture({'config/lifecycle':{remindersStartAt:cutoff},...blastSeed('new',{startedAt:null,approvedAt:{stamp:Date.parse(after)}})});
 await f.worker.runManualReminders();await f.worker.runManualReminders();
 ok(f.sent.length===1,'new approvedAt Timestamp work receives exactly one ready email');
 ok(f.get(D+'new').reminders.readySentAt,'eligible work records the sent stage');
 ok(service.remindersEligible({status:'approved',startedAt:cutoff},{remindersStartAt:cutoff}),'cutoff equality is eligible');
 ok(!service.remindersEligible({status:'approved',startedAt:'2020-01-01',approvedAt:after},{remindersStartAt:cutoff}),'old startedAt cannot be bypassed by later approvedAt');
 const migration=database({'config/plans':{aiLimits:{pro:17}}});
 const dry=await configure(migration.db,false,()=>new Date(cutoff));
 ok(dry.patch.remindersStartAt&&!migration.get('config/lifecycle'),'dry-run does not enable reminders');
 await Promise.all([configure(migration.db,true,()=>new Date(cutoff)),configure(migration.db,true,()=>new Date(after))]);
 ok(migration.get('config/lifecycle').remindersStartAt===cutoff,'concurrent migration retains first applied cutoff');
 await configure(migration.db,true,()=>new Date('2030-01-01'));
 ok(migration.get('config/lifecycle').remindersStartAt===cutoff,'rerun cannot move rollout cutoff');
 ok(migration.get('config/plans').aiLimits.pro===17&&migration.get('config/plans').aiLimits.agency===5000,'migration preserves explicit limits and fills absent ones');
 const future=new Date(Date.now()+10*86400000).toISOString(),ads={};
 for(let i=0;i<500;i++)ads[B+'/campaigns/c/ads/a'+i]={schedule:{enabled:true,nextRunAt:future}};
 f=fixture(ads);await f.worker.runSchedules();await f.worker.runSchedules(false);
 ok(f.transactions()===0,'500 far-future unprepared Ads produce zero lifecycle transactions in both workers');
 ok(f.sent.length===0,'far-future unprepared Ads cannot send previews');
 const calls=[];f=fixture({[B+'/campaigns/c/ads/due']:{schedule:{enabled:true,nextRunAt:new Date().toISOString()}},[B+'/campaigns/c/ads/prepared']:{schedule:{enabled:true,nextRunAt:future,preparedBlastId:'next'}}},{...service,createLifecycle:()=>({queue:async ref=>calls.push(ref.id),notify:async()=>{}})});
 await f.worker.runSchedules();ok(calls.includes('due')&&calls.includes('prepared'),'due and already-prepared Ads still reach lifecycle processing');
 const sharedSource=fs.readFileSync(require.resolve('../functions/lib/shared'),'utf8'),logs=[];
 const context={db:{collection:name=>name==='users'?{doc:()=>({get:async()=>({data:()=>({plan:'pro'})})})}:{add:async row=>logs.push(row)}},admin,console};
 vm.createContext(context);vm.runInContext(sharedSource.slice(sharedSource.indexOf('const AI_COSTS ='),sharedSource.indexOf('// ── AI provider settings')),context);
 const purposes={adaptListing:'first_generation',scheduledRefresh:'scheduled_refresh',suggestCategory:'category_suggest',resolveCategories:'category_suggest',extractBizContext:'story_extract',suggestPlatforms:'suggest_platforms',generateEnrichmentQuestions:'story_extract',chatCampaign:'campaign_chat',previewAds:'ad_preview',scoreFact:'fact_score',unknownOperation:'other'};
 for(const [fn,purpose]of Object.entries(purposes)){await context.trackAiUsage('u',fn,'gpt-4o',{input_tokens:1000,output_tokens:1000});ok(logs.at(-1).purpose===purpose,fn+' attributed correctly');}
 await context.trackAiUsage('u','adaptListing','gpt-4o',{input_tokens:1000,output_tokens:1000},{context:{purpose:'owner_regeneration'}});
 ok(logs.at(-1).purpose==='owner_regeneration'&&logs.at(-1).costUsd===0.0125,'explicit purpose wins and stored cost calculation is unchanged');
 await context.trackAiUsage('u','chatCampaign','gpt-4o',null,{failureType:'provider_error'});
 ok(logs.at(-1).purpose==='campaign_chat'&&logs.at(-1).failureType==='provider_error'&&logs.at(-1).costUsd===0,'failed calls retain truthful purpose');
 const rollup=rollupCosts(logs).businesses[0];ok(rollup.purpose.campaign_chat.callCount===2&&rollup.purpose.ad_preview.callCount===1&&rollup.purpose.fact_score.callCount===1,'rollups preserve distinct diagnostic purposes');
 const html=fs.readFileSync(require.resolve('../public/BlastyBiz-Choose-Plan.html'),'utf8');
 function render(aiLimits){const els=Object.fromEntries(['cp-plans','cp-billing','cp-foot'].map(id=>[id,{classList:{remove(){}}}]));vm.runInNewContext(html.slice(html.indexOf('function renderPlans()'),html.indexOf('// ── Actions'))+'\nrenderPlans();',{document:{getElementById:id=>els[id]},planOptions:{aiLimits},billingPeriod:'monthly',picked:[],escHtml:String,money:String});return els['cp-plans'].innerHTML;}
 const fallback=render();for(const n of [100,1000,5000])ok(fallback.includes('>'+n+' AI writes a month<'),'plan fallback '+n+' matches server');
 const custom=render({starter:0,pro:17,agency:23});for(const n of [0,17,23])ok(custom.includes('>'+n+' AI writes a month<'),'configured limit '+n+' wins');
 for(const [error,status,message]of [[Object.assign(Error('Choose a valid Blast.'),{httpStatus:400}),400,'Choose a valid Blast.'],[Error('Firestore secret implementation detail'),500,'That could not be saved. Try again.']]){
   f=fixture({}, {...service,createLifecycle:()=>({manage:async()=>{throw error;}})});let code=200,body;
   const res={status:n=>{code=n;return res;},json:value=>{body=value;return res;}};
   await f.module.manageBlast({body:{}},res,{uid:'u'});
   ok(code===status&&body.error===message,'HTTP error status and safe body');
   ok(status===500?f.errors[0][1]===error:f.errors.length===0,'unexpected error logged server-side; validation not logged');
 }
 console.log(checks+' Pass 11 correction assertions passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
