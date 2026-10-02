'use strict';
const assert=require('node:assert/strict');
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
