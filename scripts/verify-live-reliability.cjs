'use strict';
// Exact deployed handlers with isolated cached results. No paid model, provider
// publishing, checkout or subscription mutation is called by this acceptance.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {randomUUID,createHash}=require('node:crypto');
(async()=>{
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw Error('Existing Authorization Engine Main identity required.');
 const admin=require('../functions/node_modules/firebase-admin');
 const app=admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'blastybiz-9523e'},'reliability-acceptance');
 const db=app.firestore(),auth=app.auth(),uid='reliability_'+randomUUID().replaceAll('-',''),user=db.doc('users/'+uid);
 const requestId='acceptance_'+randomUUID().replaceAll('-',''),ledger=db.doc('aiRequestDedup/'+uid+'_'+requestId);
 let created=false;
 try{
   const email=uid+'@example.invalid',password=randomUUID()+randomUUID();
   await auth.createUser({uid,email,password,emailVerified:true});created=true;
   await user.set({plan:'starter',acceptanceFixture:true});
   await user.collection('private').doc('aiAllowance').set({schemaVersion:2,aiActionsUsed:0});
   await user.collection('businesses').doc('fixture').set({name:'Reliability acceptance fixture',schedulingPaused:true,sellerType:'business'});
   const apiKey=fs.readFileSync('public/firebase-init-v2.js','utf8').match(/apiKey:\s*["']([^"']+)/)?.[1];assert(apiKey);
   const signed=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
   assert(signed.ok,'ordinary fixture authentication');const {idToken}=await signed.json();assert(idToken);
   const base='https://us-central1-blastybiz-9523e.cloudfunctions.net/';
   async function api(name,body,status=200,authenticated=true){
     const response=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://blastybiz.com',...(authenticated?{Authorization:'Bearer '+idToken}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
     assert.equal(response.status,status,name+' response');return response.json();
   }
   for(const name of ['adaptListing','createPortalSession'])await api(name,{},401,false);
   const body={listing:{businessId:'fixture',name:'Acceptance fixture',requestId},platforms:[{id:'facebook',name:'Facebook'}],tone:'friendly'};
   const fingerprint=createHash('sha256').update(JSON.stringify({...body,listing:{...body.listing,requestId:undefined},requestId:undefined,generationAttemptId:undefined})).digest('hex');
   const result={adaptations:{facebook:'Previously completed acceptance copy'},failedPlatforms:[],status:'complete',freeRegenApplied:false};
   await ledger.set({uid,fingerprint,state:'completed',token:'fixture',result,createdAt:admin.firestore.FieldValue.serverTimestamp()});
   const replies=await Promise.all([api('adaptListing',body),api('adaptListing',body)]);replies.forEach(reply=>assert.deepEqual(reply,result));
   const conflict=await api('adaptListing',{...body,tone:'different'},409);assert.equal(conflict.code,'REQUEST_CONFLICT');
   await ledger.update({state:'pending',result:null,leaseExpiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+300000)});
   assert.equal((await api('adaptListing',body,409)).code,'GENERATION_PENDING');
   await api('adaptListing',{...body,platforms:[{id:'not-a-platform'}]},400);
   const billing=await api('createPortalSession',{action:'status'});assert.equal(billing.hasSubscription,false);
   assert.equal((await user.collection('private').doc('aiAllowance').get()).data().aiActionsUsed,0,'cache/conflict/pending calls do not spend allowance');
   assert.equal((await db.collection('aiUsageLogs').where('uid','==',uid).get()).size,0,'no model call');
   assert.equal((await user.collection('businesses').doc('fixture').collection('publishJobs').get()).size,0,'no publication');
   console.log('PASS LIVE: authenticated cached generation, concurrent replay, changed-input rejection, pending recovery, platform validation and account-scoped billing status. No AI purchase, card charge, subscription change or publication.');
 }finally{
   await ledger.delete();await db.recursiveDelete(user);
   if(created)await auth.deleteUser(uid).catch(e=>{if(e.code!=='auth/user-not-found')throw e;});
   await app.delete();
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
