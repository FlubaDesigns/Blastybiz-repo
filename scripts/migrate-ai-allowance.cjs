'use strict';
// Read-only audit after the completed private allowance cutover.
// Migration implementation is retained in the reviewed bridge commit history.
const assert=require('node:assert/strict');
const {USAGE_FIELDS}=require('../functions/lib/ai-allowance');
async function inventory(db){
 let cursor,users=0,legacy=0;
 for(;;){let q=db.collection('users').orderBy('__name__').limit(200);if(cursor)q=q.startAfter(cursor);const page=await q.get();
  for(const user of page.docs){users++;if(USAGE_FIELDS.some(key=>Object.hasOwn(user.data(),key)))legacy++;}
  if(page.size<200)return {users,legacy};cursor=page.docs.at(-1);
 }
}
module.exports={inventory};
if(require.main===module){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REF,'refs/heads/main');
 const args=process.argv.slice(2);assert(args.every(a=>['--project=blastybiz-9523e'].includes(a)));assert(args.includes('--project=blastybiz-9523e'));
 const admin=require('../functions/node_modules/firebase-admin');
 require('./migrate-pass11.cjs').initializeTarget(admin).then(async db=>{assert.equal((await db.doc('config/aiAllowanceStorage').get()).data()?.version,2,'Private cutover has not been activated');const result=await inventory(db);assert.equal(result.legacy,0,'Public quota fields remain');return result;}).then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
