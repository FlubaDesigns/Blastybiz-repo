'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const {database,admin}=require('./lib/test-firestore.cjs');
const {createAdService}=require('../functions/lib/ads');
const read=p=>fs.readFileSync(p,'utf8');
const dashboard=read('public/BlastyBiz.html');
const cut=(a,b)=>dashboard.slice(dashboard.indexOf(a),dashboard.indexOf(b,dashboard.indexOf(a)));
const setup=read('public/BlastyBiz-CreateBiz.html');
const classic=[...setup.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(m=>!m[1].includes('src=')&&!m[1].includes('module')&&!m[1].includes('importmap'))[2];
const turn=()=>new Promise(r=>setImmediate(r));
(async()=>{
  // The same location rule controls setup, platform selection and ad review.
  {
    const dom=new JSDOM(dashboard,{url:'https://example.invalid',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
    const w=dom.window;
    w.eval(read('public/platforms-authority.js'));
    Object.assign(w,{profile:{locationType:'online'},platforms:[{id:'google',name:'Google',enabled:true,adaptedContent:'Existing Google copy'},{id:'facebook',name:'Facebook',enabled:true}],escHtml:String,savePlatformSelections(){},savePlatforms(){},checkAdaptBtn(){},renderQuickSelect(){},updateStats(){},buildPlatformCard(p){const card=w.document.createElement('div');card.id='pcard-'+p.id;return card;},_renderDismissedFold(){}});
    w.eval(cut('function platformEligible(', 'function _renderDismissedFold('));
    w.eval(cut('function renderStep3Platforms()', '// STEP 5: PER-PLATFORM REVIEW'));
    w.eval(cut('function toggleSelectAll()', '// CHAR COUNTER'));
    w.eval(cut('function getStep5Platforms()', '// Bring a platform'));
    w.renderPlatforms();w.renderStep3Platforms();
    assert.equal(w.document.getElementById('s3-row-google'),null,'online profile has no Google choice');
    assert.equal(w.document.getElementById('pcard-google'),null,'online platform page has no Google card');
    assert.equal(w.platforms[0].enabled,false,'old selections cannot leave a hidden Google destination enabled');
    assert.equal(w.platforms[0].adaptedContent,'Existing Google copy','filter does not erase wording');
    w.toggleSelectAll();w.toggleSelectAll();w.togglePlatform('google',true);
    assert.equal(w.platforms[0].enabled,false,'Select All and direct toggles respect online eligibility');
    assert.equal(w.getStep5Platforms().some(p=>p.id==='google'),false);
    for(const locationType of ['physical','both']){
      w.profile.locationType=locationType;w.renderStep3Platforms();
      assert(w.document.getElementById('s3-row-google'),'local businesses retain Google');
    }
    dom.window.close();
    const setupDom=new JSDOM(setup,{url:'https://example.invalid',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
    const s=setupDom.window;s.eval(read('public/platforms-authority.js'));
    s.eval(classic.slice(classic.indexOf('function cbPersonal()'),classic.indexOf('function cbSyncLocation()')));
    s.document.getElementById('plat-grid-wrap').innerHTML='<label class="plat-chk"><input type="checkbox" value="google" checked></label><label class="plat-chk"><input type="checkbox" value="facebook" checked></label>';
    s.document.getElementById('f-sellerType').value='business';s.document.getElementById('f-locationType').value='online';s.cbSyncPlatformEligibility();
    const google=s.document.querySelector('input[value="google"]'),facebook=s.document.querySelector('input[value="facebook"]');
    assert.equal(google.checked,false);assert.equal(google.disabled,true);assert.equal(google.parentElement.style.display,'none');assert.equal(facebook.checked,true);
    s.document.getElementById('f-locationType').value='physical';s.cbSyncPlatformEligibility();assert.equal(google.disabled,false);assert.equal(google.parentElement.style.display,'');
    setupDom.window.close();
  }
  for(const sellerType of ['business','personal']){
    const dom=new JSDOM(setup,{url:'https://example.invalid/setup',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
    const w=dom.window;
    w.matchMedia=()=>({matches:true});w.HTMLElement.prototype.scrollIntoView=function(){};
    for(const f of ['business-form.js','website-utils.js','blasty-registry.js','blasty-events.js','blasty-guidance.js','guided-setup.js'])w.eval(read('public/'+f));
    w.eval(classic);w._cbReady=true;
    const phone=w.document.getElementById('f-phone');
    w.document.getElementById('f-sellerType').value=sellerType;w.cbConfigureForm();
    w.document.getElementById('plat-grid-wrap').innerHTML='<label class="plat-chk"><input type="checkbox" value="facebook" checked>Facebook</label>';
    let saved=0;w.cbSubmit=async()=>{saved++;};w._cbStartGuide();
    const guide=w._cbBlasty;guide.render();
    assert.equal(w.document.querySelectorAll('#f-sellerType').length,1);
    assert(w.document.getElementById('gs-input').contains(w.document.getElementById('f-sellerType')));
    const seen=[];
    for(let n=0;n<40&&saved===0;n++){
      const step=guide.steps[guide.idx];seen.push(step.field||step.group);
      if(step.field){
        const field=w.document.getElementById(step.field);
        const values={'f-sellerType':sellerType,'f-ownerName':'David','f-bizName':'Test Company','f-role':'Owner','f-email':'test@example.com','f-phone':'9413751504','f-locationType':'physical','f-hasWebsite':'no','f-campName':'GEM electric vehicle'};
        field.value=values[step.field]??(field.required?'Test answer':'');
        field.dispatchEvent(new w.Event('input',{bubbles:true}));
        field.dispatchEvent(new w.Event('change',{bubbles:true}));
        if(step.field==='f-phone')assert.equal(field.value,'941-375-1504');
      }
      guide.next();await turn();
      assert.equal(w.document.getElementById('gs-err').textContent,'');
    }
    assert.equal(saved,1,'guided save reached for '+sellerType);
    assert.equal(seen[0],'f-sellerType');
    assert.equal(seen.includes('f-bizName'),sellerType==='business');
    assert.equal(seen.includes('f-story'),sellerType==='business');
    assert(seen.includes('cb-marketing-preferences'));
    assert.equal(w.document.querySelectorAll('input[id],textarea[id],select[id]').length,new Set([...w.document.querySelectorAll('input[id],textarea[id],select[id]')].map(n=>n.id)).size,'one physical control per field');
    // Clicking an earlier answer edits the same input; stopping restores it.
    const answer=[...w.document.querySelectorAll('.gs-answer')].find(b=>b.textContent.includes('941-375-1504'));
    assert(answer);answer.click();assert(w.document.getElementById('gs-input').contains(phone));
    phone.value='941-555-0100';guide.next();guide.stop();
    assert.equal(w.document.getElementById('f-phone'),phone);assert.equal(phone.value,'941-555-0100');
    assert(w.document.getElementById('cb-form').contains(phone));
    dom.window.close();
  }
  // Test the actual Ad service and UI together: no active campaign yet,
  // save/edit/reopen, and delayed reads for two campaign selections.
  const base='users/u/businesses/b',camp=base+'/campaigns/c',other=base+'/campaigns/d';
  const state=database({[base]:{name:'Seller'},[camp]:{name:'GEM'},[other]:{name:'Other'}});
  const service=createAdService(state.db,admin);
  const dom=new JSDOM('<div id="campaign-content"></div><input id="biz-ad-name"><textarea id="biz-offer"></textarea><input id="biz-price">',{url:'https://example.invalid',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  const w=dom.window;
  Object.assign(w,{activeBizId:'b',activeCampaignId:'',activeCampaignName:'',platforms:[{id:'facebook',enabled:true}],ynState:{},_bbGetToken:async()=> 'fixture',_bbLoadGlobalImages:async()=>[],_bbLoadCampaignImages:async()=>[]});
  let releaseSlow,slow=false,releaseSave,delaySave=false,failSave=false,aiCalls=0,lastPrepared;
  w._bbFetchWithTimeout=async(url,opt)=>{
    const body=JSON.parse(opt.body);
    if(url.endsWith('/adaptListing')){aiCalls++;failSave=true;return {ok:true,json:async()=>({adaptations:{facebook:'New AI copy'},freeRegenApplied:true})};}
    if(failSave&&body.action==='save')throw Error('offline');
    if(slow&&body.action==='list'&&body.campaignId==='c')await new Promise(r=>releaseSlow=r);
    const data=await service('u',body);if(body.action==='prepare')lastPrepared=data;if(delaySave&&body.action==='save'){delaySave=false;await new Promise(r=>releaseSave=r);}return {ok:true,json:async()=>data};
  };
  w.eval(read('public/business-form.js'));w.eval(read('public/ad-workspace.js'));
  await w.BBAds.api('create',{campaignId:'c',adId:'first',requestId:'first',creative:{name:'GEM',offer:'Original item',platforms:['facebook']}});
  await w.BBAds.api('create',{campaignId:'d',adId:'first',requestId:'first',creative:{name:'Other item',platforms:['facebook']}});
  w.activeCampaignId='c';w.activeCampaignName='GEM';await w.BBAds.open();await w.BBAds.ready();
  w.document.getElementById('biz-offer').value='Changed item';w.BBAds.markDirty();await w.BBAds.save();
  await w.BBAds.open();assert.equal(w.document.getElementById('biz-offer').value,'Changed item');
  assert.equal(state.get(camp+'/ads/first').offer,'Changed item');assert.equal(state.get(camp).offer,undefined,'campaign has no competing creative value');
  // Edits made while the response is delayed survive and are persisted before save resolves.
  delaySave=true;
  w.document.getElementById('biz-offer').value='First edit';w.BBAds.markDirty();
  const saving=w.BBAds.save();await turn();
  w.document.getElementById('biz-offer').value='Latest edit';w.BBAds.markDirty();
  releaseSave();await saving;await w.BBAds.open();
  assert.equal(w.document.getElementById('biz-offer').value,'Latest edit');
  const copy=w.document.createElement('div');copy.id='qp-copy-text-facebook';copy.setAttribute('contenteditable','true');w.document.body.appendChild(copy);
  copy.textContent='Edited generated copy';copy.dispatchEvent(new w.Event('input',{bubbles:true}));
  await w.BBAds.save();await w.BBAds.open();
  assert.equal(w.BBAds.active.adaptations.facebook,'Edited generated copy');
  assert.equal(w.BBAds.active.platformStatus.facebook,'needs-review');
  Object.assign(w,{profile:{name:'Seller'},bizInsights:[],campaigns:[],showToast(){},savePlatforms(){},updateStep5UI(){},_getAIMemory:()=>({}),_afterAdaptation:async()=> 'working-draft'});
  w.eval(cut('let generatedDraftSaving = false;','async function runAdaptation'));
  w.eval(cut('async function regeneratePlatformCopy','function saveStepCat'));
  await w.regeneratePlatformCopy('facebook');
  assert.equal(aiCalls,1);assert.equal(w.platforms[0].adaptedContent,'New AI copy','failed save retains paid copy');
  assert.equal(w._bbDraftSavePending,true);
  failSave=false;assert.equal(await w.retryGeneratedDraftSave(),true);assert.equal(aiCalls,1,'retry save makes no AI request');
  await w.BBAds.open();assert.equal(w.BBAds.active.adaptations.facebook,'New AI copy','regenerated copy reopens from Ad');
  w.platforms.push({id:'google',enabled:true,adaptedContent:'Google copy',_reviewStatus:'needs-review'});
  await w.BBAds.save();
  delaySave=true;const statusSave=w.BBAds.save();await turn();
  w.platforms[0]._reviewStatus='approved';w.platforms[1]._reviewStatus='skipped';
  releaseSave();await statusSave;await w.BBAds.open();
  assert.equal(w.platforms[0]._reviewStatus,'approved','approval during an earlier save survives');
  assert.equal(w.platforms[1]._reviewStatus,'skipped','excluded destination remains skipped on reopen');
  // A late platform-connection response must not erase the loaded Ad copy.
  Object.assign(w,{PLATFORMS:[{id:'facebook',enabled:false},{id:'google',enabled:false}],BBPlatforms:{normalizeSelection:p=>p},renderPlatforms(){},renderQuickSelect(){},updateStats(){},_bbPlatformUrls:{},db:{},user:{uid:'u'},collection:(...args)=>args,query:x=>x,_enabledPlatformIds:[],getDocs:async()=>({empty:false,forEach:fn=>fn({id:'facebook',data:()=>({platform:'facebook',status:'connected'})})})});
  w.eval(cut('window._bbSetPlatforms = function(', 'window._bbSetHistory ='));
  const loadConnections=()=>w.eval('(async()=>{'+cut('// Load platform connection state from Firestore','// Load recent publish history from Firestore')+'})()');
  await loadConnections();
  assert.equal(w.platforms[0].adaptedContent,'New AI copy','late connections preserve saved generated copy');
  assert.equal(w.platforms[0]._reviewStatus,'approved','late connections preserve review decisions');
  assert.equal(w.platforms[0].status,'connected','connection metadata still updates');
  // Continue runs the production save and navigation paths without generating.
  Object.assign(w,{_bbPhotoUploads:[],_campaignSaveTimer:null,saveDraft(){},runAdaptation(){aiCalls++;},renderStep5Review(){},renderStep3Platforms(){},checkS3ContinueBtn(){},updateCopyPreview(){},scrollTo(){},_currentDraftId:'working-draft'});
  w.eval(cut('let createWizStep = 1;', 'function toggleAboutYouPanel()'));
  const nav=new JSDOM(dashboard).window.document.getElementById('slide1-nav-row');
  w.document.body.insertAdjacentHTML('beforeend',nav.outerHTML);
  w.eval(cut('function checkS3ContinueBtn()', '// STEP 5: PER-PLATFORM REVIEW'));
  w.checkS3ContinueBtn();assert.equal(w.document.getElementById('s3-saved-copy-btn').disabled,false);
  assert.equal(w.document.getElementById('s3-saved-copy-btn').hidden,false,'saved copy is visible when the canonical Ad has wording');
  const callsBefore=aiCalls;await w.eval(w.document.getElementById('s3-saved-copy-btn').getAttribute('onclick'));
  assert.equal(aiCalls,callsBefore,'reopen and Continue do not generate over saved copy');
  assert.equal(state.get(camp+'/ads/first').adaptations.facebook,'New AI copy','Continue preserves persisted wording');
  await w.BBAds.open();assert.equal(w.platforms[0].adaptedContent,'New AI copy','saved wording still reopens after Continue');
  await w.eval(w.document.getElementById('s3-continue-btn').getAttribute('onclick'));
  assert.equal(aiCalls,callsBefore+1,'Generate New Copy explicitly requests generation');
  await w.BBAds.prepareCurrent();
  assert.deepEqual([...lastPrepared.packet.enabledPlatforms],['facebook'],'prepared Blast excludes skipped destinations');
  // Forward navigation reopens the submitted Blast without saving, preparing,
  // resetting approval, or invoking any publishing API.
  w.document.body.insertAdjacentHTML('beforeend','<div id="step5-existing-blast" hidden><a id="step5-view-blast" data-existing-blast></a></div>');
  const sentId=lastPrepared.blastId;
  await state.db.doc(base+'/listingDrafts/'+sentId).update({status:'approved'});
  w._bbFindLatestBlast=async()=>({id:sentId,status:'approved'});
  const beforeNavigation=JSON.stringify(state.all());
  await w.BBAds.open();await w.BBAds.continueCurrent();await w.BBAds.continueCurrent();
  assert.equal(JSON.stringify(state.all()),beforeNavigation,'opening and continuing make no persistent changes');
  assert.equal(w.document.getElementById('step5-existing-blast').hidden,false);
  assert(w.document.getElementById('step5-view-blast').href.includes('draftId='+sentId),'direct view uses existing identity');
  w._bbFindLatestBlast=async()=>{throw Error('History offline');};
  await assert.rejects(w.BBAds.continueCurrent(),/History offline/);
  assert.equal(JSON.stringify(state.all()),beforeNavigation,'failed history read never falls through to create another Blast');
  await w.BBAds.continueCurrent(true);
  assert.notEqual(lastPrepared.blastId,sentId,'only explicit Prepare Another Blast creates a fresh packet');
  assert.equal(state.get(base+'/listingDrafts/'+sentId).status,'approved','submitted status stays frozen');
  w._bbFindLatestBlast=undefined;
  const navigationCode=cut('async function completeBlast(', '// IMAGE HANDLING');
  assert(!navigationCode.includes('_bbUpdateDraft')&&!navigationCode.includes('addHistory('),'Continue never resets status or invents publishing history');
  assert(!dashboard.includes('Send It →'),'navigation never says Send It');
  const finderDom=new JSDOM('',{runScripts:'outside-only'}),fw=finderDom.window;
  const rows=[
    {id:'sent',adId:'first',status:'approved',createdAt:'2026-10-01'},
    {id:'unsent',adId:'first',status:'prepared',createdAt:'2026-10-02'},
    {id:'other-ad',adId:'second',status:'approved',createdAt:'2026-10-03'},
    {id:'schedule',adId:'first',status:'approved',scheduleAdPath:'schedule',createdAt:'2026-10-04'}
  ];
  Object.assign(fw,{currentUser:{uid:'u'},db:{},collection:(...args)=>args,query:x=>x,where:()=>null,getDocs:async()=>({docs:rows.map(data=>({id:data.id,data:()=>data}))})});
  fw.eval(cut('window._bbFindLatestBlast =', '// Update an existing listingDraft document'));
  assert.equal((await fw._bbFindLatestBlast('b','c','first')).id,'sent','existing sent Blast wins over unused drafts and excludes other Ads and schedules');
  finderDom.window.close();
  slow=true;const old=w.BBAds.open();await turn();
  assert(w.document.getElementById('campaign-content').inert);
  w.activeCampaignId='d';w.activeCampaignName='Other';await w.BBAds.open();releaseSlow();await old;
  assert.equal(w.BBAds.active.name,'Other item');assert.equal(w.document.getElementById('biz-ad-name').value,'Other item');
  assert.equal(w.document.getElementById('campaign-content').inert,false);
  w.checkS3ContinueBtn();assert.equal(w.document.getElementById('s3-saved-copy-btn').disabled,true,'no saved copy disables viewing');
  assert.equal(w.document.getElementById('s3-saved-copy-btn').hidden,true,'no saved copy hides the button');
  assert(w.document.getElementById('s3-saved-copy-btn').classList.contains('hidden'),'mobile button styling cannot override hidden state');
  w.platforms[0].adaptedContent='Unsaved generated wording';w.checkS3ContinueBtn();
  assert.equal(w.document.getElementById('s3-saved-copy-btn').hidden,true,'unsaved wording does not masquerade as saved copy');
  w.platforms[0].adaptedContent='';
  const beforeEmptyView=aiCalls;await w.createWizNext(1);w.createWizGoTo(5);
  assert.equal(aiCalls,beforeEmptyView,'view and navigation never generate even when saved copy is absent');
  await state.db.doc(base+'/campaigns/empty').set({name:'Fresh campaign',campaignStory:'The campaign details I just typed.'});
  w.activeCampaignId='empty';w.activeCampaignName='Fresh campaign';await w.BBAds.open();await w.BBAds.ready();
  assert.equal(w.BBAds.active.context,'The campaign details I just typed.','missing Ad recovers current campaign text');
  w.document.getElementById('biz-offer').value='The new offer I just typed';w.BBAds.markDirty();await w.BBAds.save();
  await w.BBAds.open();assert.equal(w.document.getElementById('biz-offer').value,'The new offer I just typed','fresh edits survive recovery, save and reopen');
  assert.equal(Object.keys(state.all()).filter(p=>p.startsWith(base+'/campaigns/empty/ads/')).length,1,'recovery does not duplicate Ads');
  assert.equal(aiCalls,beforeEmptyView,'recovery never regenerates or spends an AI request');
  dom.window.close();
  console.log('PASS original flow: Business/Personal guided completion, optional blanks, one set of inputs, answer editing, phone formatting, canonical Ad persistence, new-campaign context, missing Ad recovery and delayed campaign switching.');
})().catch(e=>{console.error(e);process.exitCode=1;});
