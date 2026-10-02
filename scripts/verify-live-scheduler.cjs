'use strict';
// Runs inside the existing Authorization Engine Main job. A temporary account
// has no email, no provider connections, and publishing paused throughout.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
module.exports=async function verifyLiveScheduler(){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw Error('Scheduler acceptance requires the Authorization Engine Main identity');
 const admin=require('../functions/node_modules/firebase-admin');
 const app=admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'blastybiz-9523e',storageBucket:'blastybiz-9523e.firebasestorage.app'},'scheduler-acceptance');
 const db=app.firestore(),auth=app.auth(),uid='scheduler_check_'+randomUUID().replaceAll('-',''),user=db.doc('users/'+uid),br=user.collection('businesses').doc('fixture'),cr=br.collection('campaigns').doc('fixture'),ar=cr.collection('ads').doc('fixture'),source=br.collection('listingDrafts').doc('original');
 const endpoint='https://us-central1-blastybiz-9523e.cloudfunctions.net/manageBlast';
 let idToken,created=false;
 async function api(action,values={},status=200){
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+idToken},body:JSON.stringify({action,businessId:'fixture',campaignId:'fixture',adId:'fixture',sourceBlastId:'original',...values}),signal:AbortSignal.timeout(125000)});
   const data=await response.json();assert.equal(response.status,status,'Live scheduler '+action+': '+(data.error||response.status));return data;
 }
 try{
   await auth.createUser({uid});created=true;
   await user.set({plan:'starter',acceptanceFixture:true,createdAt:admin.firestore.FieldValue.serverTimestamp()});
   await br.set({name:'Scheduler acceptance fixture',schedulingPaused:true});
   await cr.set({name:'Scheduler acceptance fixture'});
   const image={id:'original',url:'https://blastybiz.com/img/hero-blast.png',path:'',alt:'Acceptance photo'};
   await cr.collection('images').doc(image.id).set(image);
   await ar.set({id:'fixture',uid,businessId:'fixture',campaignId:'fixture',revision:1,name:'Scheduler acceptance',platforms:['craigslist'],adaptations:{craigslist:'Later Ad edit must not replace the sent copy'},platformStatus:{craigslist:'approved'},imageRefs:[image]});
   await source.set({uid,businessId:'fixture',campaignId:'fixture',adId:'fixture',status:'approved',adaptations:{craigslist:'Later draft edit must not replace the sent copy'},imagesByPlatform:{craigslist:[]}});
   const sent={uid,businessId:'fixture',campaignId:'fixture',adId:'fixture',draftId:source.id,platform:'craigslist',status:'manual_skipped',payload:{adaptedContent:'Saved original-format blast acceptance copy',imageUrls:[image.url]}};
   const job=br.collection('publishJobs').doc('original_craigslist');await job.set(sent);
   const apiKey=fs.readFileSync('public/firebase-init-v2.js','utf8').match(/apiKey:\s*["']([^"']+)/)?.[1];assert(apiKey,'Public Firebase configuration missing');
   const token=await auth.createCustomToken(uid);
   const signIn=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
   assert(signIn.ok,'Fixture sign-in failed');idToken=(await signIn.json()).idToken;assert(idToken);
   const unauthorized=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'editor',businessId:'fixture',campaignId:'fixture',adId:'fixture'})});assert.equal(unauthorized.status,401);
   await api('editor',{businessId:'missing'},404);
   const state=await api('editor');
   assert.equal(state.packet.adaptations.craigslist,sent.payload.adaptedContent);
   assert.deepEqual(state.packet.imagesByPlatform.craigslist,sent.payload.imageUrls);
   assert.deepEqual(state.packet.imageRefs.map(i=>i.id),[image.id]);
   const save={expectedRevision:0,reviewKey:state.reviewKey,reviewed:true,replacePrepared:true,imageIds:[image.id],requestId:'acceptance_save',schedule:{frequency:'once',firstRunAtUtc:new Date(Date.now()+7*86400000).toISOString(),timezone:'UTC',approvalBehavior:'automatic'}};
   const saved=await api('save',save),retry=await api('save',save);assert.equal(retry.schedule.preparedBlastId,saved.schedule.preparedBlastId);
   const prepared=br.collection('listingDrafts').doc(saved.schedule.preparedBlastId),next=(await prepared.get()).data();
   assert.equal(next.status,'scheduled');assert.equal(next.approvalStatus,'approved');assert.equal(next.packet.adaptations.craigslist,sent.payload.adaptedContent);assert.deepEqual(next.packet.imagesByPlatform.craigslist,sent.payload.imageUrls);
   const requestId='acceptance_image';
   const generated=await api('generateImage',{requestId,prompt:'A simple square illustration of a blue ceramic vase on a white table. No text.'});
   assert(generated.image?.url&&generated.image.id==='ai_'+requestId);
   const repeated=await api('generateImage',{requestId,prompt:'A simple square illustration of a blue ceramic vase on a white table. No text.'});assert.equal(repeated.image.id,generated.image.id);
   const afterImage=(await prepared.get()).data();assert.deepEqual(afterImage.packet,next.packet,'Image generation cannot silently replace the saved post');
   const edit=await api('editor');const updated=await api('save',{...save,expectedRevision:edit.schedule.revision,reviewKey:edit.reviewKey,imageIds:[generated.image.id],requestId:'acceptance_changed_image'});
   assert.equal((await br.collection('listingDrafts').doc(updated.schedule.preparedBlastId).get()).data().packet.imageRefs[0].id,generated.image.id);
   await api('cancel',{expectedRevision:updated.schedule.revision});
   assert.equal((await ar.get()).data().schedule.status,'canceled');
   assert.equal((await br.collection('listingDrafts').doc(updated.schedule.preparedBlastId).get()).data().status,'canceled');
   assert.equal((await br.collection('publishJobs').get()).size,1,'Acceptance must not publish');
   assert.deepEqual((await job.get()).data().payload,sent.payload);
   assert.equal((await source.get()).data().packet,undefined,'Original records stay in their existing format');
   console.log('PASS live authenticated scheduler: original-format source, exact sent payload, keep photo, persisted save, duplicate-save protection, AI image creation/retry/selection, cancellation, authentication boundary; no post dispatched.');
 }finally{
   const images=await cr.collection('images').get();
   for(const row of images.docs){const path=row.data().path;if(path?.startsWith('photos/'+uid+'/'))await app.storage().bucket().file(path).delete({ignoreNotFound:true});}
   for(const collection of ['aiUsageLogs','activityLogs']){const rows=await db.collection(collection).where('uid','==',uid).get();for(const row of rows.docs)await row.ref.delete();}
   await db.recursiveDelete(user);
   await db.collection('setupNudges').doc(uid).delete();
   if(created)await auth.deleteUser(uid);
   await app.delete();
 }
};
