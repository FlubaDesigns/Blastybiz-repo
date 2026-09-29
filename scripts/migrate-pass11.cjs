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
const PROJECT_ID='blastybiz-9523e';
function parseArgs(args) {
 if(args.some(a=>a!=='--apply'&&a!=='--project='+PROJECT_ID) || args.filter(a=>a.startsWith('--project=')).length!==1)throw Error('Explicit target required: --project='+PROJECT_ID+' [--apply]');
 return {projectId:PROJECT_ID,apply:args.includes('--apply')};
}
async function initializeTarget(admin) {
 const options={projectId:PROJECT_ID};
 const app=admin.initializeApp({projectId:options.projectId});
 const db=admin.firestore(app);
 // Force project resolution before preview or mutation. Credential project must not win.
 await db.initializeIfNeeded();
 if(db.projectId!==PROJECT_ID)throw Error('Firestore target mismatch: refusing migration.');
 return db;
}
async function runCli(args,admin) {
 const options=parseArgs(args),db=await initializeTarget(admin);
 const result=await configure(db,options.apply);
 const [lifecycle,plans]=await Promise.all([db.doc('config/lifecycle').get(),db.doc('config/plans').get()]);
 return {projectId:db.projectId,...result,verified:{lifecycle:lifecycle.data()||null,aiLimits:plans.data()?.aiLimits||null}};
}
if(require.main===module){runCli(process.argv.slice(2),require('../functions/node_modules/firebase-admin')).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={configure,parseArgs,runCli,initializeTarget,PROJECT_ID};
