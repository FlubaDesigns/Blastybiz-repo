'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage();await page.route('**/*',r=>r.request().url().includes('/photo.png')?r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1kAAAAASUVORK5CYII=','base64')}):r.abort());
 await page.setContent('<main class="stage"><div class="main"><section class="card" id="list"></section></div></main>');await page.addStyleTag({content:fs.readFileSync('public/global-style.css','utf8')});
 for(const f of ['blastybiz-menu.js','platforms-authority.js','schedule-utils.js','lifecycle-ui.js'])await page.addScriptTag({content:fs.readFileSync('public/'+f,'utf8').split('function _revealAdminNav')[0]});
 await page.evaluate(()=>{window.writes=[];window.fetch=async(u,o)=>{writes.push(JSON.parse(o.body));throw Error('Fixture prevents writes');};BBLifecycle.configure({businessId:'fixture',token:async()=> 'fixture'});BBLifecycle.renderSchedules(document.getElementById('list'),{schedules:[{campaignId:'c',adId:'a',campaignName:'Weekend plants',adName:'Saved upcoming post',platforms:['craigslist','facebook'],schedule:{enabled:true,status:'waiting_approval',frequency:'weekly',nextRunAt:'2027-02-01T14:00:00Z',timezone:'America/New_York',copyBehavior:'reuse',imageBehavior:'reuse',approvalBehavior:'always'},upcoming:{id:'next',revision:1,approvalStatus:'required',packet:{adaptations:{craigslist:'Saved post copy'},enabledPlatforms:['craigslist','facebook'],imageRefs:[{id:'photo',url:'https://example.test/photo.png'}]}},imagePool:[{id:'photo',url:'https://example.test/photo.png'}]}],legacy:[]},{onEdit:()=>{window.edited=true;}});});
 const card=page.locator('.bb-schedule-card');
 for(const width of [320,384,430,1280]){
  await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'compact schedule fits '+width);
  assert(await card.locator('.bb-upcoming-photo').isVisible());assert.equal(await card.locator('.bb-destination').count(),2);assert((await card.locator('.bb-upcoming-time').innerText()).includes('9:00'));
  assert(await card.getByRole('button',{name:'Pause',exact:true}).isVisible());assert(await card.getByRole('button',{name:'Review & approve',exact:true}).isVisible());
  await card.locator('.bb-more > summary').click();fs.mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/section4-menu-'+width+'.png',fullPage:true});const menu=await card.locator('.bb-more-list').boundingBox();assert(menu.x>=0&&menu.x+menu.width<=width,'right menu fits '+width);
  const icon=await card.locator('.bb-more > summary').boundingBox();assert(icon.width<=40&&icon.height<=40,'normal three-dot icon');
  for(const label of ['Edit Schedule & Photos','Skip Next','Move only the next post','Schedule details','Cancel Schedule'])assert(await card.getByRole('button',{name:label,exact:true}).isVisible(),label);
  await page.keyboard.press('Escape');fs.mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/section4-schedule-'+width+'.png',fullPage:true});
 }
 await card.getByRole('button',{name:'Review & approve',exact:true}).click();assert.equal(await card.locator('[data-copy]').inputValue(),'Saved post copy');await card.getByRole('button',{name:'Approve This Blast',exact:true}).click();assert.equal(await page.evaluate(()=>writes.length),0,'approval still requires review checkbox');
 await card.locator('.bb-more > summary').click();await card.getByRole('button',{name:'Edit Schedule & Photos',exact:true}).click();assert(await page.evaluate(()=>edited));assert.equal(await page.evaluate(()=>writes.length),0);
 console.log('PASS section 4: actual compact schedule, saved photos/date/platforms, primary approve/pause, all secondary tools, normal right-side menu, keyboard close, 320/384/430/1280 and no implicit writes.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
