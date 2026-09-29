'use strict';
// Configuration only. Dry-run by default; never queues or replays a Blast.
const policy=require('../functions/lib/lifecycle-policy');
async function configure(db,apply=false,clock=()=>new Date()) {
 const ref=db.collection('config').doc('lifecycle'),plans=db.collection('config').doc('plans');
 return db.runTransaction(async tx=>{const snap=await tx.get(ref),data=snap.data()||{},patch={},planSnap=await tx.get(plans),planData=planSnap.data()||{},planPatch={};if(data.manualLapseDays===undefined)patch.manualLapseDays=policy.manualLapseDays;
   if(data.remindersStartAt===undefined)patch.remindersStartAt=apply?clock().toISOString():'Set to apply time (no reminders until applied)';
   for(const [tier,cap] of Object.entries(policy.aiLimits))if(planData.aiLimits?.[tier]===undefined)planPatch['aiLimits.'+tier]=cap;
   if(apply&&Object.keys(patch).length)tx.set(ref,patch,{merge:true});if(apply&&Object.keys(planPatch).length){if(planSnap.exists)tx.update(plans,planPatch);else tx.set(plans,{aiLimits:policy.aiLimits});}return {applied:apply,patch,planPatch};});
}
if(require.main===module){const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp();configure(admin.firestore(),process.argv.includes('--apply')).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={configure};
