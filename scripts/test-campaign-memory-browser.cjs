'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const read=async path=>process.env.LIVE_ORIGIN?fetch(new URL('/'+path,process.env.LIVE_ORIGIN),{cache:'no-store'}).then(r=>{assert(r.ok,path);return r.text();}):fs.readFileSync('public/'+path,'utf8');
 const html=await read('BlastyBiz.html'),css=await read('global-style.css');
 const controller=html.slice(html.indexOf('// ── Campaign memory:'),html.indexOf('function _showCreateCampMemorySaved'));
 assert(controller.includes('function confirmBusinessMemoryReview()'),'deployed controller present');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();await page.route('**/*',r=>r.abort());
  await page.setContent(html.replace(/<script[\s\S]*?<\/script>/g,'').replace('workspace-loading',''));
  await page.addStyleTag({content:css+'\nbody{visibility:visible!important} #section-create,#create-slide-1,#create-teach-ai-body{display:block!important}'});
  await page.addScriptTag({content:`var campaigns=[{id:'creators',name:'Creator earnings — turn your own ideas into income',campaignMemory:'Earn 25% of profit from your own ideas'}];var activeCampaignId='creators';var profile={name:'QR Gear'};window.activeBizId='qrgear';window.currentUser={uid:'fixture'};function renderFactoidQuickLook(){}function _showCreateCampMemorySaved(){}function showToast(){};window.sharedFacts=[];window._bbAppendBusinessMemory=async text=>{sharedFacts.push(text);return text;};${controller}\nsyncCampaignMemoryEditors();`});
  for(const width of [320,360,390,768,1440]){
   await page.setViewportSize({width,height:740});
   await page.evaluate(()=>openBusinessMemoryReview('create-camp-memory-text'));
   const dialog=page.locator('#business-memory-dialog');assert(await dialog.isVisible());
   assert.equal(await page.locator('#business-memory-fact').inputValue(),'','no whole-campaign promotion');
   await page.locator('#business-memory-fact').fill('QR Gear makes custom QR merchandise.');
   const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,'dialog fits '+width);
   const metrics=await page.locator('.memory-dialog-close').evaluate(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,left:e.getBoundingClientRect().left}));assert(metrics.w>=44&&metrics.h>=44,'phone close target');
   const before=await page.evaluate(()=>sharedFacts.length);await page.keyboard.press('Escape');assert(!await dialog.isVisible());assert.equal(await page.evaluate(()=>sharedFacts.length),before,'Escape never shares');
  }
  await page.evaluate(()=>openBusinessMemoryReview('create-camp-memory-text'));
  await page.locator('#business-memory-fact').fill('Approved company fact');
  await page.locator('#business-memory-confirm').click();
  assert.deepEqual(await page.evaluate(()=>sharedFacts),['Approved company fact']);
  assert(!await page.locator('#business-memory-dialog').isVisible());
  console.log('PASS Chromium campaign memory: 320–1440px, real dialog, exact fact review, Escape/cancel, 44px close and explicit confirmation. '+(process.env.LIVE_ORIGIN?'Source: deployed assets; persistence uses isolated fixtures.':'Local production source; persistence uses isolated fixtures.'));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
