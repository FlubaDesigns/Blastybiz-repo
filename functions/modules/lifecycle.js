'use strict';
const {onRequest,withAuth,requireAdmin,db,admin,callAI,trackAiUsage,reserveAiAction,AI_DEFAULTS,sendResendEmail,APP_BASE_URL,buildPlatformBlock,PLATFORM_DOCS}=require('../lib/shared');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {createLifecycle,remindersEligible,manual}=require('../lib/lifecycle');
const {rollupCosts}=require('../lib/ai-rollups');
async function refreshCopy({uid,b,c,ad,business,campaign,packet,ref}) {
 const context={businessId:b,campaignId:c,adId:ad.id,occurrenceId:ref.id,scheduleId:ad.id,purpose:'scheduled_refresh',copyBehavior:'refresh',wasFreeToUser:true};
 await reserveAiAction(uid);
 const start=Date.now();let result;
 try {
   const guides=require('./ai')._writingGuides,overrides=await guides.get();
   const rules=packet.enabledPlatforms.map(p=>buildPlatformBlock({id:p,name:p,doc:guides.merge(PLATFORM_DOCS[p]||{},overrides[p]||{})})).join('\n');
   result=await callAI('Refresh the approved advertising wording without inventing facts, offers, prices, contact details or claims. Return ONLY a JSON object mapping exactly these platform IDs to plain text strings: '+packet.enabledPlatforms.join(', ')+'.\nPlatform writing rules:\n'+rules+'\nBusiness facts: '+JSON.stringify(business.globalMemory||business.businessDescription||'')+'\nCampaign facts: '+JSON.stringify(campaign.campaignMemory||campaign.context||'')+'\nAd facts: '+JSON.stringify({offer:ad.offer,price:ad.price,cta:ad.cta,context:ad.context,pickupArea:ad.pickupArea,pickupZip:ad.pickupZip})+'\nApproved copy: '+JSON.stringify(packet.adaptations),{tier:'smart',maxTokens:6000});
   const text=result.text.replace(/^```(?:json)?\s*|\s*```$/g,'').trim();
   const value=JSON.parse(text);
   if(!value||packet.enabledPlatforms.some(p=>typeof value[p]!=='string'||!value[p].trim()||value[p].length>12000))throw Error('Invalid refreshed copy');
   await trackAiUsage(uid,'scheduledRefresh',result.model,result.usage,{context,timing:{aiElapsedMs:Date.now()-start}});
   return Object.fromEntries(packet.enabledPlatforms.map(p=>[p,value[p].trim()]));
 } catch(e) {
   await trackAiUsage(uid,'scheduledRefresh',result?.model||AI_DEFAULTS.smartModel,result?.usage||null,{context,failureType:'scheduled_refresh_failed',timing:{aiElapsedMs:Date.now()-start}});throw e;
 }
}
const generateImage=require('../lib/schedule-image').createImageGenerator({db,admin,reserveAiAction,trackAiUsage});
const lifecycle=createLifecycle({db,admin,refreshCopy,generateImage,sendEmail:payload=>sendResendEmail({...payload,strict:true}),appUrl:APP_BASE_URL});
exports.manageBlast=onRequest({invoker:'public',secrets:['ANTHROPIC_API_KEY','GEMINI_API_KEY'],timeoutSeconds:120},withAuth(async(req,res,user)=>{
 try{res.json(await lifecycle.manage(user.uid,req.body||{}));}
 catch(e){if(e.httpStatus)return res.status(e.httpStatus).json({error:e.message});console.error('[manageBlast]',e);res.status(500).json({error:'That could not be saved. Try again.'});}
}));
exports.observeBlastResult=onDocumentWritten({document:'users/{uid}/businesses/{businessId}/publishJobs/{jobId}',region:'us-central1'},async event=>{
 const data=event.data.after.exists?event.data.after.data():null;
 if(!data?.draftId)return;
 const dr=db.doc('users/'+event.params.uid+'/businesses/'+event.params.businessId+'/listingDrafts/'+data.draftId);
 if((await dr.get()).exists)await lifecycle.reconcile(dr);
});
// Bounded, persisted cursors ensure later records get a turn even when early
// schedules are waiting for approval. Existing scheduled functions call these.
async function pages(group,cursorId,configure,visit) {
 const cr=db.collection('maintenance').doc(cursorId);let cursor=(await cr.get()).data()?.path;
 for(let n=0;n<20;n++) {
   let q=configure(db.collectionGroup(group)).orderBy(admin.firestore.FieldPath.documentId()).limit(100);
   if(cursor)q=q.startAfter(db.doc(cursor));
   const rows=await q.get();
   for(const d of rows.docs){try{await visit(d);}catch(e){console.error('[V1 lifecycle]',d.ref.path,e.message);}}
   if(rows.size<100){await cr.delete();return;}
   cursor=rows.docs.at(-1).ref.path;await cr.set({path:cursor});
 }
}
async function runSchedules(deliver=true) {
 await pages('ads',deliver?'adDeliveryCursor':'adPreviewCursor',q=>q.where('schedule.enabled','==',true),async d=>{
   const schedule=d.data().schedule||{};
   if(!schedule.preparedBlastId&&Date.parse(schedule.nextRunAt)>Date.now()+48*3600000)return;
   try{if(deliver)await lifecycle.queue(d.ref);else await lifecycle.prepare(d.ref);}
   catch(e){await d.ref.update({'schedule.status':'needs_attention','schedule.pauseReason':e.message});throw e;}
   const fresh=(await d.ref.get()).data();const next=fresh?.schedule?.preparedBlastId;
   if(next){const p=d.ref.path.split('/');await lifecycle.notify(db.doc('users/'+p[1]+'/businesses/'+p[3]+'/listingDrafts/'+next),'preview');}
 });
}
async function runManualReminders() {
 const config=(await db.collection('config').doc('lifecycle').get()).data()||{};
 // Backend may deploy before migration. Stay off until its fixed cutoff exists.
 if(!remindersEligible({status:'approved',startedAt:config.remindersStartAt},config))return;
 await pages('listingDrafts','manualReminderCursor',q=>q.where('status','==','approved'),async d=>{
   if(!remindersEligible(d.data(),config))return;
   const parts=d.ref.path.split('/');
   const jobs=await db.doc('users/'+parts[1]+'/businesses/'+parts[3]).collection('publishJobs').where('draftId','==',d.id).get();
   if(!jobs.docs.some(job=>manual.has(job.data().status)))return;
   await lifecycle.reconcile(d.ref);
   for(const kind of ['ready','first','final','lapse'])await lifecycle.notify(d.ref,kind,config);
 });
}
exports.adminAiCostRollups=onRequest({invoker:'public'},withAuth(async(req,res,decoded)=>{
 const month=req.query.month;
 if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({error:'Use month YYYY-MM.'});
 const start=new Date(month+'-01T00:00:00Z'),end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,1));
 let q=db.collection('aiUsageLogs').where('ts','>=',admin.firestore.Timestamp.fromDate(start)).where('ts','<',admin.firestore.Timestamp.fromDate(end)).orderBy('ts').orderBy(admin.firestore.FieldPath.documentId());
 let cursor=null,rows=[];
 for(;;){let page=q.limit(500);if(cursor)page=page.startAfter(cursor);const snap=await page.get();rows.push(...snap.docs.map(d=>d.data()));if(snap.size<500)break;cursor=snap.docs.at(-1);}
 res.json({month,...rollupCosts(rows)});
},{admin:true}));
// Internal helpers are non-enumerable so the functions barrel never deploys them.
Object.defineProperty(exports,'_worker',{value:{runSchedules,runManualReminders,lifecycle}});
