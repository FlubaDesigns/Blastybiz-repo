'use strict';
const assert=require('node:assert/strict');
const indexes=require('../firestore.indexes.json');
assert(indexes.fieldOverrides.find(f=>f.collectionGroup==='listingDrafts'&&f.fieldPath==='schedule.enabled')?.indexes.some(i=>i.queryScope==='COLLECTION'&&i.order==='ASCENDING'),'Schedule listing needs its collection-scope enabled index as well as worker group indexes');
const {database,admin}=require('./lib/test-firestore.cjs');
const {createLifecycle}=require('../functions/lib/lifecycle');
const {createImageGenerator}=require('../functions/lib/schedule-image');
const B='users/u/businesses/b',C=B+'/campaigns/c',A=C+'/ads/a',D=B+'/listingDrafts/';
const image={id:'old',url:'https://example.com/old.jpg'},other={id:'new',url:'https://example.com/new.jpg'};
const ad={id:'a',uid:'u',campaignId:'c',revision:1,name:'Approved Ad',platforms:['instagram','craigslist'],platformStatus:{instagram:'approved',craigslist:'approved'},adaptations:{instagram:'Approved copy',craigslist:'Manual copy'},imageRefs:[image]};
let now=new Date('2027-01-01T12:00Z');const m=database({'users/u':{},[B]:{approvalCount:0},[C]:{name:'Campaign'},[A]:ad,[C+'/images/old']:image,[C+'/images/new']:other});
const life=createLifecycle({db:m.db,admin,clock:()=>now});
const request={businessId:'b',campaignId:'c',adId:'a'};
async function editor(){return life.manage('u',{...request,action:'editor'});}
async function save(extra={}){const state=await editor();return life.manage('u',{...request,action:'save',expectedRevision:state.schedule.revision||0,reviewKey:state.reviewKey,reviewed:true,imageIds:['new'],replacePrepared:true,requestId:'save_'+(state.schedule.revision||0),schedule:{frequency:'weekly',firstRunAtUtc:'2027-01-02T12:00Z',timezone:'UTC',approvalBehavior:'automatic'},...extra});}
(async()=>{
 // Original saved format: sent jobs, not subsequently edited draft/Ad copy,
 // define the next post. Keep the per-platform photo selections unchanged.
 const historical={status:'approved',uid:'u',campaignId:'c',adId:'a',adaptations:{craigslist:'Draft changed later'},imagesByPlatform:{craigslist:[]}};
 const oldUrl='https://example.com/retired.jpg',jobs=B+'/publishJobs/';
 const originalDb=database({'users/u':{},[B]:{schedulingPaused:true},[C]:{name:'Campaign'},[A]:ad,[D+'sent']:historical,
   [jobs+'sent_cl']:{draftId:'sent',campaignId:'c',adId:'a',platform:'craigslist',status:'manual_completed',payload:{adaptedContent:'Actually sent copy',imageUrls:[oldUrl]}},
   [jobs+'sent_fb']:{draftId:'sent',campaignId:'c',adId:'a',platform:'fbmarket',status:'manual_required',payload:{adaptedContent:'Actually sent second copy',imageUrls:[]}}});
 const oldLife=createLifecycle({db:originalDb.db,admin,clock:()=>now}),sourceRequest={...request,sourceBlastId:'sent'};
 const beforeSource=originalDb.get(D+'sent'),beforeJobs=Object.fromEntries(Object.entries(originalDb.all()).filter(([p])=>p.startsWith(jobs)));
 const originalState=await oldLife.manage('u',{...sourceRequest,action:'editor'});
 assert.deepEqual(originalState.packet.enabledPlatforms,['craigslist','fbmarket']);
 assert.equal(originalState.packet.adaptations.craigslist,'Actually sent copy');
 assert.deepEqual(originalState.packet.imagesByPlatform,{craigslist:[oldUrl],fbmarket:[]});
 assert.equal(originalState.packet.imageRefs[0].url,oldUrl);
 const originalSave={...sourceRequest,action:'save',expectedRevision:0,reviewed:true,reviewKey:originalState.reviewKey,imageIds:originalState.packet.imageRefs.map(i=>i.id),replacePrepared:true,requestId:'historical_save',schedule:{frequency:'weekly',firstRunAtUtc:'2027-01-02T12:00Z',timezone:'UTC',approvalBehavior:'automatic'}};
 const oldSaved=await oldLife.manage('u',originalSave),oldNext=originalDb.get(D+oldSaved.schedule.preparedBlastId);
 assert.deepEqual(oldNext.packet.imagesByPlatform,originalState.packet.imagesByPlatform,'Keep current preserves platform-specific selections');
 await oldLife.manage('u',originalSave);
 assert.deepEqual(originalDb.get(D+'sent'),beforeSource,'source draft is never migrated or changed');
 assert.deepEqual(Object.fromEntries(Object.entries(originalDb.all()).filter(([p])=>p.startsWith(jobs))),beforeJobs,'editor/save/retry cannot send or replace existing jobs');
 await originalDb.db.doc(A).update({schedule:{}});
 await originalDb.db.doc(D+'sent').update({campaignId:'different'});
 await assert.rejects(oldLife.manage('u',{...sourceRequest,action:'editor'}),/unavailable/);
 await originalDb.db.doc(D+'sent').update({campaignId:'c',status:'prepared'});
 await assert.rejects(oldLife.manage('u',{...sourceRequest,action:'editor'}),/unavailable/);
 await originalDb.db.doc(D+'sent').update({status:'approved'});
 await originalDb.db.doc(jobs+'sent_cl').update({campaignId:'different'});
 await assert.rejects(oldLife.manage('u',{...sourceRequest,action:'editor'}),/incomplete/);
 let state=await editor();assert.equal(state.imagePool.length,2);
 await assert.rejects(life.manage('other',{...request,action:'editor'}),/not found/);
 await assert.rejects(save({imageIds:[]}),/Instagram/);
 await assert.rejects(save({imageIds:['foreign']}),/no longer available/);
 await assert.rejects(save({reviewKey:'stale'}),/changed/);
 const result=await save();let s=result.schedule,id=s.preparedBlastId;
 assert.equal(m.get(D+id).approvalStatus,'approved');assert.equal(m.get(D+id).packet.imageRefs[0].id,'new');assert.equal(m.get(A).imageRefs[0].id,'old');assert.equal(s.repeatImageRefs,undefined);
 assert.equal(Object.keys(m.all()).filter(p=>p.includes('/publishJobs/')).length,0,'saving cannot publish');
 await life.manage('u',{...request,action:'save',requestId:'save_0'});assert.equal(m.get(A).schedule.preparedBlastId,id,'lost response retry keeps same occurrence');
 now=new Date('2027-01-02T12:01Z');await Promise.all([life.queue(m.db.doc(A)),life.queue(m.db.doc(A))]);
 assert.equal(Object.keys(m.all()).filter(p=>p.includes('/publishJobs/')).length,2,'exactly one job per destination');
 assert.equal(m.get(B+'/publishJobs/'+id+'_instagram').payload.imageUrls[0],other.url);
 await life.prepare(m.db.doc(A),true);s=m.get(A).schedule;assert.equal(m.get(D+s.preparedBlastId).packet.imageRefs[0].id,'old','next-only choice expires');assert.equal(m.get(D+s.preparedBlastId).approvalStatus,'automatic','no first-three gate for approved reuse');
 now=new Date('2027-01-01T12:00Z');await save({applyImagesToRepeats:true});s=m.get(A).schedule;
 assert.equal(s.repeatImageRefs[0].id,'new');assert.equal(s.runsCompleted,1,'editing preserves delivered count');
 now=new Date('2027-01-02T12:01Z');await life.queue(m.db.doc(A));await life.prepare(m.db.doc(A),true);s=m.get(A).schedule;
 assert.equal(m.get(D+s.preparedBlastId).packet.imageRefs[0].id,'new','explicit repeat choice carries forward');
 const before=Object.keys(m.all()).filter(p=>p.includes('/publishJobs/')).length;
 await life.manage('u',{...request,action:'cancel',expectedRevision:s.revision});now=new Date('2027-02-01');await life.queue(m.db.doc(A));
 assert.equal(m.get(D+s.preparedBlastId).status,'canceled');assert.equal(Object.keys(m.all()).filter(p=>p.includes('/publishJobs/')).length,before,'cancel prevents delivery');
 // Stale editor cannot approve a changed packet, even if schedule revision is unchanged.
 now=new Date('2027-01-01');state=await editor();await m.db.doc(A).update({revision:2});await assert.rejects(save({reviewKey:state.reviewKey}),/changed/);
 // AI uses the same image collection; retries do not regenerate or spend twice.
 let provider=0,credits=0,files=0,logs=[];
 const fakeAdmin={...admin,storage:()=>({bucket:()=>({name:'bucket',file:path=>({save:async(bytes)=>{assert(path.startsWith('photos/u/campaigns/c/'));assert(bytes.length);files++;}})})})};
 const gen=createImageGenerator({db:m.db,admin:fakeAdmin,reserveAiAction:async()=>{credits++;},trackAiUsage:async(...args)=>logs.push(args),key:()=> 'fixture',fetchImpl:async(url,opts)=>{provider++;assert.equal(JSON.parse(opts.body).model,'gemini-3.1-flash-lite-image');return {ok:true,json:async()=>({steps:[{type:'model_output',content:[{type:'image',data:Buffer.from([137,80,78,71,13,10,26,10,1]).toString('base64')}]}],usage:{total_input_tokens:10,total_output_tokens:1130}})};}});
 const job={uid:'u',b:'b',c:'c',adId:'a',prompt:'A sunny storefront',requestId:'image_one',packet:{adName:'Ad',adaptations:ad.adaptations}};
 const generated=await gen(job);assert.equal(generated.image.id,'ai_image_one');assert.equal(m.get(C+'/images/ai_image_one').retired,false);await gen(job);assert.equal(provider,1);assert.equal(credits,1);assert.equal(files,1);assert.equal(logs[0][3].image_tokens,1120);
 assert.equal(m.get(A).imageRefs[0].id,'old','AI preview never silently selects or publishes');
 const limited=createImageGenerator({db:m.db,admin:fakeAdmin,reserveAiAction:async()=>{throw Error('LIMIT_REACHED');},trackAiUsage:async()=>{},key:()=> 'fixture',fetchImpl:async()=>{throw Error('must not call provider');}});
 await assert.rejects(limited({...job,requestId:'limited'}),/allowance/);
 assert.equal(m.get(C+'/images/ai_limited').retired,true,'failed preview is absent from library');
 console.log('PASS scheduling photo scope, save approval, zero-count automatic reuse, stale edits, cancel, duplicate saves/workers, image generation retry and allowance boundaries.');
})().catch(e=>{console.error(e);process.exitCode=1;});
