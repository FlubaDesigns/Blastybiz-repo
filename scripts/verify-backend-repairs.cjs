'use strict';
// Read-only query checks, plus an explicit run of the repaired backup scheduler.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const PROJECT='blastybiz-9523e';
async function run(){
 if(process.argv.slice(2).join(' ')!=='--project='+PROJECT||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Exact Main target required');
 const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp({projectId:PROJECT});const db=admin.firestore();
 const report={project:PROJECT,checkedAt:new Date().toISOString(),queries:[]},save=()=>fs.writeFileSync('blastybiz-backend-verification.json',JSON.stringify(report,null,2));save();
 try{
  const probes=[['businesses_recent',db.collectionGroup('businesses').orderBy('createdAt','desc')],['businesses_owner',db.collectionGroup('businesses').where('uid','==','__backend_audit_no_user__')],['jobs_recent',db.collectionGroup('publishJobs').orderBy('createdAt','desc')]];
  const filters=[['status','failed'],['platform','google'],['uid','__backend_audit_no_user__']];
  for(let mask=1;mask<8;mask++){let q=db.collectionGroup('publishJobs');const names=[];filters.forEach(([field,value],i)=>{if(mask&(1<<i)){q=q.where(field,'==',value);names.push(field);}});probes.push(['jobs_'+names.join('_'),q.orderBy('createdAt','desc')]);}
  probes.push(['connections_platform',db.collectionGroup('platformConnections').where('platform','==','google')],['connections_status_platform',db.collectionGroup('platformConnections').where('status','==','connected').where('platform','==','google')],['setup_pending',db.collection('setupNudges').where('sent','==',false).where('sendAfter','<=',admin.firestore.Timestamp.now())]);
  for(const [name,q]of probes){const r=await q.limit(1).get();report.queries.push({name,ok:true,count:r.size});save();}
  const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8'}).trim();
  const resp=await fetch(`https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/jobs/firebase-schedule-scheduledFirestoreExport-us-central1:run`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});
  if(!resp.ok)throw Error('Backup scheduler invocation HTTP '+resp.status);
  const date=new Date().toISOString().slice(0,10),deadline=Date.now()+10*60000;
  while(Date.now()<deadline){
   const r=(await db.collection('backupRuns').doc(date).get()).data();
   if(r?.status==='completed'){report.scheduledBackup={completed:true,operation:r.operation,outputUriPrefix:r.outputUriPrefix};break;}
   if(r?.status==='failed')throw Error('Scheduled backup failed: '+r.lastError);
   await new Promise(resolve=>setTimeout(resolve,5000));
  }
  if(!report.scheduledBackup?.completed)throw Error('Scheduled backup completion not observed');
  const [users,jobs,drafts]=await Promise.all([db.collection('users').count().get(),db.collectionGroup('publishJobs').count().get(),db.collectionGroup('listingDrafts').count().get()]);
  report.preservedInventory={accounts:users.data().count,publishJobs:jobs.data().count,listingDrafts:drafts.data().count};
  report.verified=true;report.completedAt=new Date().toISOString();save();console.log('BACKEND_VERIFIED '+JSON.stringify(report));
 }catch(e){report.error=e.message;save();throw e;}finally{await db.terminate();}
}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
