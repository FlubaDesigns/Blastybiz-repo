'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage();await page.route('**/*',r=>r.request().url().includes('/photo.jpg')?r.fulfill({contentType:'image/jpeg',body:fs.readFileSync('public/img/storefront.jpg')}):r.abort());
 const html=fs.readFileSync('public/BlastyBiz-Dashboard.html','utf8');await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]*>/g,''));
 for(const file of ['global-style.css','Buttons.css'])await page.addStyleTag({content:fs.readFileSync('public/'+file,'utf8')});
 for(const file of ['escape-utils.js','blastybiz-menu.js','platforms-authority.js','schedule-utils.js','lifecycle-ui.js','lifecycle-status.js','dashboard-posts.js'])await page.addScriptTag({content:fs.readFileSync('public/'+file,'utf8').split('function _revealAdminNav')[0]});
 const registry=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].find(x=>x[2].includes('BUSINESS REGISTRY'));await page.addScriptTag({content:registry[2]});
 await page.evaluate(()=>{
   document.body.style.visibility='visible';window.activeBizId='b';window.BUSINESSES=[{id:'b',name:'Weekend plants'}];renderSwitcherBar();renderDashboardCampaigns([{id:'c',name:'Fresh flowers',createdAt:'2026-11-10'}]);
   document.getElementById('dashboard-biz-name').textContent='Weekend plants';
   window.writes=[];window.fetch=async(_,options)=>{writes.push(JSON.parse(options.body));return {ok:true,json:async()=>({ad:{id:'new'}})};};
   BBReturnVisits.renderDraft(document.getElementById('dashboard-draft'),[{id:'a',campaignId:'c',name:'Spring bouquets',status:'draft',adaptations:{google:'Fresh flowers are ready for the weekend. Stop by the shop today.'},imageRefs:[{url:'https://example.test/photo.jpg'}]}],[],'b');
   BBLifecycle.configure({businessId:'b',token:async()=> 'fixture'});BBLifecycle.renderSchedules(document.getElementById('dashboard-next'),{schedules:[{campaignId:'c',adId:'a',campaignName:'Fresh flowers',adName:'Weekend post',platforms:['google'],schedule:{enabled:true,status:'active',frequency:'weekly',nextRunAt:'2027-02-01T14:00:00Z',timezone:'America/New_York',copyBehavior:'reuse',imageBehavior:'reuse',approvalBehavior:'always'},upcoming:{id:'next',revision:1,approvalStatus:'required',packet:{adaptations:{google:'Review this saved post'},enabledPlatforms:['google'],imageRefs:[{id:'photo',url:'https://example.test/photo.jpg'}]}},imagePool:[]}],legacy:[]},{compact:true});
   BBLifecycleStatus.renderHistory(document.getElementById('dashboard-recent'),[{key:'sent',draftId:'sent',campaignId:'c',adId:'a',reusable:true,image:'https://example.test/photo.jpg',listing:'Last week’s flowers',summary:'Google: Live',time:'2026-11-10T14:00:00Z'}],{businessId:'b',userId:'u',token:async()=> 'fixture',isCurrent:()=>true,navigate:url=>window.opened=url});
 });
 for(const width of [320,384,430,1280]){
   await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'dashboard fits '+width);
   assert(await page.getByRole('link',{name:'Continue your draft',exact:true}).isVisible());assert.equal(await page.locator('#dashboard-draft img').count(),1);assert(await page.getByRole('heading',{name:'Next scheduled post',exact:true}).isVisible());
   assert(await page.locator('#dashboard-next').getByRole('button',{name:'Pause',exact:true}).isVisible());assert(await page.getByRole('button',{name:'Use again',exact:true}).isVisible());
   for(const menu of await page.locator('#dashboard-return .bb-more, .biz-bar .bb-more, #dashboard-campaign-list .bb-more').all()){
     await menu.locator(':scope > summary').click();const rect=await menu.locator(':scope > .bb-more-list').boundingBox();assert(rect.x>=0&&rect.x+rect.width<=width,'menu bounds '+width);const icon=await menu.locator(':scope > summary').boundingBox();assert(icon.width<=40&&icon.height<=40);await page.keyboard.press('Escape');
   }
   fs.mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/section5-dashboard-'+width+'.png',fullPage:true});
 }
 await page.getByRole('button',{name:'Use again',exact:true}).click();await page.waitForFunction(()=>window.opened);const state=await page.evaluate(()=>({opened,writes}));assert.equal(state.writes.length,1);assert.equal(state.writes[0].sourceBlastId,'sent');assert(state.opened.includes('adId=new'));
 console.log('PASS section 5 browser: actual dashboard controls, saved thumbnails/copy, next schedule, shared history reuse, normal right-side menus and 320/384/430/1280 bounds.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
