'use strict';
const {parseArgs,initializeTarget,PROJECT_ID}=require('./migrate-pass11.cjs');
// Repair only dangling activeBusiness pointers discovered by the audit.
// No business, account, campaign or history is deleted or recreated.
async function repair(db,apply=false) {
 const users=await db.collection('users').limit(1001).get();
 if(users.size>1000)throw Error('User bound exceeded. Refusing partial repair.');
 const result={projectId:PROJECT_ID,applied:apply,examined:users.size,affected:0,cleared:0,reselected:0};
 for(const doc of users.docs)await db.runTransaction(async tx=>{
  const user=await tx.get(doc.ref),businesses=await tx.get(doc.ref.collection('businesses'));
  if(!user.exists)return;
  const data=user.data(),ids=businesses.docs.map(d=>d.id).sort();
  if(!data.activeBusiness || ids.includes(data.activeBusiness))return;
  const activeBusiness=ids[0]||null;
  if(apply)tx.update(doc.ref,{activeBusiness,businessIds:ids});
  // Count outside callbacks in production if transactions retry? Return classification.
  return activeBusiness?'reselected':'cleared';
 }).then(kind=>{if(kind){result.affected++;result[kind]++;}});
 return result;
}
if(require.main===module){(async()=>{const options=parseArgs(process.argv.slice(2)),db=await initializeTarget(require('../functions/node_modules/firebase-admin'));const result=await repair(db,options.apply),verified=options.apply?await repair(db,false):null;if(verified?.affected)throw Error('Dangling pointers remain after repair.');console.log(JSON.stringify({...result,verified},null,2));})().catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={repair};
