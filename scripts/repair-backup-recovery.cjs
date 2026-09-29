'use strict';
// Main-only recovery repair. Never imports into, deletes, or restores over default.
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
const {PROJECT,BUCKET,waitOperation}=require('../functions/lib/firestore-backup');
function target(args,env=process.env){
 if(args.length!==1||args[0]!=='--project='+PROJECT||env.GITHUB_ACTIONS!=='true'||env.GITHUB_REF!=='refs/heads/main'||!/^\d+$/.test(env.GITHUB_RUN_ID||''))throw Error('Recovery repair requires the reviewed Main workflow and exact project');
 return 'bb-restore-check-'+env.GITHUB_RUN_ID;
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
  const output=`gs://${BUCKET}/recovery-${process.env.GITHUB_RUN_ID}-${Date.now()}`;
  const exported=await waitOperation(request,await request(api+'(default):exportDocuments','POST',{outputUriPrefix:output}));
  const prefix=exported.response?.outputUriPrefix;
  if(!prefix?.startsWith(`gs://${BUCKET}/`))throw Error('Unexpected completed export prefix');
  report.export={completed:true,operation:exported.name,outputUriPrefix:prefix};save();
  if(await request(destination,'GET',null,true))throw Error('Restore-check database already exists; refusing to overwrite it');
  const created=await request(api.slice(0,-1)+'?databaseId='+restoreId,'POST',{locationId:database.locationId,type:'FIRESTORE_NATIVE',deleteProtectionState:'DELETE_PROTECTION_DISABLED'});
  createdHere=true;await waitOperation(request,created);report.steps.push('Created isolated restore-check database');save();
  const imported=await waitOperation(request,await request(destination+':importDocuments','POST',{inputUriPrefix:prefix}));
  // Read only stable configuration and aggregate account count; never emit data.
  const crypto=require('node:crypto');
  const fingerprint=async(base,path)=>{const d=await request(base+'/documents/'+path);return crypto.createHash('sha256').update(JSON.stringify(d.fields||{})).digest('hex');};
  for(const path of ['config/plans','settings/pricing'])if(await fingerprint(api+'(default)',path)!==await fingerprint(destination,path))throw Error('Restored configuration does not match source: '+path);
  async function count(base){const rows=await request(base+'/documents:runAggregationQuery','POST',{structuredAggregationQuery:{structuredQuery:{from:[{collectionId:'users'}]},aggregations:[{alias:'total',count:{}}]}});return Number(rows[0]?.result?.aggregateFields?.total?.integerValue||0);}
  const sourceCount=await count(api+'(default)'),restoreCount=await count(destination);
  if(sourceCount!==restoreCount)throw Error('Account count changed or restore mismatched; review required');
  restored=true;report.restore={completed:true,operation:imported.name,configurationMatches:true,accountCount:restoreCount};save();
  const live=await request(api+'(default)');
  if(live.pointInTimeRecoveryEnablement!=='POINT_IN_TIME_RECOVERY_ENABLED')throw Error('PITR not enabled');
  report.pitr={enabled:true,earliestVersionTime:live.earliestVersionTime,versionRetentionPeriod:live.versionRetentionPeriod};
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
module.exports={target};
