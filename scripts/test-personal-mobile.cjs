'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const html=fs.readFileSync('public/BlastyBiz.html','utf8');
const cut=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage({viewport:{width:412,height:915},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='fixture.test'){await route.abort();return;}
  const file=path.resolve('public','.'+url.pathname);
  if(!file.startsWith(path.resolve('public')+path.sep)||!fs.existsSync(file)){await route.fulfill({status:404,body:''});return;}
  const ext=path.extname(file);
  await route.fulfill({contentType:ext==='.css'?'text/css':ext==='.js'?'text/javascript':ext==='.html'?'text/html':'application/octet-stream',body:ext==='.html'?html.replace(/<script\b[\s\S]*?<\/script>/gi,''):fs.readFileSync(file)});
 });
 await page.goto('https://fixture.test/BlastyBiz.html');
 await page.addScriptTag({content:fs.readFileSync('public/platforms-authority.js','utf8')});
 await page.evaluate(()=>{
  Object.assign(window,{profile:{sellerType:'personal'},_bbProfileGlobal:{sellerType:'personal'},activeBizId:'b',activeCampaignId:'c',activeCampaignName:'Sample electric vehicle',campaigns:[{id:'c',photos:[]}],ynState:{},photoScope:'campaign',_bbPhotoUploads:new Set(),_bbPhotoItems:[],_globalImages:[],_bbSelectedPhotoIndex:null,PLATFORM_RULES:{},_bbGetToken:async()=>'fixture',_bbLoadGlobalImages:async()=>[],_bbLoadCampaignImages:async()=>[],showToast(){},renderStep5Review(){},checkAdaptBtn(){},renderStep3Platforms(){},_bbSetGenerating(){},updateCopyPreview(){},savePlatforms(){},escHtml:s=>s});
  window.platforms=BBPlatforms.records.map(p=>({...p,enabled:true}));
  const ad={id:'first',name:activeCampaignName+' — First Ad',offer:'3500',price:'',context:'Yellow and white. Good batteries. Bluetooth stereo.',platforms:['google','facebook','fbmarket'],imageRefs:[],revision:1};
  window._bbFetchWithTimeout=async()=>({ok:true,json:async()=>({ads:[ad]})});
  document.body.classList.remove('workspace-loading');document.body.classList.add('personal-seller');
  document.querySelectorAll('.section').forEach(n=>n.classList.remove('active'));document.getElementById('section-create').classList.add('active');
  document.getElementById('campaign-content').classList.remove('hidden');
  document.getElementById('biz-tab-bar').textContent='Sample Seller';document.getElementById('create-camp-list').textContent='Sample electric vehicle';
 });
 await page.addScriptTag({content:cut('function configureSellerForm(', 'function loadProfile()')});
 await page.addScriptTag({content:cut('function photoUploadMatchesView(', 'const AI_REQUEST_TIMEOUT_MS')});
 // Existing scope function ends before the Factoids section.
 await page.addScriptTag({content:cut('function refreshPhotoGridForScope(', 'function renderFactoidQuickLook(')});
 await page.addScriptTag({content:fs.readFileSync('public/ad-workspace.js','utf8')});
 await page.evaluate(async()=>{configureSellerForm(true);await BBAds.open();refreshPhotoGridForScope();});
 assert.equal(await page.getByLabel('Item name',{exact:true}).inputValue(),'Sample electric vehicle');
 assert.equal(await page.locator('#biz-price').inputValue(),'3500');
 assert.equal(await page.locator('#biz-offer').inputValue(),'Yellow and white. Good batteries. Bluetooth stereo.');
 for(const id of ['ad-current','ad-list','create-teach-ai-card','scope-photo-global'])assert.equal(await page.locator('#'+id).isVisible(),false,id);
 assert.equal(await page.locator('#campaign-photos').isVisible(),true);
 assert.equal(await page.locator('#s3-continue-btn').innerText(),'Save & preview listing →');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow at phone width');
 await page.evaluate(()=>{const t=document.getElementById('toast');t.textContent='This photo could not be read. Remove it and select it again from Gallery.';t.classList.add('show');});
 const bounds=await page.locator('#toast').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=412,'Upload error fits the phone');
 await page.locator('#item-form-title').scrollIntoViewIfNeeded();
 fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/personal-mobile.png',fullPage:true});
 // Exercise actual image decoding and JPEG conversion, including the canvas fallback.
 await page.addScriptTag({content:cut('  async function maybeDecodeHeic(', '  // ── Photo upload')});
 const converted=await page.evaluate(async()=>{
  const source=document.createElement('canvas');source.width=4032;source.height=3024;source.getContext('2d').fillRect(0,0,4032,3024);
  const results=[];
  for(const type of ['image/jpeg','image/png','image/webp']){
   const blob=await new Promise(r=>source.toBlob(r,type));const out=await compressImage(new File([blob],'fixture',{type}));
   const decoded=await createImageBitmap(out);results.push({type:out.type,width:decoded.width,height:decoded.height,size:out.size});decoded.close();
  }
  const blob=await new Promise(r=>source.toBlob(r,'image/jpeg'));
  const original=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(cb){cb(null);};
  const out=await compressImage(blob);HTMLCanvasElement.prototype.toBlob=original;
  results.push({type:out.type,size:out.size,width:1200,height:900});return results;
 });
 assert.equal(converted.length,4);for(const item of converted){assert.equal(item.type,'image/jpeg');assert(item.width<=1200&&item.height<=1200&&item.size>0&&item.size<4900000);}
 console.log('PASS: Personal phone layout, field restoration, one photo section, readable errors, and real JPEG/PNG/WebP conversion with fallback.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
