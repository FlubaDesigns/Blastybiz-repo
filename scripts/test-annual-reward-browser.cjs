'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
 const page=await browser.newPage({viewport:{width:384,height:832}});page.setDefaultTimeout(10000);
 const html=fs.readFileSync('public/BlastyBiz-Rewards.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'').replace('body{visibility:hidden}','body{visibility:visible}');
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.hostname!=='fixture.test')return route.abort();
  if(u.pathname==='/reward')return route.fulfill({contentType:'text/html',body:html});
  const file=u.pathname.slice(1);if(['global-style.css','Buttons.css'].includes(file))return route.fulfill({contentType:'text/css',body:fs.readFileSync('public/'+file,'utf8')});return route.abort();
 });
 await page.goto('https://fixture.test/reward');
 await page.evaluate(()=>{
  window.auth={};window.db={};window.onAuthStateChanged=(_,fn)=>window.authenticate=fn;
  window.collection=(...args)=>args;window.getDocsFromServer=async()=>({docs:[]});window.uploadBusinessLogo=async()=>{};
  window.fetch=async()=>({ok:true,json:async()=>({eligible:true,approved:false,product:{name:'Bella + Canvas 3001',description:'Your business logo, website and QR code on your personalized shirt.',availableColors:['Black'],availableVariants:[{color:'Black',size:'M'}]},terms:'One free shirt per account with annual Pro. BlastyBiz covers shipping.'})});
 });
 await page.addScriptTag({content:fs.readFileSync('public/annual-reward.js','utf8').replace(/^import .*;\n/gm,'')});
 await page.evaluate(()=>window.authenticate({uid:'owner',emailVerified:true,getIdToken:async()=>'fixture-token'}));
 fs.mkdirSync('test-artifacts',{recursive:true});
 for(const width of [320,384,430,1024]){
  await page.setViewportSize({width,height:832});
  for(const same of [true,false]){
   await page.locator('#reward-same-address').setChecked(same);
   assert.equal(await page.locator('#reward-shipping-fields').isVisible(),!same,'Shipping visibility follows checkbox');
   assert.equal(await page.locator('#reward-upgrade').isVisible(),false,'Eligible customer does not see upgrade');
   assert.equal(await page.locator('#reward-preview').isVisible(),false,'No preview before generation');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No overflow at '+width);
   const sizes=await page.locator('input:not([type="checkbox"]),select,button').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>({id:e.id,height:e.getBoundingClientRect().height})));assert(sizes.every(e=>e.height>=44),'Phone control size '+width+': '+JSON.stringify(sizes.filter(e=>e.height<44)));
   const bounds=await page.locator('#reward-content .card,input,select').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {id:e.id,left:r.left,right:r.right};}));assert(bounds.every(r=>r.left>=10&&r.right<=width-10),'Controls remain inside phone gutters '+width+': '+JSON.stringify(bounds.filter(r=>r.left<10||r.right>width-10)));
   for(const id of ['same-address','consent']){const box=await page.locator('#reward-'+id).boundingBox();assert(box.width>=20&&box.width<=30&&box.height>=20,'Visible checkbox '+id+': '+JSON.stringify(box));}
   if(width===384)await page.screenshot({path:'test-artifacts/annual-pro-shirt-'+(same?'mobile':'shipping-mobile')+'.png',fullPage:true});
  }
 }
 console.log('PASS reward layout: billing/shipping toggle, 320–1024 px, visible checkboxes, no clipping and controls at least 44 px.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
