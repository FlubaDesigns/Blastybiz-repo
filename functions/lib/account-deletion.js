'use strict';
// One retryable account-deletion owner. The journal survives partial cleanup.
function createAccountDeletion({db,admin,getSquare,revokeConnections,clock=Date.now}) {
 const stamp=()=>admin.firestore.FieldValue.serverTimestamp();
 const millis=v=>v?.toMillis?.()??v?.stamp??(v instanceof Date?v.getTime():0);
 return async function purgeUserData(uid,opts={}) {
  if(typeof uid!=='string'||!uid||uid.includes('/'))throw Error('Invalid account ID');
  const user=db.collection('users').doc(uid),journal=db.collection('accountDeletions').doc(uid),subRef=db.collection('subscriptions').doc(uid);
  const result={uid,dryRun:!!opts.dryRun,businesses:0,docsDeleted:0,storagePrefixes:[],subscriptionCancelled:false,authUserDeleted:false,errors:[]};
  const businesses=await user.collection('businesses').get();result.businesses=businesses.size;
  result.storagePrefixes=[`users/${uid}/images/`,`photos/${uid}/`,...businesses.docs.map(d=>`businesses/${d.id}/`)];
  if(opts.dryRun)return result;
  const lease=require('node:crypto').randomUUID(),now=clock();
  const claimed=await db.runTransaction(async tx=>{
   const [u,j,s]=await Promise.all([tx.get(user),tx.get(journal),tx.get(subRef)]),prior=j.data()||{},current=u.data();
   if(prior.status==='completed')return false;
   if(prior.leaseUntil>now)throw Object.assign(Error('Account deletion is already running. Retry shortly.'),{httpStatus:409});
   if(opts.retention){
    const r=opts.retention;
    if(!current||!['trial','starter'].includes(current.plan)||current.planActive||!current.dormancyWarnedAt||!millis(current.lastActiveAt)||millis(current.lastActiveAt)>=r.cutoff||millis(current.lastActiveAt)!==r.lastActiveAt||!millis(current.dormancyPurgeAt)||millis(current.dormancyPurgeAt)>now||millis(current.dormancyPurgeAt)!==r.purgeAt)return false;
   }
   tx.set(journal,{status:'running',lease,leaseUntil:now+15*60*1000,requestedAt:prior.requestedAt||stamp(),updatedAt:stamp(),storagePrefixes:[...new Set([...(prior.storagePrefixes||[]),...result.storagePrefixes])],squareSubscriptionId:prior.squareSubscriptionId||s.data()?.squareSubscriptionId||null},{merge:true});
   if(u.exists)tx.update(user,{deletionRequestedAt:stamp()});
   return true;
  });
  if(!claimed){result.skipped=true;return result;}
  const record=(await journal.get()).data();result.storagePrefixes=record.storagePrefixes;
  try {
   if(record.squareSubscriptionId&&!record.subscriptionCancelled){
    if(opts.cancelSubscription===false)throw Error('Cannot delete an account with an uncancelled subscription');
    let response;
    try { response=await getSquare().subscriptions.cancel({subscriptionId:record.squareSubscriptionId}); }
    catch(e){
     // A retry may follow a successful provider cancellation whose local receipt failed.
     const current=await getSquare().subscriptions.get({subscriptionId:record.squareSubscriptionId});
     if(current.subscription?.status!=='CANCELED'&&!current.subscription?.canceledDate)throw e;
     response=current;
    }
    if(response.errors?.length||!response.subscription||(!response.subscription.canceledDate&&response.subscription.status!=='CANCELED'))throw Error('Square did not confirm cancellation');
    await journal.update({subscriptionCancelled:true,cancellationDate:response.subscription.canceledDate||null,updatedAt:stamp()});
   }
   result.subscriptionCancelled=!!record.squareSubscriptionId;
   if(opts.revokeOAuth!==false)await revokeConnections(uid,businesses);
   const results=await Promise.allSettled(result.storagePrefixes.map(prefix=>admin.storage().bucket().deleteFiles({prefix})));
   if(results.some(r=>r.status==='rejected'))throw Error('Storage cleanup incomplete; retry account deletion');
   // Query every top-level owner collection before deleting the user tree.
   // Billing/webhook ledgers are retained deliberately for reconciliation.
   for(const name of ['copyLibrary','activityLogs','reviews','setupNudges','importJobs','oauthNonces','draftActions','aiRequestDedup']){
    const owned=await db.collection(name).where('uid','==',uid).get();
    for(const doc of owned.docs){await db.recursiveDelete(doc.ref);result.docsDeleted++;}
   }
   await db.recursiveDelete(user); // Includes unknown/deep private descendants and orphan parents.
   if(opts.deleteAuthUser!==false){
    try {await admin.auth().deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
    result.authUserDeleted=true;
   }
   await subRef.delete();
   await journal.update({status:'completed',leaseUntil:0,completedAt:stamp(),updatedAt:stamp(),lastError:admin.firestore.FieldValue.delete(),storagePrefixes:admin.firestore.FieldValue.delete(),squareSubscriptionId:admin.firestore.FieldValue.delete()});
   return result;
  } catch(e) {
   await journal.update({status:'retry_required',leaseUntil:0,lastError:String(e.message).slice(0,300),updatedAt:stamp()}).catch(()=>{});
   throw Object.assign(Error('Account deletion is incomplete. Your deletion record is retained; retry to finish.'),{httpStatus:503,cause:e});
  }
 };
}
module.exports={createAccountDeletion};
