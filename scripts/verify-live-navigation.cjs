'use strict';
// Existing Authorization Engine identity; ordinary sign-in, isolated records,
// no provider connections, no publishing action, and cleanup even on failure.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async function verifyLiveNavigation({chromium,origin}){
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||!process.env.GOOGLE_APPLICATION_CREDENTIALS||origin!=='https://blastybiz.com')throw Error('Navigation acceptance requires the Authorization Engine Main identity');
  const admin=require('../functions/node_modules/firebase-admin');
  const app=admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'blastybiz-9523e'},'navigation-acceptance');
  const db=app.firestore(),auth=app.auth(),uid='navigation_check_'+randomUUID().replaceAll('-','');
  const user=db.doc('users/'+uid),business=user.collection('businesses').doc('fixture');
  const campaign=business.collection('campaigns').doc('fixture'),ad=campaign.collection('ads').doc('first');
  const email=uid+'@example.invalid',password=randomUUID()+randomUUID();
  let created=false,browser;
  try{
    await auth.createUser({uid,email,password,emailVerified:true});created=true;
    await user.set({plan:'pro',activeBusiness:'fixture',acceptanceFixture:true,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    const service=require('../functions/lib/ads').createAdService(db,admin);
    for(const id of ['fixture','other']){
      const br=user.collection('businesses').doc(id);
      await br.set({name:'Navigation acceptance '+id,sellerType:'business',locationType:'online',schedulingPaused:true,enabledPlatforms:['craigslist']});
      await br.collection('campaigns').doc('fixture').set({name:'Navigation acceptance',createdAt:new Date().toISOString()});
      await service(uid,{action:'create',businessId:id,campaignId:'fixture',adId:'first',requestId:'first',creative:{name:'Navigation acceptance',offer:'Original saved offer',price:'',cta:'',context:'',platforms:['craigslist'],adaptations:{craigslist:'Approved acceptance copy'},platformStatus:{craigslist:'approved'}}});
    }
    const old=business.collection('listingDrafts').doc('previously_sent');
    const oldData={uid,businessId:'fixture',campaignId:'fixture',adId:'first',status:'completed',createdAt:new Date().toISOString(),packet:{adRevision:0,adaptations:{craigslist:'Frozen old copy'}}};
    await old.set(oldData);
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:384,height:832}});
    page.setDefaultTimeout(60000);
    await page.goto(origin+'/BlastyBiz-Login?intent=signin');
    await page.locator('#si-email').fill(email);await page.locator('#si-password').fill(password);
    await page.locator('#btn-signin').click();
    await page.waitForURL(url=>!url.pathname.includes('Login'));
    const workspace=origin+'/BlastyBiz?bizId=fixture&cid=fixture&adId=first&tab=create&step=1';
    const ready=()=>page.waitForFunction(()=>window._bbWorkspaceNavigationReady&&window.BBAds?.active?.id==='first');
    await page.goto(workspace);await ready();
    await page.locator('#biz-offer').fill('Current edited offer');
    await page.locator('#tab-preview').click();
    await page.waitForFunction(()=>!window.BBAds.busy&&document.querySelector('.create-slide.cwiz-active')?.id==='create-slide-5');
    assert.equal((await ad.get()).data().offer,'Current edited offer','Continue persists current edits');
    assert.deepEqual((await old.get()).data(),oldData,'Continue preserves sent records');
    await page.locator('#tab-platforms').click();await page.locator('#tab-create').click();
    assert.equal(await page.locator('.create-slide.cwiz-active').getAttribute('id'),'create-slide-5');
    await page.goBack();await page.waitForFunction(()=>!window._bbRestoringWorkspace&&document.querySelector('.section.active')?.id==='section-platforms');
    await page.goForward();await page.waitForFunction(()=>!window._bbRestoringWorkspace&&document.querySelector('.section.active')?.id==='section-create');
    await page.reload();await ready();
    assert.equal(await page.locator('.create-slide.cwiz-active').getAttribute('id'),'create-slide-5','Reload keeps Review');
    await page.locator('#step5-lgtm-craigslist').click();
    await page.waitForFunction(()=>document.querySelector('#step5-lgtm-craigslist')?.classList.contains('approved'));
    await page.locator('#tab-preview').click();
    await page.waitForURL(url=>url.pathname.includes('Listing-Preview'));
    await page.locator('#pub-back-to-ad').waitFor({state:'visible'});
    const blastId=new URL(page.url()).searchParams.get('draftId');assert.notEqual(blastId,'previously_sent');
    const prepared=(await business.collection('listingDrafts').doc(blastId).get()).data();
    assert.equal(prepared.packet.offer,'Current edited offer');
    assert.equal(prepared.packet.adRevision,(await ad.get()).data().revision);
    await page.locator('#pub-back-to-ad').click();await ready();
    assert.equal(new URL(page.url()).searchParams.get('adId'),'first');
    assert.equal(await page.locator('.create-slide.cwiz-active').getAttribute('id'),'create-slide-5');
    await page.locator('#tab-preview').click();await page.waitForURL(url=>url.pathname.includes('Listing-Preview'));
    assert.equal(new URL(page.url()).searchParams.get('draftId'),blastId,'Unchanged current work reuses its prepared Blast');
    await page.locator('#pub-back-to-ad').click();await ready();
    await page.evaluate(()=>{void window.switchBusiness('other');});
    await page.waitForURL(url=>url.searchParams.get('bizId')==='other');await ready();
    assert.equal(await page.evaluate(()=>window.activeBizId),'other','Business switch clears old navigation context');
    assert.equal((await user.get()).data().activeBusiness,'other');
    assert.equal((await business.collection('publishJobs').get()).size,0,'Acceptance never publishes');
    assert.deepEqual((await old.get()).data(),oldData);
    console.log('PASS LIVE AUTHENTICATED mobile navigation: persisted current edits, Review/tab/Back/Forward/reload continuity, correct prepared preview and return, duplicate prevention, business switch, immutable sent Blast; no post dispatched.');
  }finally{
    if(browser)await browser.close();
    for(const collection of ['aiUsageLogs','activityLogs']){
      const rows=await db.collection(collection).where('uid','==',uid).get();
      for(const row of rows.docs)await row.ref.delete();
    }
    await db.recursiveDelete(user);await db.collection('setupNudges').doc(uid).delete();
    if(created)await auth.deleteUser(uid);
    await app.delete();
  }
};
