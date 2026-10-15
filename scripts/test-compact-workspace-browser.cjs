const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const html=fs.readFileSync('public/BlastyBiz.html','utf8'),css=fs.readFileSync('public/global-style.css','utf8');
 const render=html.slice(html.indexOf('function renderCreateCampList() {'),html.indexOf('function renderCampaignChips()'));
 const create=html.slice(html.indexOf('function openNewCampaign() {'),html.indexOf('let quickCampaignSaving'));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage();
 await page.route('**/*',r=>r.abort());
 await page.setContent(html.replace(/<script[\s\S]*?<\/script>/g,'').replace('workspace-loading',''));
 await page.addStyleTag({content:css+'\nbody{visibility:visible!important} #section-create{display:block!important} .pro-overlay{display:none!important}'});
 await page.addScriptTag({content:`var campaigns=[{id:'a',name:'Blasty Start'},{id:'b',name:'Holiday <sale> & offers'}]; var activeCampaignId='a'; window.selected=[]; window.deleted=[]; window.blockSwitch=false;
 async function selectCampaign(id,name){if(window.blockSwitch)return;selected.push([id,name]);activeCampaignId=id;renderCreateCampList();}
 function deleteCampaign(id,name){deleted.push([id,name]);}
 window.addBusiness=()=>window.added=true;window.deleteBusiness=()=>window.businessDeleted=true;
 ${render}\n${create}\nrenderCreateCampList();
 document.getElementById('workspace-info-bar').style.display='flex';document.getElementById('wb-plan-badge').style.display='inline';document.getElementById('wb-plan-badge').textContent='Agency';document.getElementById('agency-usage-text').textContent='8/10 businesses';`});
 for(const width of [320,360,390,768,1440]){
  await page.setViewportSize({width,height:900});
  const metrics=await page.evaluate(()=>({biz:document.getElementById('create-biz-card').getBoundingClientRect().height,camp:document.getElementById('create-camp-list-card').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth}));
  assert(metrics.biz+metrics.camp<150,`compact rows at ${width}: ${JSON.stringify(metrics)}`);assert(!metrics.overflow,'no overflow '+width);
  assert.equal(await page.locator('#tab-profile').count(),1);assert.equal(await page.locator('#tab-story').count(),1);assert.equal(await page.locator('#tab-create').count(),1);
  assert(!await page.locator('.del-biz-btn').isVisible());assert(!await page.getByRole('button',{name:'Delete current campaign',exact:true}).isVisible());
  const summary=page.locator('.workspace-campaign-picker > summary');await summary.click();
  const box=await page.locator('.workspace-campaign-picker > .header__business-options').boundingBox();assert(box.height<=280);assert(box.x>=0&&box.x+box.width<=width+1,'dropdown bounded '+width);
  await summary.press('Escape');assert(!await page.locator('.workspace-campaign-picker').evaluate(e=>e.open));
  console.log('PASS compact Business/Campaign controls, preserved Profile row, anchored dropdown at '+width);
 }
 await page.setViewportSize({width:360,height:900});
 const summary=page.locator('.workspace-campaign-picker > summary');await summary.click();
 await page.getByRole('button',{name:'Holiday <sale> & offers',exact:true}).click();assert.equal(await summary.innerText(),'Holiday <sale> & offers');assert.equal(await page.locator('.workspace-campaign-picker[open]').count(),0);
 await page.evaluate(()=>window.blockSwitch=true);await summary.click();await page.getByRole('button',{name:'Blasty Start',exact:true}).click();assert.equal(await summary.innerText(),'Holiday <sale> & offers','blocked switches preserve selection');
 await page.locator('#create-biz-card .workspace-manage > summary').click();assert.equal(await page.locator('.workspace-campaign-picker[open]').count(),0,'outside click closes campaign picker');
 await page.getByRole('button',{name:'Add business',exact:true}).click();assert(await page.evaluate(()=>window.added));
 await page.locator('#create-biz-card .workspace-manage > summary').click();
 await page.getByRole('button',{name:'＋ New',exact:true}).click();assert(await page.locator('#new-campaign-input').isVisible());await page.getByRole('button',{name:'Cancel',exact:true}).first().click();assert(!await page.locator('#new-campaign-input').isVisible());
 await page.evaluate(()=>{campaigns=[{id:'a',name:'Only campaign'}];activeCampaignId='a';renderCreateCampList();});assert.equal(await summary.innerText(),'Only campaign');
 await summary.click();await page.locator('.workspace-campaign-manage > summary').click();await page.getByRole('button',{name:'Delete current campaign',exact:true}).click();assert.deepEqual(await page.evaluate(()=>deleted),[['a','Only campaign']]);
 await page.evaluate(()=>{campaigns=[];activeCampaignId=null;renderCreateCampList();});assert.equal(await summary.innerText(),'Choose campaign');await summary.click();assert(await page.getByText('No campaigns yet. Tap ＋ New.',{exact:true}).isVisible());
 console.log('PASS campaign switching delegation, blocked selection, safe names, one/zero campaigns, Manage and New controls');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
