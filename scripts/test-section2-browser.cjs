'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const read=p=>fs.readFileSync('public/'+p,'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 let page;
 try{
  page=await browser.newPage();await page.route('**/*',r=>r.request().url().endsWith('/img/storefront.jpg')?r.fulfill({body:fs.readFileSync('public/img/storefront.jpg'),contentType:'image/jpeg'}):r.abort());
  fs.mkdirSync('test-artifacts',{recursive:true});
  for(const file of ['BlastyBiz-Home.html','BlastyBiz-Login.html','BlastyBiz-CreateBiz.html']){
   await page.setContent(read(file).replace(/<script[\s\S]*?<\/script>/g,'').replace('<head>','<head><base href="https://blastybiz.test/">'));
   await page.addStyleTag({content:read('global-style.css')+'\nbody{visibility:visible!important}.reveal{opacity:1;transform:none}*{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important}'});
   if(file.includes('Home')){for(const f of ['escape-utils.js','platforms-authority.js','post-preview.js','home-demo.js'])await page.addScriptTag({content:read(f)});}
   if(file.includes('Login'))await page.evaluate(()=>{document.getElementById('auth-loading').hidden=true;document.getElementById('auth-card-wrap').classList.add('ready');document.querySelectorAll('.auth-form,.auth-tab').forEach(e=>e.classList.remove('active'));document.getElementById('form-signup').classList.add('active');document.getElementById('tab-signup').classList.add('active');});
   for(const width of [320,384,430,1280]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,file+' fits '+width);
    if(file.includes('Home')){
     for(const tab of await page.locator('[data-demo-platform]').all()){assert((await tab.boundingBox()).height>=44);await tab.click();assert.equal(await tab.getAttribute('aria-pressed'),'true');await page.locator('.pub-post-photo img').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('.pub-post-photo img')?.naturalWidth>0);}
     assert.equal(await page.locator('.hero-actions a').count(),1);assert(await page.locator('.home-post-demo').isVisible());
    }
    if(width===384||width===1280)await page.screenshot({path:'test-artifacts/section2-'+file.replace('.html','')+'-'+width+'.png',fullPage:true});
   }
  }
  console.log('PASS section 2 real-browser layout: 320/384/430/1280, working preview tabs and shared photo card, one primary entrance, signup and setup fit phone widths.');
 }catch(error){if(page)await page.screenshot({path:'test-artifacts/section2-failure.png',fullPage:true});throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
