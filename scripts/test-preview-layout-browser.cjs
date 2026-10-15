const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
(async()=>{
 const html=fs.readFileSync('public/BlastyBiz-Listing-Preview.html','utf8');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/*',r=>r.abort());
  await page.setContent(html.replace(/<script[\s\S]*?<\/script>/g,''));
  await page.addStyleTag({content:fs.readFileSync('public/global-style.css','utf8')+'\nbody{visibility:visible!important}'});
  await page.addScriptTag({content:fs.readFileSync('public/escape-utils.js','utf8')});
  await page.addScriptTag({content:fs.readFileSync('public/photo-handoff.js','utf8')});
  await page.evaluate(()=>{
   const names={facebook:'Facebook Page',instagram:'Instagram',craigslist:'Craigslist',fbmarket:'Facebook Marketplace',nextdoor:'Nextdoor',yelp:'Yelp'};
   window.BBPlatforms={records:Object.entries(names).map(([id,name])=>({id,name,icon:'•',deliveryMode:'manual',doc:{tone:''}})),labels:{manual:'You post it'},PLATFORM_CAPABILITY_MAP:Object.fromEntries(Object.keys(names).map(id=>[id,{capabilityLevel:['facebook','instagram'].includes(id)?'auto':'manual_assisted',manualInstructions:'Open the platform and paste your text.'}]))};
   window.BBSetup={formatArea:()=> '844 East 7th Street, Englewood, FL, 34223'};
   window._bbDeliveryReadiness=id=>['facebook','instagram'].includes(id)?{state:'connection',label:'Connect to auto-post'}:{state:'manual',label:'You post it'};
   window.copyCalls=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>copyCalls.push(text)},configurable:true});
  });
  await page.addScriptTag({content:html.slice(html.indexOf('var PLATFORM_META ='),html.indexOf('</script>',html.indexOf('var PLATFORM_META =')))});
  await page.evaluate(()=>{
   window.businessId='fixture-business';window.draftDocId='fixture-draft';window.publishCalls=0;window._firestoreApprove=async()=>{publishCalls++;};
   populateFromDraftData({status:'completed',name:'BlastyBiz',offer:'Long offer copy. '.repeat(60),phone:'941-375-1504',campaignId:'fixture-campaign',adId:'fixture-ad',adaptations:Object.fromEntries(BBPlatforms.records.map(p=>[p.id,p.name+' full copy. '.repeat(80)])),imagesByPlatform:Object.fromEntries(BBPlatforms.records.map(p=>[p.id,['https://example.test/photo1.png','https://example.test/photo2.png']]))});markBlastSubmitted();
  });
  for(const width of [320,360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   assert(!await page.locator('#pub-summary-card').evaluate(e=>e.open),'details start collapsed');
   assert.equal(await page.locator('.manual-card[open]').count(),0,'manual cards start collapsed');
   assert(!await page.locator('#publish-btn').isVisible(),'submitted status is not a duplicate button');
   assert(await page.locator('#pub-status-link').isVisible(),'track results remains available');
   const gaps=await page.locator('.pub-flow').evaluate(e=>{const children=[...e.children].filter(n=>getComputedStyle(n).display!=='none');return children.slice(1).map((n,i)=>n.getBoundingClientRect().top-children[i].getBoundingClientRect().bottom);});
   assert(gaps.every(g=>g>=11.9),'cards have breathing room '+JSON.stringify(gaps));
   await page.locator('.manual-card > summary').first().click();
   const labels=await page.locator('.manual-card[open] .platform-photo span').evaluateAll(es=>es.map(e=>getComputedStyle(e).display));assert(labels.length===2&&labels.every(x=>x==='none'),'no numbered captions');
   const buttons=await page.locator('.manual-card[open] button,#pub-status-link').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();const card=e.closest('.manual-card,.pub-action-card').getBoundingClientRect();return {height:r.height,left:r.left,right:r.right,cardLeft:card.left,cardRight:card.right};}));
   assert(buttons.every(b=>b.height>=48&&b.left>=b.cardLeft&&b.right<=b.cardRight),'buttons fit their cards');
   await page.locator('.manual-card[open] .copy-platform-btn').click();assert((await page.evaluate(()=>copyCalls.at(-1))).includes('Craigslist full copy.'),'copy retains full text');
   await page.locator('.manual-card > summary').nth(1).click();assert.equal(await page.locator('.manual-card[open]').count(),1);
   await page.locator('.manual-card > summary').nth(1).click();
   await page.locator('#pub-summary-card > summary').click();assert(await page.locator('#sb-offer').isVisible());await page.locator('#pub-summary-card > summary').click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page overflow');
   assert.equal(await page.locator('.pub-plat-type').filter({hasText:'Connect to auto-post'}).count(),2,'connection warnings preserved');
   console.log('PASS spaced cards, compact details, photo controls, full copy and no overflow at '+width);
  }
  assert.equal(await page.evaluate(()=>publishCalls),0,'layout interactions never publish');
  if(process.env.PREVIEW_SCREENSHOT){await page.setViewportSize({width:390,height:844});await page.locator('.pub-flow').screenshot({path:process.env.PREVIEW_SCREENSHOT});}
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
