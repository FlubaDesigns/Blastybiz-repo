'use strict';
// One allowance record and the existing aiRequestDedup ledger own reservations.
// Usage is server-owned and stored only in the private per-user ledger.
const {randomUUID}=require('node:crypto');
const millis=v=>v?.toMillis?.()??v?.toDate?.()?.getTime()??v?.stamp??0;
const error=(code,message,status=409)=>Object.assign(Error(message),{code,httpStatus:status});
const USAGE_FIELDS=Object.freeze(['aiActionsUsed','aiActionsResetAt','aiAllowanceNotice']);
function createAiAllowance({db,admin,getPlanConfig,clock=()=>new Date()}) {
 const stamp=()=>admin.firestore.FieldValue.serverTimestamp();
 const timestamp=ms=>admin.firestore.Timestamp.fromMillis(ms);
 async function readState(tx,user) {
   const ref=user.ref.collection('private').doc('aiAllowance'),snap=await tx.get(ref);
   return {ref,data:snap.data()||{}};
 }
 function restored(data,receipt,grant) {
   const patch={};
   if(receipt?.kind==='monthly'&&millis(data.aiActionsResetAt)===receipt.periodEnd) {
     patch.aiActionsUsed=Math.max(0,(data.aiActionsUsed||0)-1);
     patch.aiAllowanceNotice=null;
   }
   const releaseFree=receipt?.kind==='free'&&grant?.reservationToken===receipt.token;
   return {patch,releaseFree};
 }
 async function reserve(uid,opts={}) {
   const cfg=await getPlanConfig(),now=clock(),request=opts.request;
   if(request&&(!/^[A-Za-z0-9_-]{1,128}$/.test(request.id)||!/^[a-f0-9]{64}$/.test(request.fingerprint)))throw error('INVALID_REQUEST','Invalid generation request.',400);
   const requestRef=request?db.collection('aiRequestDedup').doc(uid+'_'+request.id):null;
   const token=randomUUID();
   return db.runTransaction(async tx=>{
     const userRef=db.collection('users').doc(uid),deletion=await tx.get(db.collection('accountDeletions').doc(uid));
     if(deletion.exists)throw error('ACCOUNT_DELETING','Account deletion is in progress.');
     const previous=requestRef?(await tx.get(requestRef)).data():null;
     if(previous?.fingerprint&&previous.fingerprint!==request.fingerprint)throw error('REQUEST_CONFLICT','This request belongs to different content. Start a new generation.');
     if(previous?.result&&previous.state!=='failed')return {cached:true,result:previous.result};
     if(previous?.state==='pending'&&millis(previous.leaseExpiresAt)>now.getTime())throw error('GENERATION_PENDING','Your copy is still being prepared.');
     const user=await tx.get(userRef),state=await readState(tx,user),data=state.data,plan=user.data()?.plan||'starter',cap=cfg.aiLimits[plan]??cfg.aiLimits.starter;
     const draftRef=opts.draftRef,grantRef=opts.isRegeneration&&draftRef?draftRef.collection('private').doc('aiAllowance'):null;
     const draft=grantRef?await tx.get(draftRef):null,grant=grantRef?await tx.get(grantRef):null;
     const oldGrantRef=previous?.reservation?.grantPath?db.doc(previous.reservation.grantPath):null;
     const oldGrant=oldGrantRef?(oldGrantRef.path===grantRef?.path?grant:await tx.get(oldGrantRef)):null;
     const oldDraft=oldGrantRef?(oldGrantRef.path===grantRef?.path?draft:await tx.get(oldGrantRef.parent.parent)):null;
     const restore=previous?.state==='pending'?restored(data,previous.reservation,oldGrant?.data()):{patch:{},releaseFree:false};
     const current={...data,...restore.patch};
     const periodEnd=Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1);
     const needsReset=!millis(current.aiActionsResetAt)||now.getTime()>=millis(current.aiActionsResetAt);
     const used=needsReset?0:(current.aiActionsUsed||0);
     const free=grant?.exists&&draft?.exists&&grant.data().uid===uid&&(grant.data().freeRegenUsed===false||(restore.releaseFree&&oldGrantRef.path===grantRef.path));
     if(!free&&used>=cap)throw Object.assign(Error('LIMIT_REACHED'),{used,cap,plan});
     if(restore.releaseFree) {
       tx.update(oldGrantRef,{freeRegenUsed:false,reservationToken:null});
       if(oldDraft?.exists)tx.update(oldDraft.ref,{freeRegenUsed:false});
     }
     if(Object.keys(restore.patch).length)tx.set(state.ref,restore.patch,{merge:true});
     const reservation={...(!opts.isRegeneration&&draftRef?{eligibilityPath:draftRef.path}:{}),kind:free?'free':'monthly',token,periodEnd:needsReset?periodEnd:millis(current.aiActionsResetAt),...(free?{grantPath:grantRef.path,draftPath:draftRef.path}:{})};
     if(free) {
       tx.update(grantRef,{freeRegenUsed:true,reservationToken:token,usedAt:stamp()});
       tx.set(draftRef,{freeRegenUsed:true},{merge:true});
     } else {
       tx.set(state.ref,{aiActionsUsed:used+1,...(needsReset?{aiActionsResetAt:timestamp(periodEnd)}:{}),aiAllowanceNotice:used+1>=Math.ceil(cap*.8)?'Fresh wording is nearly at this month’s allowance. Saved copy and Run As-Is stay available.':null},{merge:true});
     }
     if(requestRef)tx.set(requestRef,{uid,fingerprint:request.fingerprint,state:'pending',token,reservation,result:null,leaseExpiresAt:timestamp(now.getTime()+5*60000),expiresAt:timestamp(now.getTime()+48*3600000),createdAt:stamp(),updatedAt:stamp()});
     return {plan,used:free?used:used+1,cap,freeRegen:free,reservation,...(requestRef?{requestPath:requestRef.path,token}:{})};
   });
 }
 async function settle(uid,receipt,result) {
   if(!receipt||receipt.cached)return;
   // Non-request legacy callers retain their established per-action accounting.
   if(!receipt.requestPath)return;
   const ref=db.doc(receipt.requestPath);
   if(ref.path.split('/')[0]!=='aiRequestDedup')throw error('INVALID_RECEIPT','Invalid allowance receipt.');
   return db.runTransaction(async tx=>{
     const snap=await tx.get(ref),record=snap.data();
     if(!record||record.uid!==uid||record.token!==receipt.token||record.state!=='pending')return false;
     const userRef=db.collection('users').doc(uid),user=await tx.get(userRef),state=await readState(tx,user);
     const grantRef=record.reservation.grantPath?db.doc(record.reservation.grantPath):null;
     const grant=grantRef?await tx.get(grantRef):null;
     const draft=record.reservation.draftPath?await tx.get(db.doc(record.reservation.draftPath)):null;
     const eligibleRef=result&&record.reservation.eligibilityPath?db.doc(record.reservation.eligibilityPath):null;
     const eligible=eligibleRef?await tx.get(eligibleRef):null;
     const newGrantRef=eligibleRef?.collection('private').doc('aiAllowance');
     const newGrant=newGrantRef?await tx.get(newGrantRef):null;
     if(eligible?.exists&&!newGrant.exists)tx.create(newGrantRef,{uid,freeRegenUsed:false,createdAt:stamp()});
     if(!result) {
       const restore=restored(state.data,record.reservation,grant?.data());
       if(user.exists&&Object.keys(restore.patch).length)tx.set(state.ref,restore.patch,{merge:true});
       if(restore.releaseFree) {
         tx.update(grantRef,{freeRegenUsed:false,reservationToken:null});
         if(draft?.exists)tx.update(draft.ref,{freeRegenUsed:false});
       }
     }
     tx.update(ref,{state:result?'completed':'failed',result:result||null,leaseExpiresAt:admin.firestore.FieldValue.delete(),updatedAt:stamp()});
     return true;
   });
 }
 return {reserve,settle};
}
module.exports={createAiAllowance,USAGE_FIELDS};
