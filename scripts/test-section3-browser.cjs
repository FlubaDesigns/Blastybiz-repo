'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.route('**/*',r=>r.abort());
  await page.setContent(fs.readFileSync('public/BlastyBiz.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'').replace('workspace-loading',''));
  await page.addStyleTag({content:fs.readFileSync('public/global-style.css','utf8')+'\nbody{visibility:visible!important}'});
  for(const f of ['escape-utils.js','platforms-authority.js','business-form.js','photo-handoff.js'])await page.addScriptTag({content:fs.readFileSync('public/'+f,'utf8')});
  await page.evaluate(()=>{
   document.querySelectorAll('.section').forEach(e=>e.classList.remove('active'));document.getElementById('section-create').classList.add('active');
   document.querySelectorAll('.create-slide').forEach(e=>e.classList.remove('cwiz-active'));document.getElementById('create-slide-5').classList.add('cwiz-active');
   document.getElementById('campaign-content').classList.remove('hidden');document.getElementById('campaign-content').hidden=false;
   window.platforms=['facebook','instagram'].map(id=>({...BBPlatforms.byId[id],enabled:true,type:'api',adaptedContent:'Your saved post. '.repeat(25),_reviewStatus:'needs-review'}));
   Object.assign(window,{activeBizId:'fixture',activeCampaignId:'fixture',BBAds:{active:{id:'first',imageRefs:[{id:'photo',url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="seagreen" width="400" height="300"/></svg>'}]}},platformEligible:()=>true,PLATFORM_URL_HINTS:{},_bbIsGenerating:()=>false,showToast(){},savePlatforms(){}});
  });
  const code=fs.readFileSync('public/workspace-editor.js','utf8'),cut=(a,b)=>code.slice(code.indexOf(a),code.indexOf(b,code.indexOf(a)));
  await page.addScriptTag({content:[cut('async function regeneratePlatformCopy','function saveStepCat'),cut('function renderPlatformPhotoStrip','// Open a platform page'),cut('let _step5PlatIdx = 0;','// IMAGE HANDLING')].join('\n')});
  await page.evaluate(()=>renderStep5Review());
  for(const width of [320,384,430,1280]){
   await page.setViewportSize({width,height:850});await page.locator('#step5-card-facebook').evaluate(e=>e.open=true);
   await page.locator('#step5-card-facebook').scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no overflow '+width);
   const image=await page.locator('#qp-photo-strip-facebook img').boundingBox();assert(image&&image.width>=100&&image.height>=75,'actual photo visible '+width);
   for(const b of await page.locator('#step5-card-facebook button:visible,#step5-destinations button').all())assert((await b.boundingBox()).height>=44,'touch target '+width);
   assert.equal(await page.locator('#qp-copy-text-facebook').innerText(),'Your saved post. '.repeat(25).trimEnd());
   assert.equal(await page.locator('#qp-direction-facebook').isVisible(),false);
   await page.locator('#step5-destinations button').nth(1).click();assert(await page.locator('#step5-card-instagram').evaluate(e=>e.open));
   await page.locator('#step5-destinations button').first().click();
   fs.mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/section3-'+width+'.png',fullPage:true});
  }
  // Android resizes the content viewport while the keyboard is open.
  await page.setViewportSize({width:384,height:360});await page.locator('#qp-copy-text-facebook').focus();
  await page.locator('#qp-copy-text-facebook').evaluate(e=>e.scrollIntoView({block:'center'}));
  const action=await page.locator('#step5-lgtm-facebook').boundingBox();assert(action.y>=0&&action.y+action.height<=360,'next action remains inside keyboard-height viewport '+JSON.stringify(action));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'test-artifacts/section3-keyboard-384.png',fullPage:true});
  console.log('PASS section 3 actual markup/CSS: 320/384/430 phone and 1280 desktop; selected photo, editable copy, destination chips, collapsed directions, touch targets and shortened keyboard viewport.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
