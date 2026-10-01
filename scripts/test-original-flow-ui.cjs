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
  await w.BBAds.prepareCurrent();
  assert.deepEqual([...lastPrepared.packet.enabledPlatforms],['facebook'],'prepared Blast excludes skipped destinations');
  slow=true;const old=w.BBAds.open();await turn();
  assert(w.document.getElementById('campaign-content').inert);
  w.activeCampaignId='d';w.activeCampaignName='Other';await w.BBAds.open();releaseSlow();await old;
  assert.equal(w.BBAds.active.name,'Other item');assert.equal(w.document.getElementById('biz-ad-name').value,'Other item');
  assert.equal(w.document.getElementById('campaign-content').inert,false);
  dom.window.close();
  console.log('PASS original flow: Business/Personal guided completion, optional blanks, one set of inputs, answer editing, phone formatting, canonical Ad persistence, new-campaign context and delayed campaign switching.');
})().catch(e=>{console.error(e);process.exitCode=1;});
