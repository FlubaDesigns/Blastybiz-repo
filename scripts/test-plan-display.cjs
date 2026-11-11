'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {database}=require('./lib/test-firestore.cjs');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
async function run(){
 const m=database({'settings/pricing':{proMonthly:27,proAnnual:270,agencyMonthly:125,agencyAnnual:1250,squareProMonthlyPlanId:'private_catalog_id'}});
 const config={bizLimits:{trial:1,starter:2,pro:7,agency:19,internal:'private'},aiLimits:{pro:12345},retention:{dormantDays:365,warningDays:14}};
 const ex={},wrappers=[];
 vm.runInNewContext(fs.readFileSync('functions/modules/payments.js','utf8'),{exports:ex,require:p=>{assert.equal(p,'../lib/shared');return {db:m.db,onRequest:(_,fn)=>fn,withAuth:(fn,opts={})=>{wrappers.push({fn,opts});return fn;},getPlanConfig:async()=>config,AUTO_POST_PLATFORMS:['google','facebook','instagram']};},console});
 const response=()=>({code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
 let r=response();await ex.getPublicPlanOptions({method:'GET'},r);assert.equal(r.code,200);
 assert.deepEqual(JSON.parse(JSON.stringify(r.body)),{prices:{proMonthly:27,proAnnual:270,agencyMonthly:125,agencyAnnual:1250},bizLimits:{trial:1,starter:2,pro:7,agency:19}});
 assert.equal(wrappers.find(x=>x.fn===ex.getPublicPlanOptions).opts.public,true);
 assert.equal(wrappers.find(x=>x.fn===ex.getPlanOptions).opts.public,undefined,'existing account endpoint still requires authentication');
 r=response();await ex.getPublicPlanOptions({method:'POST'},r);assert.equal(r.code,405);
 r=response();await ex.getPlanOptions({method:'GET'},r);assert.equal(r.body.aiLimits,undefined);assert.equal(r.body.bizLimits.pro,7);assert.equal(r.body.retention.dormantDays,365);assert.equal(r.body.checkoutReady.pro.monthly,true);assert(!JSON.stringify(r.body).includes('private'));
 const dom=new JSDOM('<span data-price="proMonthly"></span><span data-biz-limit="pro"></span>',{runScripts:'outside-only'}),w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>r.body});w.eval(fs.readFileSync('public/pricing.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(setImmediate);
 assert.equal(w.document.querySelector('[data-price]').textContent,'$27');assert.equal(w.document.querySelector('[data-biz-limit]').textContent,'7');
 w.fetch=async()=>{throw Error('offline');};w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(setImmediate);assert.equal(w.document.querySelector('[data-price]').textContent,'See checkout');assert.equal(w.document.querySelector('[data-biz-limit]').textContent,'See plans');dom.window.close();
 const html=fs.readFileSync('public/BlastyBiz-Admin.html','utf8'),adminDom=new JSDOM(html),d=adminDom.window.document;
 for(const id of ['admin-failed-list','admin-platform-health','admin-accounts-tbody','admin-billing-pastdue','admin-ai-tbody','ai-settings-card','platform-cats-card','plan-switcher'])assert.equal(d.querySelectorAll('#'+id).length,1,id+' keeps one existing binding');
 assert(d.getElementById('failed').compareDocumentPosition(d.getElementById('finance'))&4,'failures precede statistics');assert(d.getElementById('accounts-attention').compareDocumentPosition(d.getElementById('finance'))&4,'account follow-up precedes statistics');
 for(const file of ['Queue-Manager','Failed-Jobs','Users','Subscriptions','Platform-Health','Logs','Emails','Platforms','Operate'])assert(d.querySelector('header .bb-more a[href="BlastyBiz-Admin-'+file+'.html"]'),file+' remains available');
 assert(d.getElementById('plan-switcher').hidden);adminDom.window.close();
 console.log('PASS plan display: canonical prices/capacity, minimal public projection, authenticated account contract, no AI/catalog disclosure, unavailable states and preserved admin controls.');
}
module.exports=run;if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
