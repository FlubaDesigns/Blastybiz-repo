'use strict';
// Run only through the existing Main release after all old writers have drained.
// The same allowance owner moves each record atomically; no balances are reset.
const assert=require('node:assert/strict');
const {createAiAllowance,USAGE_FIELDS}=require('../functions/lib/ai-allowance');
async function inventory(db){
 let cursor,users=0,legacy=0;
 for(;;){let q=db.collection('users').orderBy('__name__').limit(200);if(cursor)q=q.startAfter(cursor);const page=await q.get();
  for(const user of page.docs){users++;if(USAGE_FIELDS.some(key=>Object.hasOwn(user.data(),key)))legacy++;}
  if(page.size<200)return {users,legacy};cursor=page.docs.at(-1);
 }
}
async function migrate({db,admin,apply=false}){
 const before=await inventory(db);if(!apply)return {applied:false,before};
 const marker=db.doc('config/aiAllowanceStorage');
 await db.runTransaction(async tx=>{const snap=await tx.get(marker);assert([undefined,2].includes(snap.data()?.version),'Unexpected allowance storage version');if(!snap.exists)tx.create(marker,{version:2,cutoverAt:admin.firestore.FieldValue.serverTimestamp()});});
 const service=createAiAllowance({db,admin});let cursor;
 for(;;){let q=db.collection('users').orderBy('__name__').limit(200);if(cursor)q=q.startAfter(cursor);const page=await q.get();
  for(const user of page.docs)await service.migrateUser(user.id);
  if(page.size<200)break;cursor=page.docs.at(-1);
 }
 const after=await inventory(db);assert.equal(after.legacy,0,'Public quota fields remain');return {applied:true,before,after};
}
module.exports={migrate,inventory};
if(require.main===module){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REF,'refs/heads/main');
 const args=process.argv.slice(2);assert(args.every(a=>['--apply','--project=blastybiz-9523e'].includes(a)));assert(args.includes('--project=blastybiz-9523e'));
 const admin=require('../functions/node_modules/firebase-admin');
 require('./migrate-pass11.cjs').initializeTarget(admin).then(db=>migrate({db,admin,apply:args.includes('--apply')})).then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
