'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})}),page=await browser.newPage({viewport:{width:384,height:832}});
 const html=fs.readFileSync('public/BlastyBiz-Rewards.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'').replace('body{visibility:hidden}','body{visibility:visible}');
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());if(u.hostname!=='fixture.test')return route.abort();
  if(u.pathname==='/reward')return route.fulfill({contentType:'text/html',body:html});
  const file=u.pathname.slice(1);if(['global-style.css','Buttons.css'].includes(file))return route.fulfill({contentType:'text/css',body:fs.readFileSync('public/'+file,'utf8')});return route.abort();
 });
 await page.goto('https://fixture.test/reward');
 await page.evaluate(()=>{
  document.getElementById('reward-content').hidden=false;document.getElementById('reward-message').textContent='Your annual Pro purchase includes one free shirt.';
  document.getElementById('reward-title').textContent='Bella + Canvas 3001';document.getElementById('reward-description').textContent='Your business logo, website and QR code on your personalized shirt.';
  document.getElementById('reward-terms').textContent='One shirt with annual Pro. Review your design before claiming.';
 });
 for(const width of [320,384,430,1024]){
  await page.setViewportSize({width,height:832});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No overflow at '+width);
  const sizes=await page.locator('input:not([type="checkbox"]),select,button').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().height));assert(sizes.every(h=>h>=44),'Phone control size '+width);
 }
 await page.setViewportSize({width:384,height:832});fs.mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/annual-pro-shirt-mobile.png',fullPage:true});
 await browser.close();console.log('PASS reward layout: 320–1024 px, no overflow and controls at least 44 px.');
})().catch(e=>{console.error(e);process.exitCode=1;});
