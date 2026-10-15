const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const html=fs.readFileSync('public/BlastyBiz.html','utf8'),css=fs.readFileSync('public/global-style.css','utf8');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:360,height:800}});
 await page.route('**/*',r=>r.abort());
 await page.setContent(html.replace(/<script[\s\S]*?<\/script>/g,'').replace('workspace-loading',''));
 await page.addStyleTag({content:css+'\nbody{visibility:visible!important} #section-create,#create-slide-5{display:block!important} #create-slide-1{display:none!important}'});
 await page.addScriptTag({content:fs.readFileSync('public/escape-utils.js','utf8')});
 await page.addScriptTag({content:fs.readFileSync('public/photo-handoff.js','utf8')});
 await page.addScriptTag({content:`var _step5PlatIdx=0;var platforms=[{id:'facebook',name:'Facebook Page',icon:'F',type:'api',adaptedContent:'Long review copy. '.repeat(70),_reviewStatus:'approved'},{id:'instagram',name:'Instagram',icon:'I',type:'api',adaptedContent:'Instagram copy',_reviewStatus:'approved'}];var PLATFORM_URL_HINTS={};var profile={};window.saveCalls=0;window.failSave=false;window._currentDraftId='fixture';window.BBAds={active:{imageRefs:[]},save:async()=>{}};window._bbUpdateDraft=async()=>{if(failSave)throw Error('fixture failure');saveCalls++;};function savePlatforms(){}function showToast(){}function _bbIsGenerating(){return false;}function getStep5Platforms(){return platforms;}function renderAdPostPhotos(p){BBPhotoHandoff.renderPhotos(document.getElementById('qp-photo-strip-'+p.id),p.id,[{url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1kAAAAASUVORK5CYII='},{url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1kAAAAASUVORK5CYII='}],true);}
 ${html.slice(html.indexOf('function step5GoTo('),html.indexOf('async function completeBlast('))}
 ${html.slice(html.indexOf('async function approvePlatformCopy('),html.indexOf('async function excludePlatform('))}
 renderStep5Review();`});
 assert.equal(await page.locator('.step5-review-card[open]').count(),0,'approved platforms start collapsed');
 for(const width of [320,360,390,768,1440]){
  await page.setViewportSize({width,height:900});
  assert((await page.locator('#step5-review-container').boundingBox()).height<165,'compact approved rows '+width);
  await page.locator('#step5-card-facebook > summary').click();
  assert(!await page.locator('#step5-lgtm-facebook').isVisible(),'approval not repeated');
  const photos=await page.locator('#qp-photo-strip-facebook .platform-photo').evaluateAll(links=>links.map(link=>({image:link.querySelector('img').getBoundingClientRect().toJSON(),labelDisplay:getComputedStyle(link.querySelector('span')).display})));
  assert(photos.every(p=>p.labelDisplay==='none'&&p.image.width===76),'thumbnails without numbered labels '+width);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no overflow '+width);
  await page.locator('#step5-card-instagram > summary').click();assert.equal(await page.locator('.step5-review-card[open]').count(),1,'one platform open');
  await page.evaluate(()=>renderStep5Review());assert(await page.locator('#step5-card-instagram').evaluate(e=>e.open),'rerender keeps chosen platform');
  await page.locator('#step5-card-instagram > summary').click();
  console.log('PASS review accordions, approved summaries, unlabelled photos and no overflow at '+width);
 }
 assert.equal(await page.evaluate(()=>saveCalls),0,'opening reviews does not approve or save');
 await page.evaluate(()=>{platforms.forEach(p=>p._reviewStatus='needs-review');updateStep5UI();step5GoTo(0);});
 await page.locator('#step5-lgtm-facebook').waitFor({state:'visible'});
 await page.evaluate(()=>window.failSave=true);await page.locator('#step5-lgtm-facebook').click();assert(await page.locator('#step5-card-facebook').evaluate(e=>e.open));assert.equal(await page.evaluate(()=>saveCalls),0,'failed approval does not advance');
 await page.evaluate(()=>window.failSave=false);await page.locator('#step5-lgtm-facebook').click();await page.waitForFunction(()=>document.getElementById('step5-card-instagram').open);
 assert.equal(await page.locator('.step5-review-card[open]').count(),1);assert.equal(await page.evaluate(()=>saveCalls),1);assert(!await page.locator('#step5-lgtm-facebook').isVisible());
 await page.evaluate(()=>{platforms[0]._reviewStatus='needs-review';updateStep5UI();step5GoTo(0);});assert(await page.locator('#step5-lgtm-facebook').isVisible(),'edited copy can be approved again');assert.equal(await page.locator('#step5-pill-facebook').innerText(),'Needs Review');
 if(process.env.REVIEW_SCREENSHOT){await page.setViewportSize({width:360,height:900});await page.locator('#step5-review-container').screenshot({path:process.env.REVIEW_SCREENSHOT});}
 console.log('PASS explicit saved approval, failed-save protection, next platform opening, and edit approval reset; no provider calls');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
