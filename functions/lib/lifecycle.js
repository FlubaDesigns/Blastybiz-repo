'use strict';
// Ad.schedule is the sole recurring rule. listingDrafts stores each occurrence
// packet; publishJobs remains the sole delivery/result store.
const {createHash,randomUUID}=require('node:crypto');
const policy=require('./lifecycle-policy');
const {freezePacket}=require('./ads');
const {validateSchedule,advanceSchedule,computeNextRunAt}=require('./schedule');
const {PLATFORM_CAPABILITY_MAP}=require('./platforms');
const fail=(status,message)=>{throw Object.assign(Error(message),{httpStatus:status});};
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v))fail(400,'Invalid record identifier.');return v;};
const terminal=new Set(['success','manual_completed','manual_posted','manual_skipped','manual_lapsed','skipped','canceled']);
const delivered=new Set(['success','manual_completed','manual_posted']);
const manual=new Set(['manual_required','manual_followup','manual_ready']);
const ms=v=>v?.toMillis?.()||v?.stamp||Date.parse(v)||0;
// A missing/invalid rollout cutoff disables manual reminders and lapse. Never
// infer eligibility from a creation date or backfill old customer work.
function remindersEligible(blast,config) {
  const start=ms(config?.remindersStartAt),launched=ms(blast?.startedAt)||ms(blast?.approvedAt);
  return start>0&&launched>=start&&blast?.status==='approved'&&!blast.completedAt;
}
function summarize(jobs) {
  return {total:jobs.length,delivered:jobs.filter(j=>delivered.has(j.status)).length,
    terminal:jobs.filter(j=>terminal.has(j.status)).length,manual:jobs.filter(j=>manual.has(j.status)).length,
    complete:jobs.length>0&&jobs.every(j=>terminal.has(j.status)),
    ready:jobs.length>0&&jobs.every(j=>!['pending','processing','running','retry_pending'].includes(j.status)),
    launched:jobs.length>0&&jobs.every(j=>terminal.has(j.status)||manual.has(j.status))&&jobs.some(j=>delivered.has(j.status)||manual.has(j.status)),
    platformsReached:[...new Set(jobs.filter(j=>delivered.has(j.status)).map(j=>j.platform))]};
}
function createLifecycle({db,admin,refreshCopy,sendEmail,appUrl='https://blastybiz-9523e.web.app',clock=()=>new Date()}) {
 const stamp=()=>admin.firestore.FieldValue.serverTimestamp();
 const biz=(uid,b)=>db.doc('users/'+uid+'/businesses/'+id(b));
 const draft=(uid,b,d)=>biz(uid,b).collection('listingDrafts').doc(id(d));
 const adref=(uid,b,c,a)=>biz(uid,b).collection('campaigns').doc(id(c)).collection('ads').doc(id(a));
 const statusUrl=(uid,b,d)=>appUrl+'/BlastyBiz-Publishing-Status.html?'+new URLSearchParams({bizId:b,draftId:d,ownerUid:uid});
 async function list(uid,b) {
   const br=biz(uid,b),business=await br.get();if(!business.exists)fail(404,'Business not found.');
   const cs=await br.collection('campaigns').get(),rows=[];
   for(const c of cs.docs) {
     if(c.data().status==='archived')continue;
     const ads=await c.ref.collection('ads').get();
     for(const a of ads.docs)if(a.data().schedule) {
       const x=a.data(),s=x.schedule;
       let upcoming=null,last=null;
       if(s.preparedBlastId){const d=await br.collection('listingDrafts').doc(s.preparedBlastId).get();if(d.exists)upcoming={id:d.id,...d.data()};}
       if(s.lastBlastId){const d=await br.collection('listingDrafts').doc(s.lastBlastId).get();if(d.exists)last={id:d.id,...d.data()};}
       const pool=upcoming?(await c.ref.collection('images').get()).docs.filter(i=>!i.data().retired).map(i=>({id:i.id,url:i.data().url,alt:i.data().alt||''})):[];
       rows.push({imagePool:pool,campaignId:c.id,campaignName:c.data().name||'Campaign',adId:a.id,adName:x.name||'Ad',platforms:x.platforms||[],schedule:s,upcoming,last});
     }
   }
   rows.sort((a,b)=>(Date.parse(a.schedule.nextRunAt)||Infinity)-(Date.parse(b.schedule.nextRunAt)||Infinity));
   const old=await br.collection('listingDrafts').where('schedule.enabled','==',true).get();
   const legacy=old.docs.filter(d=>d.data().schedule?.enabled&&!d.data().scheduleAdPath).map(d=>({id:d.id,campaignId:d.data().campaignId||'',campaignName:d.data().campaignName||'Legacy campaign',nextRunAt:d.data().schedule.nextRunAt}));
   return {schedules:rows,legacy,businessPaused:business.data().schedulingPaused===true};
 }
 async function manage(uid,body) {
   const b=id(body.businessId),br=biz(uid,b),action=body.action;
   if(action==='list')return list(uid,b);
   if(action==='resumeBusiness'){if(!(await br.get()).exists)fail(404,'Business not found.');await br.update({schedulingPaused:false});return {resumed:true};}
   if(action==='pauseLegacy') {
     const dr=draft(uid,b,body.blastId);await db.runTransaction(async tx=>{const d=await tx.get(dr);if(!d.exists||d.data().scheduleAdPath)fail(404,'Legacy schedule not found.');tx.update(dr,{'schedule.enabled':false,'schedule.pauseReason':'Paused by owner.'});});return {paused:true};
   }
   if(action==='reminders') {
     if(typeof body.enabled!=='boolean')fail(400,'Choose reminders on or off.');
     await db.doc('users/'+uid).update({manualRemindersEnabled:body.enabled});return {enabled:body.enabled};
   }
   if(['posted','skipPlatform','skipRemaining','retry','reconcile','acknowledge'].includes(action)) {
     const dr=draft(uid,b,body.blastId);
     if(action==='reconcile')return reconcile(dr);
     if(action==='acknowledge')return db.runTransaction(async tx=>{
       const ur=db.doc('users/'+uid),u=await tx.get(ur);const m=u.data()?.firstBlastCompletion;
       if(!m||m.businessId!==b||m.blastId!==body.blastId)return {show:false};
       if(body.phase==='complete'){if(!m.completedAt||m.celebratedAt)return {show:false};tx.update(ur,{'firstBlastCompletion.celebratedAt':clock().toISOString()});return {show:true};}
       if(m.presentedAt)return {show:false};
       tx.update(ur,{'firstBlastCompletion.presentedAt':clock().toISOString()});return {show:true,milestone:m};
     });
     if(body.confirm!==true&&action!=='retry')fail(400,'Confirm this posting choice.');
     await db.runTransaction(async tx=>{
       const d=await tx.get(dr),jobs=await tx.get(br.collection('publishJobs').where('draftId','==',dr.id));
       if(!d.exists)fail(404,'Blast not found.');
       const targets=action==='skipRemaining'?jobs.docs.filter(j=>manual.has(j.data().status)):jobs.docs.filter(j=>j.id===id(body.jobId));
       if(!targets.length&&action!=='skipRemaining')fail(404,'Destination not found.');
       for(const j of targets) {
         const v=j.data();if(terminal.has(v.status))continue;
         if(action==='posted'&&!manual.has(v.status))fail(409,'Only manual work can be owner-confirmed.');
         if(['processing','pending','retry_pending'].includes(v.status))fail(409,'Wait for publishing to settle before changing this destination.');
         if(action==='retry') {
           if(v.status!=='failed'||v.publicationUncertain)fail(409,'This destination needs manual attention before retrying.');
           tx.update(j.ref,{status:'pending',attempts:0,retryCount:0,ownerRetryRequest:randomUUID(),customerLabel:'Retrying',customerVisibleMessage:'Waiting to retry.',updatedAt:stamp()});
         } else tx.update(j.ref,{status:action==='posted'?'manual_posted':manual.has(v.status)?'manual_skipped':'skipped',
           ...(action==='posted'?{manualConfirmedAt:clock().toISOString(),confirmationSource:'owner'}:{skippedAt:clock().toISOString()}),
           customerLabel:action==='posted'?'Posted by you':'Skipped',customerVisibleMessage:action==='posted'?'You confirmed this destination was posted.':'Skipped for this Blast only.',updatedAt:stamp()});
       }
     });return reconcile(dr);
   }
   const ar=adref(uid,b,body.campaignId,body.adId);
   if(action==='refreshNext') {
     const claim=await db.runTransaction(async tx=>{
       const a=await tx.get(ar);if(!a.exists||!a.data().schedule?.preparedBlastId)fail(409,'No prepared Blast.');
       const arData=a.data(),dr=draft(uid,b,arData.schedule.preparedBlastId),d=await tx.get(dr),bs=await tx.get(br),cs=await tx.get(br.collection('campaigns').doc(body.campaignId));
       if(!d.exists||d.data().status!=='scheduled'||d.data().preparationState==='working')fail(409,'This Blast cannot be refreshed right now.');
       const token=randomUUID();tx.update(dr,{preparationState:'working',preparationToken:token,preparationClaimedAt:clock().toISOString(),approvalStatus:'required'});
       return {uid,b,c:body.campaignId,ad:{...arData,id:ar.id},business:bs.data(),campaign:cs.data(),packet:d.data().packet,ref:dr,token};
     });
     let output,reason;try{output=await refreshCopy(claim);}catch(e){reason=e.message==='LIMIT_REACHED'?'allowance_ceiling':'refresh_unavailable';}
     await db.runTransaction(async tx=>{
       const d=await tx.get(claim.ref);if(!d.exists||d.data().preparationToken!==claim.token||d.data().status!=='scheduled')return;
       const packet={...d.data().packet,copyBehavior:output?'refresh':'reuse',...(output?{adaptations:output}:{}),override:true};
       tx.update(claim.ref,{packet,adaptations:packet.adaptations,revision:d.data().revision+1,preparationState:'ready',copyFallbackReason:reason||null,approvalStatus:'required'});
     });return {refreshed:!!output,reason:reason||null};
   }
   if(action==='prepareNext'){await prepare(ar,true);return {prepared:true};}
   const result=await db.runTransaction(async tx=>{
     const as=await tx.get(ar),bs=await tx.get(br),cs=await tx.get(ar.parent?.parent||br.collection('campaigns').doc(body.campaignId));
     if(!as.exists||!bs.exists||!cs.exists)fail(404,'Ad or campaign not found.');
     if(cs.data().status==='archived')fail(409,'Campaign is archived.');
     const ad={...as.data(),id:ar.id},s=ad.schedule||{};
     if(action==='save'&&body.requestId&&s.requestId===body.requestId)return {schedule:s};
     if(body.expectedRevision!==undefined&&body.expectedRevision!==(s.revision||0))fail(409,'Schedule changed elsewhere. Reload before saving.');
     const pending=s.preparedBlastId?await tx.get(br.collection('listingDrafts').doc(s.preparedBlastId)):null;
     let next;
     if(action==='save') {
       let initial=null;
       if(body.blastId){initial=await tx.get(draft(uid,b,body.blastId));if(!initial.exists||initial.data().adId!==ar.id||initial.data().campaignId!==body.campaignId)fail(409,'Prepared Blast does not belong to this Ad.');}
       next=validateSchedule(body.schedule,clock(),s);
       if(body.requestId)next.requestId=id(body.requestId);
       freezePacket(ad,cs.data());
       if(pending?.exists&&pending.data().status!=='approved'&&body.replacePrepared!==true)fail(409,'A Blast is already prepared. Confirm replacing its schedule before saving.');
       if(initial?.exists&&initial.data().status!=='approved') {
         next.preparedBlastId=initial.id;
         tx.update(initial.ref,{scheduleAdPath:ar.path,scheduledForUtc:next.nextRunAt,scheduleRevision:next.revision,approvalStatus:'required',status:'scheduled',updatedAt:stamp()});
       }
     } else if(action==='pause')next={...s,enabled:false,status:'paused',revision:(s.revision||0)+1};
     else if(action==='resume') {
       if(s.status==='completed')fail(409,'This schedule is complete. Edit it to start a new schedule.');
       if(!s.nextRunAt)fail(409,'Choose a future posting time.');
       next={...s,enabled:true,status:'active',revision:(s.revision||0)+1};
       // Missed work requires review; resuming never silently authorizes it.
       if(pending?.exists)tx.update(pending.ref,{approvalStatus:'required'});
     } else if(action==='skipNext') {
       if(!s.nextRunAt)fail(409,'No upcoming occurrence to skip.');
       next=advanceSchedule(s,clock(),true);
     } else if(action==='approveNext') {
       if(!pending?.exists||pending.data().status==='approved')fail(409,'No prepared occurrence to approve.');
       if(s.copyBehavior==='ask'&&!['reuse','refresh'].includes(body.copyChoice))fail(400,'Choose Reuse or Refresh before approving.');
       if(s.imageBehavior!=='reuse'&&body.keepImages!==true)fail(400,'Confirm the images before approving.');
       if(body.packetRevision!==pending.data().revision)fail(409,'The prepared copy changed. Review it again.');
       if(pending.data().preparationState==='working')fail(409,'Copy is still being prepared.');
       tx.update(pending.ref,{approvalStatus:'approved',approvedPacketRevision:pending.data().revision,updatedAt:stamp()});
       next={...s,status:'active'};
     } else if(action==='editNext') {
       if(!pending?.exists||pending.data().status!=='scheduled'||pending.data().preparationState==='working')fail(409,'No editable prepared Blast.');
       if(body.packetRevision!==pending.data().revision)fail(409,'This copy changed elsewhere. Reload it.');
       const packet=JSON.parse(JSON.stringify(pending.data().packet));
       if(!body.adaptations||packet.enabledPlatforms.some(p=>typeof body.adaptations[p]!=='string'||!body.adaptations[p].trim()||body.adaptations[p].length>12000))fail(400,'Each destination needs copy.');
       if(!Array.isArray(body.imageIds)||body.imageIds.length>30)fail(400,'Choose valid images.');
       const images=[];
       for(const imageId of [...new Set(body.imageIds)]) {
         const image=await tx.get(br.collection('campaigns').doc(body.campaignId).collection('images').doc(id(imageId)));
         if(!image.exists||image.data().retired)fail(409,'An image is no longer available.');
         const v=image.data();images.push({id:image.id,url:v.url,path:v.path||'',alt:v.alt||''});
       }
       if(packet.enabledPlatforms.includes('instagram')&&!images.length)fail(400,'Instagram needs an image.');
       packet.adaptations=Object.fromEntries(packet.enabledPlatforms.map(p=>[p,body.adaptations[p].trim()]));packet.imageRefs=images;
       packet.imagesByPlatform=Object.fromEntries(packet.enabledPlatforms.map(p=>[p,images.map(i=>i.url).slice(0,10)]));packet.override=true;
       tx.update(pending.ref,{packet,adaptations:packet.adaptations,imagesByPlatform:packet.imagesByPlatform,revision:pending.data().revision+1,approvalStatus:'required',updatedAt:stamp()});
       next={...s,status:'waiting_approval'};
     } else if(action==='changeNext') {
       const time=new Date(body.nextRunAt);if(!Number.isFinite(time.getTime())||time<=clock())fail(400,'Choose a future date and time.');
       const following=computeNextRunAt(s,new Date(Math.max(Date.parse(s.nextAnchorAt||s.nextRunAt),clock().getTime())));
       if(following&&time>=following)fail(400,'Choose a time before the following Refire, or use Edit Schedule to change the recurring rule.');
       next={...s,nextAnchorAt:s.nextAnchorAt||s.nextRunAt,nextRunAt:time.toISOString(),revision:(s.revision||0)+1};
       delete next.preparedBlastId;
     } else fail(400,'Unknown schedule action.');
     if(pending?.exists&&['save','skipNext','changeNext'].includes(action)&&pending.id!==next.preparedBlastId&&pending.data().status!=='approved')tx.update(pending.ref,{status:'canceled',approvalStatus:'canceled',canceledAt:clock().toISOString()});
     tx.update(ar,{schedule:next,updatedAt:stamp()});
     return {schedule:next};
   });
   if(['save','resume','changeNext','skipNext'].includes(action))await prepare(ar);
   const current=await ar.get();result.schedule=current.data().schedule;
   const rows=(await list(uid,b)).schedules,own=current.data();
   result.overlaps=rows.filter(r=>r.adId!==ar.id||r.campaignId!==body.campaignId).filter(r=>r.schedule.enabled&&result.schedule.enabled&&Math.abs(Date.parse(r.schedule.nextRunAt)-Date.parse(result.schedule.nextRunAt))<3600000&&r.platforms.some(p=>(own.platforms||[]).includes(p))).map(r=>({campaignName:r.campaignName,adName:r.adName,nextRunAt:r.schedule.nextRunAt}));
   return result;
 }
 async function prepare(ar,force=false) {
   const now=clock();
   const claimed=await db.runTransaction(async tx=>{
     const a=await tx.get(ar);if(!a.exists)return null;
     const ad={...a.data(),id:ar.id},s=ad.schedule;
     if(!s?.enabled||!s.nextRunAt||(!force&&Date.parse(s.nextRunAt)>now.getTime()+48*3600000))return null;
     const parts=ar.path.split('/'),uid=parts[1],b=parts[3],c=parts[5],br=biz(uid,b);
     const cs=await tx.get(br.collection('campaigns').doc(c)),bs=await tx.get(br);
     if(!cs.exists||cs.data().status==='archived'||!bs.exists||bs.data().schedulingPaused)return null;
     const key=s.preparedBlastId||'refire_'+createHash('sha256').update(ar.path+'|'+s.nextRunAt+'|'+s.revision).digest('hex').slice(0,40);
     const dr=br.collection('listingDrafts').doc(key),d=await tx.get(dr);
     if(d.exists&&d.data().preparationState!=='working'){tx.update(ar,{'schedule.status':d.data().approvalStatus==='required'?'waiting_approval':'active'});return {ready:true,ref:dr};}
     if(d.exists&&ms(d.data().preparationClaimedAt)>now.getTime()-10*60000)return null;
     const token=randomUUID();
     const packet=freezePacket(ad,cs.data());
     const required=(bs.data().approvalCount||0)<3||s.approvalBehavior==='always'||s.copyBehavior==='ask'||s.imageBehavior!=='reuse'||s.copyBehavior==='refresh';
     tx.set(dr,{uid,businessId:b,campaignId:c,campaignName:cs.data().name||'',adId:ar.id,adName:ad.name||'',packet,
       adaptations:packet.adaptations,imagesByPlatform:packet.imagesByPlatform,enabledPlatforms:packet.enabledPlatforms,
       status:'scheduled',scheduleAdPath:ar.path,scheduledForUtc:s.nextRunAt,scheduleRevision:s.revision,
       approvalStatus:required?'required':'automatic',copyBehavior:s.copyBehavior,imageBehavior:s.imageBehavior,
       revision:1,preparationState:s.copyBehavior==='refresh'?'working':'ready',preparationToken:token,preparationClaimedAt:now.toISOString(),createdAt:stamp(),updatedAt:stamp()});
     tx.update(ar,{'schedule.preparedBlastId':key,'schedule.status':required?'waiting_approval':'active'});
     return {ref:dr,ar,ad,business:bs.data(),campaign:cs.data(),uid,b,c,packet,token,refresh:s.copyBehavior==='refresh'};
   });
   if(!claimed||claimed.ready||!claimed.refresh)return claimed;
   let output,reason;
   try {output=await refreshCopy(claimed);}catch(e){reason=e.message==='LIMIT_REACHED'?'allowance_ceiling':'refresh_unavailable';}
   await db.runTransaction(async tx=>{
     const d=await tx.get(claimed.ref),a=await tx.get(ar);
     if(!d.exists||d.data().preparationToken!==claimed.token||d.data().status!=='scheduled'||a.data()?.schedule?.preparedBlastId!==d.id)return;
     let packet={...claimed.packet,copyBehavior:'reuse'};
     if(output)packet={...packet,adaptations:output,copyBehavior:'refresh'};
     tx.update(claimed.ref,{packet,adaptations:packet.adaptations,preparationState:'ready',copyFallbackReason:reason||null,
       approvalStatus:output?'required':((claimed.business.approvalCount||0)>=3&&claimed.ad.schedule.approvalBehavior!=='always'&&claimed.ad.schedule.imageBehavior==='reuse'?'automatic':'required'),revision:d.data().revision+1,updatedAt:stamp()});
   });return claimed;
 }
 async function queue(ar) {
   await prepare(ar);
   return db.runTransaction(async tx=>{
     const a=await tx.get(ar);if(!a.exists)return;
     const ad=a.data(),s=ad.schedule,now=clock();
     if(!s?.enabled||!s.nextRunAt||new Date(s.nextRunAt)>now||!s.preparedBlastId)return;
     const parts=ar.path.split('/'),uid=parts[1],b=parts[3],c=parts[5],br=biz(uid,b),dr=draft(uid,b,s.preparedBlastId);
     const d=await tx.get(dr),bs=await tx.get(br),cs=await tx.get(br.collection('campaigns').doc(c));
     if(!d.exists||!bs.exists||bs.data().schedulingPaused||!cs.exists||cs.data().status==='archived')return;
     const v=d.data();if(v.status!=='scheduled'||v.preparationState==='working'||v.scheduledForUtc!==s.nextRunAt||!['approved','automatic'].includes(v.approvalStatus))return;
     // Safety policy is rechecked at dispatch, not only at preview creation.
     if((bs.data().approvalCount||0)<3&&v.approvalStatus!=='approved')return;
     if(v.approvalStatus==='approved'&&v.approvedPacketRevision!==v.revision)return;
     const packet=v.packet;
     for(const p of packet.enabledPlatforms) {
       const cap=PLATFORM_CAPABILITY_MAP[p],isManual=cap.capabilityLevel!=='full_auto';
       const jr=br.collection('publishJobs').doc(dr.id+'_'+p);
       tx.create(jr,{jobId:jr.id,uid,businessId:b,campaignId:c,adId:ar.id,adName:packet.adName,draftId:dr.id,blastId:dr.id,
         scheduledRunId:dr.id,scheduledCycle:s.nextRunAt,scheduledExplicitApproval:v.approvalStatus==='approved',
         platform:p,platformName:cap.name,capabilityLevel:cap.capabilityLevel,jobType:'scheduled_approved',
         status:isManual?'manual_required':'pending',attempts:0,maxAttempts:5,customerNotified:false,
         customerLabel:isManual?'Ready for you':'Waiting to publish',customerVisibleMessage:isManual?'Your copy and images are ready for you to post.':'Waiting to publish.',
         manualInstructions:cap.manualInstructions||'',payload:{adaptedContent:packet.adaptations[p],imageUrls:packet.imagesByPlatform[p]||[]},createdAt:stamp(),updatedAt:stamp()});
     }
     tx.update(dr,{status:'approved',packetFrozenAt:stamp(),startedAt:now.toISOString(),updatedAt:stamp()});
     const next=advanceSchedule(s,now);next.lastBlastId=dr.id;
     tx.update(ar,{schedule:next,updatedAt:stamp()});
     // One explicit approved occurrence counts once, including all-manual runs.
     if(v.approvalStatus==='approved')tx.update(br,{approvalCount:(bs.data().approvalCount||0)+1});
     return {blastId:dr.id};
   });
 }
 async function reconcile(dr) {
   return db.runTransaction(async tx=>{
     const d=await tx.get(dr);if(!d.exists)fail(404,'Blast not found.');
     const p=dr.path.split('/'),uid=p[1],b=p[3],ur=db.doc('users/'+uid);
     const jobs=await tx.get(biz(uid,b).collection('publishJobs').where('draftId','==',dr.id)),u=await tx.get(ur);
     const summary=summarize(jobs.docs.map(j=>j.data())),v=d.data();
     if(summary.total)tx.update(dr,{completion:summary,...(summary.complete&&!v.completedAt?{completedAt:clock().toISOString()}:{}),...(summary.ready&&!v.readyAt?{readyAt:clock().toISOString()}:{}),updatedAt:stamp()});
     if(summary.complete&&summary.delivered>0&&u.data()?.firstBlastCompletion?.blastId===dr.id&&u.data().firstBlastCompletion.businessId===b&&!u.data().firstBlastCompletion.completedAt)tx.update(ur,{'firstBlastCompletion.completedAt':clock().toISOString()});
     if(summary.launched&&!u.data()?.firstBlastCompletion)tx.update(ur,{firstBlastCompletion:{businessId:b,campaignId:v.campaignId||null,adId:v.adId||null,blastId:dr.id,launchedAt:clock().toISOString(),presentedAt:null,...(summary.complete&&summary.delivered>0?{completedAt:clock().toISOString()}:{})}});
     return {summary,milestone:u.data()?.firstBlastCompletion||null};
   });
 }
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function notify(dr,kind,config) {
   config=config||(await db.collection('config').doc('lifecycle').get()).data()||{};
   if(kind!=='preview') {
     if(!ms(config.remindersStartAt))return;
     const before=await dr.get();
     if(!before.exists||!remindersEligible(before.data(),config))return;
   }
   const now=clock(),parts=dr.path.split('/'),uid=parts[1],b=parts[3],ur=db.doc('users/'+uid),br=biz(uid,b);
   const lease=await db.runTransaction(async tx=>{
     const d=await tx.get(dr);
     if(!d.exists||(kind!=='preview'&&!remindersEligible(d.data(),config)))return null;
     const u=await tx.get(ur),bs=await tx.get(br);
     if(!u.exists||!bs.exists)return null;
     const v=d.data(),user=u.data();
     const a=v.scheduleAdPath?await tx.get(db.doc(v.scheduleAdPath)):null;
     const jobs=await tx.get(br.collection('publishJobs').where('draftId','==',dr.id));
     if(bs.data().schedulingPaused||a?.data()?.schedule?.status==='paused')return null;
     const reminders=v.reminders||{},remaining=jobs.docs.filter(j=>manual.has(j.data().status));
     if(kind!=='preview'&&!remaining.length)return null;
     if(kind==='lapse') {
       const days=Number.isFinite(config.manualLapseDays)&&config.manualLapseDays>0?config.manualLapseDays:policy.manualLapseDays;
       const base=ms(reminders.finalSentAt)||ms(reminders.disabledFinalAt);
       if(!base||now.getTime()<base+days*86400000)return null;
       for(const j of remaining)tx.update(j.ref,{status:'manual_lapsed',customerLabel:'Not posted',customerVisibleMessage:'Not posted. This Blast is closed for this destination.',lapsedAt:now.toISOString(),updatedAt:stamp()});
       return {lapsed:true};
     }
     if((user.manualRemindersEnabled===false||user.emailUnsubscribed)&&kind!=='preview') {
       // Reminders-off still closes abandoned work after the same virtual final slot.
       if(v.readyAt&&!reminders.disabledFinalAt)tx.update(dr,{'reminders.disabledFinalAt':new Date(ms(v.readyAt)+36*3600000).toISOString()});
       return null;
     }
     if(user.emailUnsubscribed||!user.email)return null;
     if(kind==='preview') {
       if(v.status!=='scheduled'||v.preparationState==='working'||v.approvalStatus==='approved'||v.approvalStatus==='automatic')return null;
       if(a?.data()?.schedule?.preparedBlastId!==dr.id||!a?.data()?.schedule?.enabled)return null;
     } else {
       if(!remaining.length||!summarize(jobs.docs.map(j=>j.data())).ready)return null;
       if(kind==='first'&&(!reminders.readySentAt||now.getTime()<ms(reminders.readySentAt)+12*3600000))return null;
       if(kind==='final'&&(!reminders.firstSentAt||now.getTime()<ms(reminders.firstSentAt)+24*3600000))return null;
     }
     if(reminders[kind+'SentAt']||ms(reminders[kind+'LeaseAt'])>now.getTime()-10*60000)return null;
     tx.update(dr,{['reminders.'+kind+'LeaseAt']:now.toISOString()});
     return {email:user.email,v,remaining:remaining.map(j=>j.data().platformName||j.data().platform),summary:summarize(jobs.docs.map(j=>j.data()))};
   });
   if(!lease)return;
   if(lease.lapsed)return reconcile(dr);
   // Re-read at the actual send boundary: actions can settle during lease acquisition.
   const [latest,user,bs]=await Promise.all([dr.get(),ur.get(),br.get()]);
   const v=latest.data();
   if(!v||(kind!=='preview'&&!remindersEligible(v,config))||user.data()?.emailUnsubscribed||bs.data()?.schedulingPaused||(kind!=='preview'&&user.data()?.manualRemindersEnabled===false))return;
   if(v.scheduleAdPath){const a=await db.doc(v.scheduleAdPath).get();if(a.data()?.schedule?.status==='paused')return;}
   let names=lease.remaining;
   if(kind==='preview'&&(v.status!=='scheduled'||v.approvalStatus!=='required'))return;
   if(kind!=='preview') {const j=await br.collection('publishJobs').where('draftId','==',dr.id).get();names=j.docs.filter(x=>manual.has(x.data().status)).map(x=>x.data().platformName||x.data().platform);if(!names.length)return;}
   const name=(v.campaignName||'Campaign')+' / '+(v.adName||'Ad');
   const link=kind==='preview'?appUrl+'/BlastyBiz.html?'+new URLSearchParams({bizId:b,ownerUid:uid,tab:'schedule',scheduleCampaign:v.campaignId,scheduleAd:v.adId,scheduledBlastId:dr.id}):statusUrl(uid,b,dr.id);
   const subject=kind==='preview'?'Review required: '+name:kind==='final'?'Still want to post these?':names.length+' destinations need you — '+name;
   const preview=kind==='preview'?Object.entries(v.packet?.adaptations||{}).map(([p,copy])=>'<h3>'+esc(p)+'</h3><p>'+esc(copy)+'</p>').join('')+(v.packet?.imageRefs||[]).filter(i=>/^https:\/\//.test(i.url||'')).map(i=>'<a href="'+esc(i.url)+'"><img width="120" src="'+esc(i.url)+'" alt="'+esc(i.alt||'Selected image')+'"></a>').join(''):'';
   await sendEmail({to:user.data().email,subject,html:'<h2>'+esc(name)+'</h2><p>'+(kind==='preview'?'Approval is required before this Blast goes out. Review copy and images, then Approve, Change, Skip, or Pause.':esc(names.join(', '))+' '+(names.length===1?'is':'are')+' ready for you. Manual posts count only after you confirm them.')+'</p>'+preview+'<a href="'+esc(link)+'">'+(kind==='preview'?'REVIEW THIS BLAST':'FINISH MY BLAST')+'</a>'+(kind==='final'?'<p><a href="'+esc(link+'&action=skipRemaining')+'">SKIP REMAINING</a> — opens a confirmation in the app.</p>':''),idempotencyKey:dr.id+'-'+kind});
   await dr.update({['reminders.'+kind+'SentAt']:clock().toISOString()});
 }
 return {manage,list,prepare,queue,reconcile,notify,statusUrl};
}
module.exports={createLifecycle,summarize,terminal,manual,delivered,remindersEligible};

