'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Review test requires Firestore emulator');
const admin=require('../functions/node_modules/firebase-admin');
admin.initializeApp({projectId:'demo-blastybiz-audit2'});const db=admin.firestore();
(async()=>{
 const uid='review-import-emulator',biz='review-business';
 await db.doc('users/'+uid).set({lastActiveAt:admin.firestore.Timestamp.now()});
 await db.doc(`users/${uid}/businesses/${biz}`).set({name:'Fixture'});
 const filename=path.resolve('functions/modules/publishing.js'),req=createRequire(filename),exports={};
 const wrapper=(...a)=>a.at(-1),shared={db,admin,onRequest:wrapper,onDocumentUpdated:wrapper,onDocumentCreated:wrapper,withAuth:f=>f,checkUidRateLimit:async()=>true,userBizRef:(u,b)=>db.doc(`users/${u}/businesses/${b}`)};
 // Execute unchanged source in the SDK's native JS realm. Firestore checks
 // native Promise/plain-object identity; VM objects are not valid SDK inputs.
 new Function('require','exports','module',fs.readFileSync(filename,'utf8'))(p=>p==='../lib/shared'?shared:req(p),exports,{exports});
 const invoke=async()=>{const r={status(n){this.code=n;return this;},json(body){this.body=body;}};await exports.importGooglePhotos({body:{bizId:biz}},r,{uid});return r.body.jobId;};
 const concurrent=await Promise.allSettled([invoke(),invoke(),invoke()]);
 for(const result of concurrent)if(result.status==='rejected')throw result.reason;
 const ids=concurrent.map(r=>r.value);assert.equal(new Set(ids).size,1);
 assert.equal((await db.collection('importJobs').where('uid','==',uid).get()).size,1);
 await db.doc('importJobs/'+ids[0]).update({status:'completed'});const next=await invoke();assert.notEqual(next,ids[0]);
 await db.doc('accountDeletions/'+uid).set({status:'running'});await assert.rejects(invoke,/unavailable/);
 const source=fs.readFileSync('functions/lib/shared.js','utf8'),code=source.slice(source.indexOf('async function touchLastActive'),source.indexOf('// Best available evidence'));
 const touch=new Function('db','admin','_LAST_ACTIVE_THROTTLE_MS',code+'; return touchLastActive;')(db,admin,6*3600000);
 await assert.rejects(()=>touch(uid),e=>e.code==='ACCOUNT_DELETION_PENDING');
 console.log('PASS actual Firestore: concurrent imports create one job; completed job permits re-import; deletion blocks import and throttled activity.');
})().finally(()=>db.terminate()).catch(e=>{console.error(e);process.exitCode=1;});
