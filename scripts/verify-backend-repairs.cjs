'use strict';
// Read-only query checks, plus an explicit run of the repaired backup scheduler.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {PROJECT,BUCKET,BACKUP_SERVICE_ACCOUNT}=require('../functions/lib/firestore-backup');
function revision(snapshot){
 if(!snapshot.exists)return null;
 const t=snapshot.updateTime;
 if(!Number.isInteger(t?.seconds)||!Number.isInteger(t?.nanoseconds))throw Error('Backup record revision unavailable');
 return `${t.seconds}:${t.nanoseconds}`;
}
async function verifyScheduledBackup({read,invoke,clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=10*60000}){
 const started=clock(),day=ms=>new Date(ms).toISOString().slice(0,10);
 // Capture server revisions before dispatch. The Scheduler run API acknowledges
 // dispatch, not execution: the old failed document can remain for several polls.
 // Read tomorrow too so a dispatch across UTC midnight has a known baseline.
 const dates=[day(started),day(started+86400000)],baseline=new Map();
 for(const date of dates)baseline.set(date,revision(await read(date)));
 await invoke();
 const deadline=clock()+timeoutMs;let ignoredStaleFailures=0;
 while(clock()<deadline){
  const date=day(clock());
  if(!baseline.has(date))throw Error('Backup verification exceeded captured UTC dates');
  const snapshot=await read(date),r=snapshot.data(),version=revision(snapshot);
  if(r?.status==='completed'){
   if(r.serviceAccount!==BACKUP_SERVICE_ACCOUNT){
    if(version!==baseline.get(date))throw Error('Completed backup has an unexpected runtime identity');
    await sleep(Math.min(5000,Math.max(0,deadline-clock())));continue;
   }
   if(!r.operation?.startsWith(`projects/${PROJECT}/databases/(default)/operations/`)||!r.outputUriPrefix?.startsWith(`gs://${BUCKET}/`))throw Error('Unexpected completed backup target');
   return {completed:true,date,serviceAccount:r.serviceAccount,operation:r.operation,outputUriPrefix:r.outputUriPrefix,
    evidence:version===baseline.get(date)?'existing-completed-daily-backup':'completion-observed-after-dispatch',ignoredStaleFailures};
  }
  if(r?.status==='failed'){
   if(version!==baseline.get(date))throw Error('Scheduled backup failed: '+r.lastError);
   ignoredStaleFailures++;
  }
  await sleep(Math.min(5000,Math.max(0,deadline-clock())));
 }
 throw Error('Scheduled backup completion not observed before timeout');
}
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
  const runtime=await fetch(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/us-central1/functions/scheduledFirestoreExport`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
  if(!runtime.ok||(await runtime.json()).serviceConfig?.serviceAccountEmail!==BACKUP_SERVICE_ACCOUNT)throw Error('Dedicated backup runtime identity is not deployed');
  report.scheduledBackup=await verifyScheduledBackup({
   read:date=>db.collection('backupRuns').doc(date).get(),
   invoke:async()=>{
    const resp=await fetch(`https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/jobs/firebase-schedule-scheduledFirestoreExport-us-central1:run`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});
    if(!resp.ok)throw Error('Backup scheduler invocation HTTP '+resp.status);
   }
  });save();
  const [users,jobs,drafts]=await Promise.all([db.collection('users').count().get(),db.collectionGroup('publishJobs').count().get(),db.collectionGroup('listingDrafts').count().get()]);
  report.preservedInventory={accounts:users.data().count,publishJobs:jobs.data().count,listingDrafts:drafts.data().count};
  report.verified=true;report.completedAt=new Date().toISOString();save();console.log('BACKEND_VERIFIED '+JSON.stringify(report));
 }catch(e){report.error=e.message;save();throw e;}finally{await db.terminate();}
}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={verifyScheduledBackup};
