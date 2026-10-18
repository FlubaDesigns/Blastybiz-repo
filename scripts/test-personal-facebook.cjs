'use strict';
// Execute the actual delivery rules and handlers. No provider or live database calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const platforms=require('../functions/lib/platforms');
const {database,admin}=require('./lib/test-firestore.cjs');
const source=fs.readFileSync('functions/modules/publishing.js','utf8');
const req=createRequire(path.resolve('functions/modules/publishing.js'));
const personal={sellerType:'personal'},business={sellerType:'business'};
const B='users/u/businesses/b',D=B+'/listingDrafts/d';
function context(m){return {exports:{},require:req,console,Date,Set,admin,db:m.db,onRequest:(_,fn)=>fn,withAuth:fn=>fn,onDocumentCreated:(_,fn)=>fn,onDocumentUpdated:(_,fn)=>fn,
 userBizRef:(u,b)=>m.db.doc(`users/${u}/businesses/${b}`),userBizDraftsRef:(u,b)=>m.db.collection(`users/${u}/businesses/${b}/listingDrafts`),
 userBizJobsRef:(u,b)=>({doc:()=>m.db.doc(`users/${u}/businesses/${b}/publishJobs/j`)}),PLATFORM_CAPABILITY_MAP:platforms.PLATFORM_CAPABILITY_MAP};}
(async()=>{
 assert.equal(platforms.forBusiness('facebook',personal).deliveryMode,'manual');
 assert.equal(platforms.forBusiness('facebook',business).deliveryMode,'auto');
 assert.equal(platforms.forBusiness('instagram',personal).deliveryMode,'auto');
 assert.equal(platforms.normalizeSelection({id:'facebook',type:'api'},personal).type,'manual');
 assert.equal(platforms.byId.facebook.deliveryMode,'auto','personal overrides never mutate business capability');
 const config=fs.readFileSync('public/platforms-config.js','utf8').replace(/^import .*;$/m,'').replace(/export /g,'');
 const readiness={globalThis:{BBPlatforms:platforms},Date};vm.runInNewContext(config,readiness);
 assert.equal(readiness.deliveryReadiness('facebook',undefined,{business:personal}).state,'manual');
 assert.equal(readiness.deliveryReadiness('facebook',null,{business:business}).state,'connection');
 assert.equal(readiness.deliveryReadiness('facebook',{status:'connected',pageId:'123',expiresAt:null},{business:business}).state,'ready');
 for(const profile of [personal,business]){
   const m=database({'users/u':{plan:'agency'},[B]:profile,[D]:{uid:'u',status:'draft',adaptations:{facebook:'Prepared personal post'},platformStatus:{facebook:'approved'}}});
   const c=context(m);vm.runInNewContext(source.slice(source.indexOf('exports.approveDraft ='),source.indexOf('let dispatchHandler;')),c);
   const res={status(n){this.code=n;return this;},json(body){this.body=body;}};
   await c.exports.approveDraft({body:{businessId:'b',draftId:'d',platformKeys:['facebook']}},res,{uid:'u'});
   assert.equal(res.body.success,true);
   const job=m.get(B+'/publishJobs/j');
   assert.equal(job.status,profile.sellerType==='personal'?'manual_required':'pending');
   assert.equal(job.payload.adaptedContent,'Prepared personal post');
 }
 // A stale scheduled/API job for a personal seller must never read a Page token or publish.
 const m=database({[B]:personal,[B+'/publishJobs/j']:{status:'pending',platform:'facebook',payload:{adaptedContent:'Keep this copy'}}});
 const c=context(m);let providerCalls=0,connectionReads=0;
 c.userBizConnsRef=()=>{connectionReads++;throw Error('Personal profile must not request a Page connection');};
 c._publishFacebookJob=async()=>{providerCalls++;};
 vm.runInNewContext('let dispatchHandler;'+source.slice(source.indexOf('exports.dispatchPublishJob ='),source.indexOf('exports.jobFailedTrigger =')),c);
 const ref=m.db.doc(B+'/publishJobs/j');
 await c.exports.dispatchPublishJob({data:await ref.get(),params:{userId:'u',bizId:'b',jobId:'j'}});
 assert.equal(m.get(ref.path).status,'manual_required');assert.equal(connectionReads,0);assert.equal(providerCalls,0);
 assert.equal(m.get(ref.path).payload.adaptedContent,'Keep this copy');
 // Execute the real card and clipboard handlers with isolated DOM/clipboard objects.
 const app=fs.readFileSync('public/BlastyBiz.html','utf8');
 const ui={window:{},profile:personal,document:{createElement:()=>({}),getElementById:()=>null},escHtml:v=>String(v),showToast(){},navigator:{clipboard:{writeText:async text=>{ui.copied=text;}}},setTimeout:fn=>fn()};
 ui.window.open=url=>{ui.opened=url;};
 ui.platforms=[platforms.normalizeSelection({id:'facebook',enabled:true,adaptedContent:'Line one<br/>Line two'},personal)];
 ui.PLATFORM_DEFAULT_URLS={facebook:'https://www.facebook.com/'};
 vm.runInNewContext(app.slice(app.indexOf('function buildPlatformCard(p)'),app.indexOf('function renderQuickSelect()')),ui);
 const card=ui.buildPlatformCard(ui.platforms[0]);assert.match(card.innerHTML,/Copy & open Facebook/);assert.doesNotMatch(card.innerHTML,/Manage connection/);
 vm.runInNewContext(app.slice(app.indexOf('window.copyAndOpen = async function(pid)'),app.indexOf('// ── Manual-posted prompt helpers')),ui);
 await ui.window.copyAndOpen('facebook');assert.equal(ui.copied,'Line one\nLine two');assert.equal(ui.opened,'https://www.facebook.com/');
 ui.opened=null;ui.navigator.clipboard.writeText=async()=>{throw Error('Clipboard denied');};await ui.window.copyAndOpen('facebook');assert.equal(ui.opened,null,'failed copy never reports success or opens an empty post');
 // Compile every actual inline script, including module scripts after import removal.
 for(const file of ['BlastyBiz.html','BlastyBiz-Connect.html','BlastyBiz-Listing-Preview.html']){
   const html=fs.readFileSync('public/'+file,'utf8');
   for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
     if(/src=|importmap/.test(match[1]))continue;
     new vm.Script(match[2].replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g,''),{filename:file});
   }
 }
 console.log('PASS personal Facebook delivery, approval, stale dispatcher and page syntax; business Page automation preserved.');
})().catch(e=>{console.error(e);process.exitCode=1;});
