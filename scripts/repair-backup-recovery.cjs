'use strict';
// Main-only recovery repair. Never imports into, deletes, or restores over default.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {PROJECT,BUCKET,waitOperation}=require('../functions/lib/firestore-backup');
function target(args,env=process.env){
 if(args.length!==1||args[0]!=='--project='+PROJECT||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REF!=='refs/heads/main'||!/^\d+$/.test(env.GITHUB_RUN_ID||''))throw Error('Recovery repair requires the reviewed Main workflow and exact project');
 return 'bb-restore-check-'+env.GITHUB_RUN_ID;
}
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function preservedRestoreTarget(id){
 if(!/^\d+$/.test(id||''))throw Error('Invalid preserved restore run');
 return 'bb-restore-check-'+id;
}
async function captureRestoreBaseline(request,base){
  const crypto=require('node:crypto');
  const out={configuration:{},counts:{}};
  for(const path of ['config/plans','settings/pricing']){
    const d=await request(base+'/documents/'+path);
    out.configuration[path]=crypto.createHash('sha256').update(canonical(d.fields||{})).digest('hex');
  }
  for(const collectionId of ['users','businesses','listingDrafts','publishJobs']){
    const rows=await request(base+'/documents:runAggregationQuery','POST',{structuredAggregationQuery:{structuredQuery:{from:[{collectionId,...(collectionId==='users'?{}:{allDescendants:true})}]},aggregations:[{alias:'total',count:{}}]}});
    const values=rows.filter(r=>r.result?.aggregateFields?.total).map(r=>Number(r.result.aggregateFields.total.integerValue));
    if(values.length!==1||!Number.isSafeInteger(values[0])||values[0]<0)throw Error('Invalid restore count: '+collectionId);
    out.counts[collectionId]=values[0];
  }
  return out;
}
async function verifyRestore(request,baseline,destination){
  const restored=await captureRestoreBaseline(request,destination),comparison={};
  for(const path of Object.keys(baseline.configuration))if(baseline.configuration[path]!==restored.configuration[path])throw Error('Restored configuration does not match pre-export source: '+path);
  for(const [name,before]of Object.entries(baseline.counts)){
    // Accounts and small collections must match exactly. Larger collection
    // groups allow at most 1%, capped at two documents, for export-time writes.
    const allowedDrift=name==='users'?0:Math.min(2,Math.floor(before*0.01));
    const after=restored.counts[name];
    comparison[name]={before,restored:after,allowedDrift};
    if(!Number.isSafeInteger(after)||Math.abs(after-before)>allowedDrift||(before>0&&after===0))throw Error('Restore count mismatch: '+name);
  }
  return comparison;
}
async function cleanupExpiredRestores(request,currentId,report,save,{now=Date.now(),wait=waitOperation}={}){
  const base=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases`;
  const prefix=`projects/${PROJECT}/databases/`;
  const inventory=await request(base);
  if(inventory.nextPageToken||inventory.unreachable?.length)throw Error('Incomplete restore database inventory');
  report.expiredRestoreCleanup=[];save();
  for(const d of inventory.databases||[]){
    const id=d.name?.startsWith(prefix)?d.name.slice(prefix.length):'';
    if(!/^bb-restore-check-\d+$/.test(id)||id===currentId)continue;
    const created=Date.parse(d.createTime);
    if(!Number.isFinite(created)||now-created<=7*86400000)continue;
    if(d.type!=='FIRESTORE_NATIVE'||d.deleteProtectionState!=='DELETE_PROTECTION_DISABLED')continue;
    // Recheck immutable identity and age immediately before destructive work.
    const fresh=await request(base+'/'+id);
    if(fresh.name!==d.name||fresh.uid!==d.uid||fresh.createTime!==d.createTime||fresh.deleteProtectionState!=='DELETE_PROTECTION_DISABLED')throw Error('Restore cleanup target changed: '+id);
    const entry={database:id,createdAt:d.createTime,removed:false};report.expiredRestoreCleanup.push(entry);save();
    await wait(request,await request(base+'/'+id,'DELETE'));
    entry.removed=true;save();
  }
}
async function run(args){
 const restoreId=target(args),token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8'}).trim();
 const projectNumber=execFileSync('gcloud',['projects','describe',PROJECT,'--format=value(projectNumber)'],{encoding:'utf8'}).trim();
 if(!/^\d+$/.test(projectNumber))throw Error('Project number unavailable');
 const report={project:PROJECT,startedAt:new Date().toISOString(),restoreId,steps:[]};
 const save=()=>fs.writeFileSync('blastybiz-recovery.json',JSON.stringify(report,null,2));save();
 async function request(url,method='GET',body,missing=false){
  const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  if(missing&&r.status===404)return null;
  if(!r.ok)throw Error(method+' '+new URL(url).pathname+' HTTP '+r.status);
  return r.status===204?{}:r.json();
 }
 const api='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/';
 const destination=api+restoreId;
 let createdHere=false,restored=false;
 try{
  await cleanupExpiredRestores(request,restoreId,report,save);
  const database=await request(api+'(default)');
  const storage='https://storage.googleapis.com/storage/v1/b/'+BUCKET;
  let bucket=await request(storage,'GET',null,true);
  if(!bucket){
   bucket=await request('https://storage.googleapis.com/storage/v1/b?project='+PROJECT,'POST',{name:BUCKET,location:({nam5:'US',eur3:'EU',asia1:'ASIA'})[database.locationId]||database.locationId,iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'},lifecycle:{rule:[{action:{type:'Delete'},condition:{age:35}}]}});
   report.steps.push('Created private export bucket with 35-day object retention');save();
  }
  if(String(bucket.projectNumber)!==projectNumber)throw Error('Backup bucket belongs to another project');
  if(bucket.iamConfiguration?.publicAccessPrevention!=='enforced'||!bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled)throw Error('Existing backup bucket is not private/uniform; review required');
  const iam=await request(storage+'/iam');
  if((iam.bindings||[]).some(b=>(b.members||[]).some(m=>['allUsers','allAuthenticatedUsers'].includes(m))))throw Error('Backup bucket contains public IAM grant');
  const member='serviceAccount:service-'+projectNumber+'@gcp-sa-firestore.iam.gserviceaccount.com';
  if(!(iam.bindings||[]).some(b=>b.role==='roles/storage.objectAdmin'&&(b.members||[]).includes(member))){
   iam.bindings=iam.bindings||[];iam.bindings.push({role:'roles/storage.objectAdmin',members:[member]});
   await request(storage+'/iam','PUT',iam);report.steps.push('Granted Firestore service agent object access on backup bucket only');save();
  }
  if(database.pointInTimeRecoveryEnablement!=='POINT_IN_TIME_RECOVERY_ENABLED'){
   const op=await request(api+'(default)?updateMask=pointInTimeRecoveryEnablement','PATCH',{name:database.name,pointInTimeRecoveryEnablement:'POINT_IN_TIME_RECOVERY_ENABLED'});
   await waitOperation(request,op);report.steps.push('Enabled default database PITR');save();
  }
  // Export all collections. Data stays in the private project bucket.
  const baseline=await captureRestoreBaseline(request,api+'(default)');
  report.preExport=baseline;save();
  const output=`gs://${BUCKET}/recovery-${process.env.GITHUB_RUN_ID}-${Date.now()}`;
  const exported=await waitOperation(request,await request(api+'(default):exportDocuments','POST',{outputUriPrefix:output}));
  const prefix=exported.response?.outputUriPrefix;
  if(!prefix?.startsWith(`gs://${BUCKET}/`))throw Error('Unexpected completed export prefix');
  report.export={completed:true,operation:exported.name,outputUriPrefix:prefix};save();
  if(await request(destination,'GET',null,true))throw Error('Restore-check database already exists; refusing to overwrite it');
  const created=await request(api.slice(0,-1)+'?databaseId='+restoreId,'POST',{locationId:database.locationId,type:'FIRESTORE_NATIVE',deleteProtectionState:'DELETE_PROTECTION_DISABLED'});
  createdHere=true;await waitOperation(request,created);report.steps.push('Created isolated restore-check database');save();
  const imported=await waitOperation(request,await request(destination+':importDocuments','POST',{inputUriPrefix:prefix}));
  // Compare exact aggregate counts and configuration hashes; never emit data.
  const counts=await verifyRestore(request,baseline,destination);
  restored=true;report.restore={completed:true,operation:imported.name,configurationMatches:true,counts};save();
  const live=await request(api+'(default)');
  if(live.pointInTimeRecoveryEnablement!=='POINT_IN_TIME_RECOVERY_ENABLED')throw Error('PITR not enabled');
  report.pitr={enabled:true,earliestVersionTime:live.earliestVersionTime,versionRetentionPeriod:live.versionRetentionPeriod};
  // Recovery does not need this cross-service rule permission. Verify it only
  // after proving restore, but still before any rules/backend deployment.
  // The existing Main identity cannot administer this project's IAM; never
  // retry the denied grant or substitute another identity.
  const projectIam='https://cloudresourcemanager.googleapis.com/v1/projects/'+PROJECT;
  const policy=await request(projectIam+':getIamPolicy','POST',{options:{requestedPolicyVersion:3}});
  const storageAgent='serviceAccount:service-'+projectNumber+'@gcp-sa-firebasestorage.iam.gserviceaccount.com';
  const rulesRole='roles/firebaserules.firestoreServiceAgent';
  const ready=(policy.bindings||[]).some(b=>b.role===rulesRole&&!b.condition&&(b.members||[]).includes(storageAgent));
  report.storageRules={ready,requiredMember:storageAgent,requiredRole:rulesRole};save();
  if(!ready)throw Error('Storage rules require a project IAM administrator to grant '+rulesRole+' to '+storageAgent+'; deployment remains blocked');

 }catch(e){report.error=e.message;throw e;}
 finally{
  // Delete only the disposable database created by this exact run, after a
  // successful restore check. Preserve failures for diagnosis; never delete default.
  if(createdHere&&restored){
   try{await waitOperation(request,await request(destination,'DELETE'));report.restoreDatabaseRemoved=true;}
   catch(e){report.cleanupError=e.message;save();throw e;}
  }
  report.completedAt=new Date().toISOString();save();
 }
 console.log('RECOVERY_VERIFIED '+JSON.stringify({exportCompleted:!!report.export?.completed,restoreCompleted:!!report.restore?.completed,pitr:report.pitr?.enabled,restoreDatabaseRemoved:report.restoreDatabaseRemoved}));
}
if(require.main===module)run(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={target,canonical,preservedRestoreTarget,captureRestoreBaseline,verifyRestore,cleanupExpiredRestores};
