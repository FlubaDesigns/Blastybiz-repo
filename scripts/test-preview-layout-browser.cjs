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
  for(const file of ['escape-utils.js','platforms-authority.js','blastybiz-menu.js'])await page.addScriptTag({content:fs.readFileSync('public/'+file,'utf8').split('function _revealAdminNav')[0]});
  await page.addScriptTag({content:fs.readFileSync('public/photo-handoff.js','utf8')});
  await page.addScriptTag({content:fs.readFileSync('public/post-preview.js','utf8')});
  await page.evaluate(()=>{
   window.BBSetup={formatArea:()=> '844 East 7th Street, Englewood, FL, 34223'};
   window._bbDeliveryReadiness=id=>['facebook','instagram'].includes(id)?{state:'connection',label:'Connect to auto-post'}:{state:'manual',label:'You post it'};
   window.copyCalls=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>copyCalls.push(text)},configurable:true});
  });
  await page.addScriptTag({content:html.slice(html.indexOf('var PLATFORM_META ='),html.indexOf('</script>',html.indexOf('var PLATFORM_META =')))});
  await page.evaluate(()=>{
   window.businessId='fixture-business';window.draftDocId='fixture-draft';window.publishCalls=0;window._firestoreApprove=async()=>{publishCalls++;};
   populateFromDraftData({status:'completed',name:'BlastyBiz',offer:'Long offer copy. '.repeat(60),phone:'941-375-1504',campaignId:'fixture-campaign',adId:'fixture-ad',adaptations:Object.fromEntries(BBPlatforms.records.filter(p=>['facebook','instagram','craigslist','fbmarket','nextdoor','yelp'].includes(p.id)).map(p=>[p.id,p.name+' full copy. '.repeat(80)])),imagesByPlatform:Object.fromEntries(BBPlatforms.records.filter(p=>['facebook','instagram','craigslist','fbmarket','nextdoor','yelp'].includes(p.id)).map(p=>[p.id,['https://example.test/photo1.png','https://example.test/photo2.png']]))});markBlastSubmitted();
  });
  for(const width of [320,360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   assert(!await page.locator('#pub-summary-card').isVisible(),'details start hidden');
   assert.equal(await page.locator('.pub-destination .bb-more[open]').count(),0,'secondary menus start closed');
   assert(!await page.locator('#publish-btn').isVisible(),'submitted status is not a duplicate button');
   assert(await page.locator('#pub-status-link').isVisible(),'track results remains available');
   const gaps=await page.locator('.pub-flow').evaluate(e=>{const children=[...e.children].filter(n=>getComputedStyle(n).display!=='none');return children.slice(1).map((n,i)=>n.getBoundingClientRect().top-children[i].getBoundingClientRect().bottom);});
   assert(gaps.every(g=>g>=11.9),'cards have breathing room '+JSON.stringify(gaps));
   const destination=page.locator('[data-destination="craigslist"]');
   assert(await destination.getByRole('button',{name:'Copy text',exact:true}).isVisible());
   assert(await destination.getByRole('link',{name:'Open Craigslist',exact:true}).isVisible());
   const labels=await destination.locator('.platform-photo span').evaluateAll(es=>es.map(e=>getComputedStyle(e).display));assert(labels.length===2&&labels.every(x=>x==='none'),'no numbered captions');
   const buttons=await destination.locator('.manual-primary-actions > *, .qp-photo-tools > button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();const card=e.closest('.pub-destination').getBoundingClientRect();return {height:r.height,left:r.left,right:r.right,cardLeft:card.left,cardRight:card.right};}));
   assert(buttons.every(b=>b.height>=44&&b.left>=b.cardLeft&&b.right<=b.cardRight),'primary tools fit their destination');
   await destination.getByRole('button',{name:'Copy text',exact:true}).click();assert((await page.evaluate(()=>copyCalls.at(-1))).includes('Craigslist full copy.'),'copy retains full text');
   await destination.locator('.bb-more > summary').click();
   assert.equal(await destination.locator('.bb-more-list button[aria-label^="Copy photo"]').count(),2,'secondary photo copy retained');
   const menu=await destination.locator('.bb-more-list').boundingBox();assert(menu.x>=0&&menu.x+menu.width<=width,'right-side menu fits');
   await destination.getByRole('button',{name:'View copy',exact:true}).click();assert(await destination.locator('textarea').isVisible());
   await page.locator('.pub-hero .bb-more > summary').click();await page.getByRole('button',{name:'Blast details',exact:true}).click();assert(await page.locator('#sb-offer').isVisible());
   await page.locator('.pub-hero .bb-more > summary').click();await page.getByRole('button',{name:'Blast details',exact:true}).click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page overflow');
   assert.equal(await page.locator('.pub-plat-type').filter({hasText:'Connect to auto-post'}).count(),2,'connection warnings preserved');
   console.log('PASS grouped destination tools, preserved details, full copy, right-side menus and no overflow at '+width);
  }
  assert.equal(await page.evaluate(()=>publishCalls),0,'layout interactions never publish');
  fs.mkdirSync('test-artifacts',{recursive:true});await page.setViewportSize({width:384,height:832});await page.screenshot({path:'test-artifacts/section4-preview.png',fullPage:true});
  if(process.env.PREVIEW_SCREENSHOT){await page.setViewportSize({width:390,height:844});await page.locator('.pub-flow').screenshot({path:process.env.PREVIEW_SCREENSHOT});}
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
