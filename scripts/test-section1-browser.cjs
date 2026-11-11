'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();
  for(const width of [384,1280]){
    await page.setViewportSize({width,height:900});
    const html=fs.readFileSync('public/BlastyBiz-Admin.html','utf8');
    const card=html.slice(html.indexOf('  <section class="card mb-16" id="ai-settings-card"'),html.indexOf('  <!-- ── PLATFORM CATEGORY'));
    const header=html.slice(html.indexOf('<header>'),html.indexOf('</header>')+9);
    await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="admin-page">'+header+'<main class="main"><div class="main-inner">'+card+'</div></main></body></html>');
    await page.addStyleTag({content:fs.readFileSync('public/global-style.css','utf8')});
    await page.addStyleTag({content:fs.readFileSync('public/Buttons.css','utf8')});
    await page.addScriptTag({content:fs.readFileSync('public/blastybiz-menu.js','utf8').split('function _revealAdminNav')[0]});
    assert.equal(await page.locator('#ai-settings-card').isVisible(),false);
    await page.getByLabel('Admin options',{exact:true}).click();
    await page.getByRole('button',{name:'AI settings',exact:true}).click();
    assert.equal(await page.locator('#ai-settings-card').isVisible(),true);
    await page.addScriptTag({content:fs.readFileSync('public/admin-ai-settings.js','utf8')});
    const {AI_PROVIDERS}=require('../functions/lib/ai-capabilities');
    await page.evaluate(async providers=>window.createAdminAiSettings({request:async()=>({provider:'gemini',fastModel:'saved-custom-model-v2',smartModel:'gemini-flash-lite-latest',providers:providers.map(p=>({...p,configured:true}))})}).load(),AI_PROVIDERS);
    assert.equal(await page.locator('#ai-fast-model').inputValue(),'saved-custom-model-v2');
    assert(await page.locator('#ai-save-button').isEnabled());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
    const controls=await page.locator('#ai-selects-grid select').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,height:r.height};}));
    assert(controls.every(c=>c.height>=44));if(width===384)assert(controls[1].top>controls[0].top&&controls[2].top>controls[1].top,'Phone controls stack');
    fs.mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/section1-admin-'+width+'.png',fullPage:true});
  }
  console.log('PASS phone and desktop AI controls: shared layout, readable saved models, 44px controls, no overflow.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
