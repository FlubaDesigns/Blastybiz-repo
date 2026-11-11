'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID,createHash}=require('node:crypto');
async function run({chromium}){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert(process.env.GOOGLE_APPLICATION_CREDENTIALS);
 const origin='https://blastybiz.com',get=async file=>{const r=await fetch(origin+'/'+file+'?verify='+Date.now(),{signal:AbortSignal.timeout(30000)});assert(r.ok,file);return r.text();};
 assert.equal(JSON.parse(await get('release.json')).commit,process.env.RELEASE_SHA);
 const live={};for(const file of ['BlastyBiz.html','global-style.css','workspace-editor.js','ad-workspace.js','ai-generation.js','escape-utils.js','platforms-authority.js','business-form.js','photo-handoff.js']){
  live['public/'+file]=await get(file);assert.equal(live['public/'+file],fs.readFileSync('public/'+file,'utf8'),'exact live '+file);
 }
 await require('./test-section3.cjs').run({source:p=>{assert(Object.hasOwn(live,p),p);return live[p];}});
 const admin=require('../functions/node_modules/firebase-admin'),app=admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'blastybiz-9523e'},'section3-acceptance');
 const db=app.firestore(),auth=app.auth(),uid='section3_check_'+randomUUID().replaceAll('-',''),user=db.doc('users/'+uid),business=user.collection('businesses').doc('fixture');
 const campaign=business.collection('campaigns').doc('fixture'),ad=campaign.collection('ads').doc('first'),email=uid+'@example.invalid',password=randomUUID()+randomUUID(),ledgerRefs=[];
 let created=false,browser,page,stage='seed',rewriteCount=0;
 try{
  await auth.createUser({uid,email,password,emailVerified:true});created=true;
  await user.set({plan:'pro',activeBusiness:'fixture',acceptanceFixture:true,aiActionsUsed:0,createdAt:admin.firestore.FieldValue.serverTimestamp()});
  await business.set({name:'Post editor acceptance',sellerType:'business',locationType:'online',schedulingPaused:true,enabledPlatforms:['facebook']});
  await campaign.set({name:'Post editor acceptance',createdAt:new Date().toISOString()});
  await campaign.collection('images').doc('photo').set({url:origin+'/img/storefront.jpg',alt:'Selected acceptance photo',createdAt:new Date().toISOString()});
  const service=require('../functions/lib/ads').createAdService(db,admin);
  await service(uid,{action:'create',businessId:'fixture',campaignId:'fixture',adId:'first',requestId:'first',creative:{name:'Review this post',offer:'Weekend plants',platforms:['facebook'],imageRefs:[{id:'photo'}],adaptations:{facebook:'Original saved post\nWeekend plants'},platformStatus:{facebook:'approved'}}});
  const old=business.collection('listingDrafts').doc('previously_sent'),oldData={uid,businessId:'fixture',campaignId:'fixture',adId:'first',status:'completed',createdAt:new Date().toISOString(),packet:{adRevision:0,adaptations:{facebook:'Frozen sent post'}}};await old.set(oldData);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:384,height:832}});page.setDefaultTimeout(45000);
  stage='sign in';await page.goto(origin+'/BlastyBiz-Login?intent=signin');await page.locator('#si-email').fill(email);await page.locator('#si-password').fill(password);await page.locator('#btn-signin').click();await page.waitForURL(url=>!url.pathname.includes('Login'));
  const workspace=origin+'/BlastyBiz?bizId=fixture&cid=fixture&adId=first&tab=create&step=5';
  const ready=async()=>{await page.waitForFunction(()=>window._bbWorkspaceNavigationReady===true&&window.BBAds?.active?.id==='first');await page.evaluate(()=>createWizGoTo(5));await page.locator('#step5-destinations button').first().click();};
  stage='saved editor';await page.goto(workspace);await ready();assert.equal(await page.locator('#qp-copy-text-facebook').innerText(),'Original saved post\nWeekend plants');
  await page.waitForFunction(()=>document.querySelector('#qp-photo-strip-facebook img')?.naturalWidth>0);assert((await page.locator('#qp-photo-strip-facebook img').getAttribute('src')).includes('/img/storefront.jpg'));
  // Seed only this fixture's completed request result, then let the browser call
  // the real deployed handler. This tests cached delivery without buying AI.
  await page.route('**/adaptListing',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   const body=route.request().postDataJSON();assert.equal(body.listing.businessId,'fixture');assert.equal(body.listing.adId,'first');assert(body.rewrite.direction&&body.rewrite.source);rewriteCount++;
   const ref=db.doc('aiRequestDedup/'+uid+'_'+body.listing.requestId);ledgerRefs.push(ref);
   const fingerprint=createHash('sha256').update(JSON.stringify({...body,listing:{...body.listing,requestId:undefined},requestId:undefined,generationAttemptId:undefined})).digest('hex');
   await ref.set({uid,fingerprint,state:'completed',token:'fixture',result:{adaptations:{facebook:'Reviewed rewrite '+rewriteCount+'\nWeekend plants'},failedPlatforms:[],status:'complete',freeRegenApplied:false},createdAt:admin.firestore.FieldValue.serverTimestamp()});
   await route.continue();
  });
  for(const label of ['Shorter','More local','More upbeat']){
   stage=label;await page.getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(()=>!window._bbAdaptationBusy&&!window._bbDraftSavePending);
   const current=(await ad.get()).data();assert.equal(current.adaptations.facebook,'Reviewed rewrite '+rewriteCount+'\nWeekend plants');assert.equal(current.platformStatus.facebook,'needs-review');assert.equal(current.imageRefs[0].id,'photo');
  }
  stage='custom direction';await page.locator('.s5-rewrite-details > summary').click();await page.locator('#qp-direction-facebook').fill('Keep the price; emphasize weekend pickup.');await page.locator('#qp-regen-facebook').click();await page.waitForFunction(()=>!window._bbAdaptationBusy&&!window._bbDraftSavePending);assert.equal(rewriteCount,4);
  stage='Undo';await page.locator('#qp-undo-facebook').click();await page.waitForFunction(()=>!window._bbDraftSavePending);assert.equal(rewriteCount,4);assert.equal((await ad.get()).data().adaptations.facebook,'Reviewed rewrite 3\nWeekend plants');assert.equal((await ad.get()).data().platformStatus.facebook,'needs-review');
  stage='manual edit';await page.locator('#qp-copy-text-facebook').fill('Final edited post\nWeekend plants');await page.locator('#step5-lgtm-facebook').click();await page.waitForFunction(()=>window.BBAds.active.platformStatus.facebook==='approved'&&!window.BBAds.busy);assert.equal((await ad.get()).data().adaptations.facebook,'Final edited post\nWeekend plants');
  stage='reload';await page.reload();await ready();assert.equal(await page.locator('#qp-copy-text-facebook').innerText(),'Final edited post\nWeekend plants');assert.equal(await page.locator('#qp-undo-facebook').isVisible(),false);
  for(const width of [320,384,430,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'live no overflow '+width);}
  assert.deepEqual((await old.get()).data(),oldData,'sent Blast unchanged');assert.equal((await business.collection('publishJobs').get()).size,0);assert.equal((await user.get()).data().aiActionsUsed,0);assert.equal((await db.collection('aiUsageLogs').where('uid','==',uid).get()).size,0);
  const token=await page.evaluate(async()=>{const {auth}=await import('./firebase-init-v2.js');return auth.currentUser.getIdToken();});
  for(const [body,authorized,status] of [[{},false,401],[{listing:{businessId:'not-owned'},platforms:[{id:'facebook'}],isRegeneration:true,rewrite:{source:'Copy',direction:'Shorter'}},true,404],[{listing:{businessId:'fixture'},platforms:[{id:'facebook'}],isRegeneration:true,rewrite:{source:'Copy',direction:''}},true,400]]){
   const res=await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/adaptListing',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(authorized?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});assert.equal(res.status,status);
  }
  fs.mkdirSync('test-artifacts',{recursive:true});for(const width of [384,1280]){await page.setViewportSize({width,height:900});await page.screenshot({path:'test-artifacts/section3-live-'+width+'.png',fullPage:true});}
  console.log('PASS LIVE section 3: exact deployed editor; authenticated selected photo/copy; three presets and custom direction through real cached handler; real Ad save, Undo, approval and reload; unchanged sent Blast; unsigned/foreign/invalid request rejection; no AI spend or publication. Model output and failure/race cases fixture-tested.');
 }catch(e){fs.mkdirSync('test-artifacts',{recursive:true});if(page)await page.screenshot({path:'test-artifacts/section3-live-failure.png',fullPage:true}).catch(()=>{});throw Error(stage+': '+e.message);}
 finally{
  if(browser)await browser.close();for(const ref of ledgerRefs)await ref.delete();await db.recursiveDelete(user);
  for(const name of ['activityLogs','aiUsageLogs']){const rows=await db.collection(name).where('uid','==',uid).get();for(const row of rows.docs)await row.ref.delete();}
  if(created)await auth.deleteUser(uid);await app.delete();
 }
}
module.exports={run};
