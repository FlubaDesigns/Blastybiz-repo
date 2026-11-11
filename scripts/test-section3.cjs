'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const {database,admin}=require('./lib/test-firestore.cjs'),{createAdService}=require('../functions/lib/ads');
const turn=()=>new Promise(r=>setImmediate(r));
async function run({source=p=>fs.readFileSync(p,'utf8')}={}){
 const dom=new JSDOM(source('public/BlastyBiz.html'),{url:'https://example.invalid',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
 const w=dom.window,editor=source('public/workspace-editor.js'),cut=(a,b)=>editor.slice(editor.indexOf(a),editor.indexOf(b,editor.indexOf(a)));
 const state=database({'users/u/businesses/b':{name:'Example'},'users/u/businesses/b/campaigns/c':{name:'Campaign'},'users/u/businesses/b/campaigns/d':{name:'Other'}}),service=createAdService(state.db,admin);
 let failSave=false,delayAI=false,releaseAI,requests=[],toasts=[];
 Object.assign(w,{activeBizId:'b',activeCampaignId:'c',activeCampaignName:'Campaign',profile:{name:'Example'},ynState:{},bizInsights:[],campaigns:[],platforms:[{id:'facebook',name:'Facebook',icon:'F',type:'api',enabled:true}],_bbGetToken:async()=> 'fixture',_bbLoadGlobalImages:async()=>[],_bbLoadCampaignImages:async()=>[],showToast:m=>toasts.push(m),savePlatforms(){},_getAIMemory:()=>({}),flushCampaignMemoryEdits:async()=>{},platformEligible:()=>true,PLATFORM_URL_HINTS:{},_bbIsGenerating:()=>false,_bbMarkGenerating(){},_bbClearGenerating(){},_afterAdaptation:async()=> 'working-draft',matchMedia:()=>({matches:true})});
 w.HTMLElement.prototype.scrollIntoView=function(){};
 for(const f of ['escape-utils.js','platforms-authority.js','business-form.js','photo-handoff.js'])w.eval(source('public/'+f));
 w._bbFetchWithTimeout=async(url,opt)=>{
  const body=JSON.parse(opt.body);
  if(url.endsWith('/adaptListing')){requests.push(body);if(delayAI)await new Promise(r=>releaseAI=r);return {ok:true,json:async()=>({adaptations:{facebook:'Rewritten\ncopy '+requests.length}})};}
  if(failSave&&body.action==='save')throw Error('offline');
  const data=await service('u',body);return {ok:true,json:async()=>data};
 };
 w.eval(source('public/ad-workspace.js'));
 for(const campaignId of ['c','d'])await w.BBAds.api('create',{campaignId,adId:'first',requestId:'first',creative:{name:campaignId,offer:'Weekend offer',platforms:['facebook'],adaptations:{facebook:'Original\ncopy '+campaignId}}});
 await w.BBAds.open();
 w.eval([
  cut('async function regeneratePlatformCopy','function saveStepCat'),
  cut('let generatedDraftSaving = false;','async function runAdaptation'),
  cut('function renderPlatformPhotoStrip','// Open a platform page'),
  cut('let _step5PlatIdx = 0;','// IMAGE HANDLING'),
  cut('async function approvePlatformCopy','async function excludePlatform')
 ].join('\n'));
 try{
  w.renderStep5Review();
  assert.equal(w.document.getElementById('qp-copy-text-facebook').textContent,'Original\ncopy c');
  assert.equal(w.document.querySelectorAll('#step5-destinations button').length,1);
  assert(w.document.querySelector('#step5-card-facebook .row > .col-1-2'));
  assert.equal(w.document.querySelectorAll('#step5-card-facebook .s5-card-body button[onclick*="regeneratePlatformCopy"]').length,3);
  assert.equal(w.document.getElementById('qp-undo-facebook').hidden,true);
  assert.equal(w.document.querySelector('.s5-rewrite-details').open,false);
  await w.approvePlatformCopy('facebook');
  assert.equal(state.get('users/u/businesses/b/campaigns/c/ads/first').platformStatus.facebook,'approved','approval saved without a legacy draft');
  // Save failure happens after paid output, retaining both output and Undo.
  const originalAfter=w._afterAdaptation;w._afterAdaptation=async()=>{throw Error('draft offline');};
  await w.regeneratePlatformCopy('facebook','Shorter');
  assert.equal(requests.length,1);assert.equal(requests[0].rewrite.source,'Original\ncopy c');assert.equal(requests[0].rewrite.direction,'Shorter');
  assert.equal(w._bbDraftSavePending,true);assert.equal(w.document.getElementById('qp-undo-facebook').hidden,false);
  assert.equal(w.BBAds.active.platformStatus.facebook,'needs-review');
  w._afterAdaptation=originalAfter;assert(await w.retryGeneratedDraftSave());assert.equal(requests.length,1);
  const beforeUndo=requests.length;await w.undoPlatformCopy('facebook');
  assert.equal(w.BBAds.active.adaptations.facebook,'Original\ncopy c');assert.equal(requests.length,beforeUndo);assert.equal(w.BBAds.active.platformStatus.facebook,'needs-review');
  // Free text follows the identical request contract and retains its form after save.
  w.document.getElementById('qp-direction-facebook').value='Keep the price. Mention weekend pickup.';
  w.document.querySelector('.s5-rewrite-details').open=true;
  await w.rewriteWithDirection('facebook');assert.equal(requests.at(-1).rewrite.direction,'Keep the price. Mention weekend pickup.');
  assert.equal(w.document.getElementById('qp-direction-facebook').value,'Keep the price. Mention weekend pickup.');
  const text=w.document.getElementById('qp-copy-text-facebook');text.textContent='Manual latest';text.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(w.document.getElementById('qp-undo-facebook').hidden,true,'manual edits invalidate stale Undo');await w.BBAds.save();
  // Actual failed Ad write preserves generated result and retry is save-only.
  const beforeRequest=w._bbFetchWithTimeout;w._bbFetchWithTimeout=async(url,opt)=>{const result=await beforeRequest(url,opt);if(url.endsWith('/adaptListing'))failSave=true;return result;};
  await w.regeneratePlatformCopy('facebook','More local');assert(w._bbDraftSavePending);assert.match(w.platforms[0].adaptedContent,/Rewritten/);
  const beforeRetry=requests.length;failSave=false;assert(await w.retryGeneratedDraftSave());assert.equal(requests.length,beforeRetry);
  w._bbFetchWithTimeout=beforeRequest;
  // Duplicate tap + switching away and back while a response is delayed.
  delayAI=true;const pending=w.regeneratePlatformCopy('facebook','More upbeat');while(!releaseAI)await turn();
  const count=requests.length;await w.regeneratePlatformCopy('facebook','More upbeat');assert.equal(requests.length,count);
  w.activeCampaignId='d';await w.BBAds.open();releaseAI();await pending;
  assert.equal(w.BBAds.active.adaptations.facebook,'Original\ncopy d');assert.equal(w.document.getElementById('qp-undo-facebook').hidden,true);
  assert.equal(w.document.querySelector('.is-rewriting'),null);
  delayAI=false;w.activeCampaignId='c';await w.BBAds.open();assert.equal(w.document.getElementById('qp-undo-facebook').hidden,true,'no Undo survives reopening');
  assert.equal((await w.BBAds.api('list')).ads.length,1,'no parallel Ad or draft created by Undo');
  // Changing the Ad while its token is loading cannot send old content under new identity.
  await w.BBAds.api('create',{campaignId:'c',adId:'second',requestId:'second',creative:{name:'Second',platforms:['facebook'],adaptations:{facebook:'Second Ad copy'}}});
  let releaseToken;const token=w._bbGetToken;w._bbGetToken=()=>new Promise(r=>releaseToken=r);
  // Avoid intercepting the prerequisite save token: delay only generation's token.
  const realSave=w.BBAds.save;w.BBAds.save=async()=>{};
  const beforeToken=requests.length,tokenPending=w.regeneratePlatformCopy('facebook','Shorter');while(!releaseToken)await turn();
  w._bbGetToken=token;await w.BBAds.open('second');releaseToken('fixture');await tokenPending;w.BBAds.save=realSave;
  assert.equal(requests.length,beforeToken);assert.equal(w.BBAds.active.adaptations.facebook,'Second Ad copy');
  console.log('PASS section 3: actual Ad service + editor, original text, directions, single request on double tap, save/retry without AI, Undo, approval invalidation, manual-edit preservation and stale campaign response isolation.');
 }finally{dom.window.close();}
}
module.exports={run};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
