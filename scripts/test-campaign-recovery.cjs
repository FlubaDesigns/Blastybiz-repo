'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {database,admin}=require('./lib/test-firestore.cjs');
const {createAdService}=require('../functions/lib/ads');
const root='users/u/businesses/b',camp=root+'/campaigns/c',drafts=root+'/listingDrafts/';
module.exports=async function(){
  const state=database({[root]:{aiContext:{story:'The story I just entered.'}},[camp]:{name:'My campaign',campaignStory:'My new campaign details',offer:'Older offer',platformHistory:{facebook:[{copy:'Old Facebook wording',ranAt:'2026-07-01'}]}},
    [drafts+'older']:{campaignId:'c',offer:'Older generated offer',adaptations:{facebook:'Older draft copy'},enabledPlatforms:['facebook'],createdAt:{stamp:1}},
    [drafts+'latest']:{campaignId:'c',offer:'Fresh offer',price:'19',campaignContext:'Previous context',adaptations:{facebook:'Fresh wording'},enabledPlatforms:['facebook'],createdAt:{stamp:100}},
    [drafts+'other']:{campaignId:'other',offer:'Wrong campaign',adaptations:{facebook:'Must not appear'},createdAt:{stamp:1000}}});
  const service=createAdService(state.db,admin);
  const body={businessId:'b',campaignId:'c',action:'create',adId:'first',requestId:'first',recoverCampaign:true};
  const before=state.all();
  assert.equal((await service('u',{...body,action:'list',recoverCampaign:false})).ads.length,0);
  const [a,b]=await Promise.all([service('u',body),service('u',body)]);
  assert.equal(a.ad.id,b.ad.id);
  assert.equal(a.ad.offer,'Fresh offer');assert.equal(a.ad.adaptations.facebook,'Fresh wording');
  assert.equal(a.ad.context,'My new campaign details','fresh campaign details beat older draft context');
  assert.equal(a.ad.platformStatus.facebook,'needs-review','recovery never authorizes a send');
  assert.equal(Object.keys(state.all()).filter(p=>p.startsWith(camp+'/ads/')).length,1);
  for(const [path,data] of Object.entries(before))assert.deepEqual(state.get(path),data,'source preserved: '+path);
  const saved=await service('u',{...body,recoverCampaign:false,action:'save',requestId:'fresh-edit',expectedRevision:1,creative:{offer:'Newly typed ad copy'}});
  const persisted=state.get(camp+'/ads/first');
  const reopened=await service('u',body);assert.deepEqual(reopened.ad,persisted,'retry cannot replace new copy');assert.equal(reopened.ad.offer,saved.ad.offer);
  await assert.rejects(()=>service('other-user',body),e=>e.httpStatus===404);
  await assert.rejects(()=>service('u',{...body,adId:'another'}),e=>e.httpStatus===400);
  const other=database({[root]:{},[camp]:{},[camp+'/ads/existing']:{id:'existing',offer:'Current saved ad',requestId:'original',revision:5}});
  const existing=await createAdService(other.db,admin)('u',body);assert.equal(existing.ad.offer,'Current saved ad');assert.equal(other.get(camp+'/ads/first'),undefined);
  const html=fs.readFileSync('public/BlastyBiz.html','utf8');
  const saveCode=html.slice(html.indexOf('function debounceCampaignSave()'),html.indexOf('async function discardAdDraft()'));
  let timer,adSaved=0;const statuses=[];
  const c={window:{_bbSaveCampaigns:async()=>{},BBAds:{ready:async()=>{throw Error('No saved ad');},save:async()=>{adSaved++;}}},activeCampaignId:'c',campaigns:[{id:'c'}],_campaignSaveTimer:null,Date,updateCampaignMemory(){},_updateAdDiscardBtn(){},clearTimeout(){},setTimeout:fn=>{timer=fn;},_showAdDraftStatus:s=>statuses.push(s),console:{warn(){}}};
  vm.runInNewContext(saveCode,c);c.debounceCampaignSave();await timer();
  assert.equal(adSaved,0);assert.ok(statuses.every(s=>!s.startsWith('Saved')),'missing Ad never reports saved');
  c.window.BBAds.ready=async()=>{};c.debounceCampaignSave();await timer();assert.equal(adSaved,1);assert.equal(statuses.at(-1),'Saved ✓');
  console.log('PASS campaign recovery preserves new and existing copy, source records and owner boundaries; save status requires an Ad write.');
};
if(require.main===module)module.exports().catch(e=>{console.error(e);process.exitCode=1;});
