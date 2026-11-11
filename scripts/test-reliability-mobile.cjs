require('node:child_process').execFileSync(process.execPath,['scripts/test-section3-browser.cjs'],{stdio:'inherit'});
'use strict';
require('node:child_process').execFileSync(process.execPath,['scripts/test-section2-browser.cjs'],{stdio:'inherit'});
// Actual shipped markup/CSS and billing controller; all network calls are fixtures.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
   const page=await browser.newPage();await page.route('**/*',r=>r.abort());
   const html=fs.readFileSync('public/BlastyBiz.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'').replace('workspace-loading','');
   await page.setContent(html);await page.addStyleTag({content:fs.readFileSync('public/global-style.css','utf8')+'\nbody{visibility:visible!important}'});
   await page.evaluate(()=>{document.querySelectorAll('.section').forEach(e=>e.classList.remove('active'));document.getElementById('section-create').classList.add('active');});
   assert.deepEqual(await page.locator('#tabs-scroll button').allTextContents(),['Create','Review','Publish','Results']);
   for(const width of [320,390,768,1440]){
     await page.setViewportSize({width,height:850});
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'workspace fits '+width);
     for(const box of await page.locator('#tabs-scroll button').evaluateAll(es=>es.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))))assert(box.w>=44&&box.h>=48,'primary action target '+width);
     await page.locator('#workspace-settings > summary').click();assert(await page.locator('#tab-schedule').isVisible());await page.locator('#workspace-settings > summary').click();
   }
   fs.mkdirSync('test-artifacts',{recursive:true});await page.setViewportSize({width:390,height:850});await page.screenshot({path:'test-artifacts/workspace-mobile.png',fullPage:true});
   await page.evaluate(()=>{document.body.innerHTML='<main class="stage"><div class="main"><section class="card" id="acct-billing-panel"></section></div></main>';window.fetch=async()=>({ok:true,json:async()=>({hasSubscription:true,status:'ACTIVE',version:'1',plan:'pro',billingPeriod:'monthly',paidThrough:'2026-12-10',actions:[],choices:[{plan:'pro',period:'monthly',amountCents:1900},{plan:'agency',period:'monthly',amountCents:4900}]})});});
   await page.addScriptTag({content:fs.readFileSync('public/billing-account.js','utf8')});await page.evaluate(()=>BBBilling.mount(document.getElementById('acct-billing-panel'),{getIdToken:async()=>'fixture'}));
   for(const width of [320,390,768]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'billing fits '+width);for(const b of await page.locator('#billing-change button').all())assert((await b.boundingBox()).height>=44);}
   await page.setViewportSize({width:390,height:850});await page.screenshot({path:'test-artifacts/billing-mobile.png',fullPage:true});
   console.log('PASS mobile workspace navigation and subscription controls at phone, tablet and desktop widths. No live billing or publishing.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
