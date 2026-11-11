'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
async function run({chromium}){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert(process.env.GOOGLE_APPLICATION_CREDENTIALS);
 const origin='https://blastybiz.com',get=async file=>{const r=await fetch(origin+'/'+file+'?verify='+Date.now(),{signal:AbortSignal.timeout(30000)});assert(r.ok,file);return r.text();};
 assert.equal(JSON.parse(await get('release.json')).commit,process.env.RELEASE_SHA);
 const files=['BlastyBiz-Home.html','BlastyBiz-Start.html','BlastyBiz-Login.html','BlastyBiz-CreateBiz.html','BlastyBiz-Listing-Preview.html','BlastyBiz.html','global-style.css','escape-utils.js','business-form.js','website-utils.js','blasty-registry.js','blasty-events.js','blasty-guidance.js','home-demo.js','post-preview.js','business-import.js','setup-import.js','platforms-authority.js','workspace-campaigns.js'];
 const live={};for(const file of files){live['public/'+file]=await get(file);assert.equal(live['public/'+file],fs.readFileSync('public/'+file,'utf8'),file+' exact deployed source');}
 await require('./test-section2.cjs').run({source:file=>{assert(Object.hasOwn(live,file),file);return live[file];}});
 const admin=require('../functions/node_modules/firebase-admin'),app=admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'blastybiz-9523e'},'section2-acceptance');
 const db=app.firestore(),auth=app.auth(),uid='section2_check_'+randomUUID().replaceAll('-',''),user=db.doc('users/'+uid),email=uid+'@example.invalid',password=randomUUID()+randomUUID();
 let created=false,browser,page;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:384,height:900}});page.setDefaultTimeout(45000);
  await page.goto(origin+'/BlastyBiz-Home');await page.locator('[data-demo-platform="instagram"]').click();assert.match(await page.locator('.pub-post-text').innerText(),/#PlantShop/);await page.locator('.pub-post-photo img').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('.pub-post-photo img')?.naturalWidth>0);
  await page.locator('.hero-actions a').click();await page.waitForURL(/BlastyBiz-Login/);await page.locator('#auth-card-wrap.ready').waitFor();assert(await page.locator('#form-signup').isVisible());
  for(const returning of [false,true])for(const start of ['guided','forms']){
   if(returning)await page.evaluate(()=>localStorage.setItem('bb_guide_done','1'));
   await page.goto(origin+'/BlastyBiz-Start?start='+start);await page.waitForURL(/BlastyBiz-Login/);await page.locator('#auth-card-wrap.ready').waitFor();assert(await page.locator('#form-signup').isVisible());
   await page.locator('#tab-signin').click();assert(await page.locator('#form-signin').isVisible());
  }
  await auth.createUser({uid,email,password,emailVerified:true});created=true;
  // No email in the Firestore account: the unchanged business-created trigger exits before mailing.
  await user.set({plan:'starter',acceptanceFixture:true,setupHandoff:{sellerType:'business',ownerFirstName:'Section',ownerLastName:'Two',ownerRole:'Owner',phone:'555-555-1234',email},createdAt:admin.firestore.FieldValue.serverTimestamp()});
  await page.goto(origin+'/BlastyBiz-Login?intent=signin');await page.locator('#si-email').fill(email);await page.locator('#si-password').fill(password);await page.locator('#btn-signin').click();
  await page.waitForURL(/BlastyBiz-CreateBiz/);await page.waitForFunction(()=>window._cbReady===true);
  assert.equal(await page.locator('#f-ownerName').inputValue(),'Section');assert.equal(await page.locator('#setup-contact').getAttribute('open'),null);assert.equal(await page.locator('#cbs-story').getAttribute('class'),'cb-section');assert.equal(await page.locator('#setup-import').isVisible(),true);
  // Exercise the real import request without spending AI allowance: the release marker is short text.
  await page.locator('#setup-import-url').fill(origin+'/release.json');await page.locator('#setup-import-button').click();await page.waitForFunction(()=>document.getElementById('setup-import-status').textContent.includes("couldn't read much"));assert.equal(await page.locator('#f-bizName').inputValue(),'');
  const token=await page.evaluate(async()=>{const {auth}=await import('./firebase-init-v2.js');return auth.currentUser.getIdToken();});
  const api='https://us-central1-blastybiz-9523e.cloudfunctions.net/extractBizContext';
  for(const [body,headers,status] of [[{setup:true,sourceUrl:origin+'/release.json'},{},401],[{setup:true,bizId:'not-owned',sourceUrl:origin+'/release.json'},{Authorization:'Bearer '+token},403]]){const r=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});assert.equal(r.status,status);}
  await page.locator('#f-bizName').fill('Section two acceptance');await page.locator('#f-hasWebsite').selectOption('no');await page.locator('#f-campName').fill('First saved post');await page.locator('#f-about').fill('Keep this exact draft after reloading.');
  await page.reload();await page.waitForFunction(()=>window._cbReady===true);assert.equal(await page.locator('#f-about').inputValue(),'Keep this exact draft after reloading.');assert.equal(await page.locator('#f-bizName').inputValue(),'Section two acceptance');
  await page.route('**/BlastyBiz-Choose-Plan*',r=>r.abort());
  const savedResponse=page.waitForResponse(r=>r.url().endsWith('/createBusiness')&&r.request().method()==='POST');await page.locator('#cb-submit').click();const saved=await savedResponse;assert.equal(saved.status(),200);const {bizId}=await saved.json();assert(bizId);
  const business=user.collection('businesses').doc(bizId),biz=(await business.get()).data();assert.equal(biz.businessName,'Section two acceptance');
  const campaigns=await business.collection('campaigns').get();assert.equal(campaigns.size,1);const campaign=campaigns.docs[0];assert.equal(campaign.data().story,'About this campaign: Keep this exact draft after reloading.');
  const ads=await campaign.ref.collection('ads').get();assert.equal(ads.size,1);assert.equal(ads.docs[0].data().status,'draft');assert.equal(ads.docs[0].data().name,'First saved post');assert.equal((await business.collection('publishJobs').get()).size,0);
  await page.goto(origin+'/BlastyBiz-CreateBiz?bizId='+encodeURIComponent(bizId));await page.waitForFunction(()=>window._cbReady===true);assert.equal(await page.locator('#f-bizName').inputValue(),'Section two acceptance');
  const usage=await db.collection('aiUsageLogs').where('uid','==',uid).get();assert.equal(usage.size,0,'no paid AI call');
  fs.mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/section2-live-setup-384.png',fullPage:true});
  console.log('PASS LIVE section 2: exact assets; real homepage tabs and direct signup; fresh/returning guided/forms and explicit sign-in; authenticated setup prefills/recovery; real import thin-source and unsigned/cross-business rejection; first business/campaign/Ad saved and reopened from Firestore. Isolated fixture only, no paid AI, customer email, payment or publication. Successful AI-output review is fixture-tested.');
 }finally{
  if(browser)await browser.close();await db.recursiveDelete(user);await db.doc('extractBizContextRate/'+uid).delete();await db.doc('setupNudges/'+uid).delete();
  for(const name of ['activityLogs','aiUsageLogs']){const rows=await db.collection(name).where('uid','==',uid).get();for(const row of rows.docs)await row.ref.delete();}
  if(created)await auth.deleteUser(uid);await app.delete();
 }
}
module.exports={run};
