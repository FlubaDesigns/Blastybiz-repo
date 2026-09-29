'use strict';
// Explicit, version-pinned retirement. No Firestore/Storage/customer-data writes.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const manifest=require('../deployment/retired-functions.json');
const {inventory}=require('./check-backend-ownership.cjs');
const PROJECT='blastybiz-9523e',REGION='us-central1';
const base=`projects/${PROJECT}/locations/${REGION}`;
function legacyEnabledSchedules(drafts){
 return drafts.filter(d=>d.schedule?.enabled&&!d.scheduleAdPath).length;
}
function validatePreflight({functions,jobs,data,traffic},expected=manifest.functions){
 if(manifest.project!==PROJECT||manifest.region!==REGION)throw Error('Retirement target mismatch');
 const retired=new Set(expected.map(x=>x.name));
 for(const item of expected){
  const fn=functions.find(f=>f.name.endsWith('/'+item.name));
  if(fn&&fn.updateTime!==item.expectedUpdateTime)throw Error('Candidate changed since blast-radius review: '+item.name);
 }
 if(['advertising','blastRuns','onboardingDrafts','legacyRunJobs','legacyEnabledSchedules'].some(k=>data[k]!==0))throw Error('Legacy data dependency appeared; migration review required');
 if(traffic.truncated!==false||traffic.successfulNonOptions!==0)throw Error('Successful caller traffic found or traffic evidence incomplete');
 for(const job of jobs){
  const name=job.name.split('/').at(-1),candidate=expected.find(f=>name===`firebase-schedule-${f.name}-${REGION}`);
  if(!candidate)throw Error('Unexpected scheduler selected for retirement');
  const fn=functions.find(f=>f.name.endsWith('/'+candidate.name));
  // Firebase may target either the Cloud Run URI or this function's canonical
  // cloudfunctions.net URI. Match exact resource URLs; no hostname-only checks.
  const target=job.httpTarget?.uri?.replace(/\/$/,'');
  const allowed=[fn?.serviceConfig?.uri,`https://${REGION}-${PROJECT}.cloudfunctions.net/${candidate.name}`].filter(Boolean).map(uri=>uri.replace(/\/$/,''));
  if(!target||!allowed.includes(target))throw Error('Scheduler target does not match candidate: '+name+' ('+(target||'missing')+')');
 }
 return {retired:[...retired],jobs:jobs.map(j=>j.name)};
}
async function run(args){
 if(args.some(a=>!['--project='+PROJECT,'--apply'].includes(a))||args.filter(a=>a==='--project='+PROJECT).length!==1)throw Error('Use --project='+PROJECT+' [--apply]');
 const apply=args.includes('--apply');
 if(apply&&(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(process.env.RELEASE_SHA||'')))throw Error('Retirement applies only through the verified Main release workflow');
 if(manifest.project!==PROJECT||manifest.region!==REGION)throw Error('Retirement target mismatch');
 const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8'}).trim();
 async function request(url,method='GET',body){
  const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  if(r.status===404&&method==='DELETE')return {};
  if(!r.ok)throw Error('Cloud operation failed: '+method+' '+new URL(url).pathname+' HTTP '+r.status);
  return r.status===204?{}:r.json();
 }
 const all=await request('https://cloudfunctions.googleapis.com/v2/'+base+'/functions?pageSize=100');
 if(all.nextPageToken)throw Error('Function inventory truncated');
 const functions=all.functions||[],retired=new Set(manifest.functions.map(x=>x.name));
 const schedules=await request('https://cloudscheduler.googleapis.com/v1/'+base+'/jobs?pageSize=100');
 if(schedules.nextPageToken)throw Error('Scheduler inventory truncated');
 const jobNames=new Set(manifest.functions.map(f=>`firebase-schedule-${f.name}-${REGION}`));
 const jobs=(schedules.jobs||[]).filter(j=>jobNames.has(j.name.split('/').at(-1)));
 if(!functions.some(f=>retired.has(f.name.split('/').at(-1)))&&!jobs.length){
  const report={source:process.env.RELEASE_SHA||null,checkedAt:new Date().toISOString(),apply,nothingToRetire:true,verified:true,candidates:[...retired],schedulerJobs:[],deleted:[]};
  fs.writeFileSync(path.join(process.cwd(),'blastybiz-retirement.json'),JSON.stringify(report,null,2));
  console.log('Nothing to retire');return report;
 }
 const owned=inventory(),active=functions.filter(f=>!retired.has(f.name.split('/').at(-1)));
 if(active.some(f=>f.state!=='ACTIVE')||JSON.stringify(active.map(f=>f.name.split('/').at(-1)).sort())!==JSON.stringify(owned.functions.map(f=>f.name).sort()))throw Error('Active backend does not match the reviewed source inventory');
 const admin=require('../functions/node_modules/firebase-admin');
 admin.initializeApp({projectId:PROJECT});const db=admin.firestore();
 try{
 await db.initializeIfNeeded();if(db.projectId!==PROJECT)throw Error('Firestore target mismatch');
 async function selected(collection,fields,group=false){const q=group?db.collectionGroup(collection):db.collection(collection);const r=await q.select(...fields).limit(1001).get();if(r.size>1000)throw Error('Data inventory truncated: '+collection);return r.docs.map(d=>d.data());}
 const [ads,runs,onboarding,history,drafts]=await Promise.all([selected('advertising',['status'],true),selected('blastRuns',['state'],true),selected('onboardingDrafts',['expiresAt']),selected('publishJobs',['runId'],true),selected('listingDrafts',['schedule.enabled','scheduleAdPath'],true)]);
 const data={advertising:ads.length,blastRuns:runs.length,onboardingDrafts:onboarding.length,legacyRunJobs:history.filter(j=>j.runId).length,legacyEnabledSchedules:legacyEnabledSchedules(drafts)};
 const since=new Date(Date.now()-7*86400000).toISOString();
 const filter='resource.type="cloud_run_revision" AND ('+[...retired].map(n=>'resource.labels.service_name="'+n.toLowerCase()+'"').join(' OR ')+') AND httpRequest.status < 400 AND httpRequest.requestMethod != "OPTIONS" AND timestamp >= "'+since+'"';
 const logs=await request('https://logging.googleapis.com/v2/entries:list','POST',{resourceNames:['projects/'+PROJECT],filter,orderBy:'timestamp desc',pageSize:1});
 const traffic={since,successfulNonOptions:(logs.entries||[]).length,truncated:!!logs.nextPageToken};
 const decision=validatePreflight({functions,jobs,data,traffic});
 const report={source:process.env.RELEASE_SHA||null,checkedAt:new Date().toISOString(),apply,data,traffic,expectedRemaining:owned.functions.length,candidates:decision.retired,schedulerJobs:decision.jobs,deleted:[]};
 const save=()=>fs.writeFileSync(path.join(process.cwd(),'blastybiz-retirement.json'),JSON.stringify(report,null,2));save();
 console.log(JSON.stringify({...report,deleted:undefined}));
 if(!apply)return report;
 try{
  // All checks complete before the first mutation. Stop the old schedule first.
  for(const job of jobs)await request('https://cloudscheduler.googleapis.com/v1/'+job.name,'DELETE');
  const pending=functions.filter(f=>retired.has(f.name.split('/').at(-1)));
  for(let i=0;i<pending.length;i+=4)await Promise.all(pending.slice(i,i+4).map(async fn=>{
   const op=await request('https://cloudfunctions.googleapis.com/v2/'+fn.name,'DELETE');
   if(op.name){
    if(!op.name.startsWith(base+'/operations/'))throw Error('Unexpected operation target');
    let current=op;const deadline=Date.now()+8*60000;
    while(!current.done){if(Date.now()>deadline)throw Error('Deletion still pending: '+fn.name);await new Promise(r=>setTimeout(r,4000));current=await request('https://cloudfunctions.googleapis.com/v2/'+op.name);}
    if(current.error)throw Error('Function retirement failed: '+fn.name+' '+current.error.code);
   }
   report.deleted.push(fn.name.split('/').at(-1));save();console.log('Retired '+fn.name.split('/').at(-1));
  }));
  const after=await request('https://cloudfunctions.googleapis.com/v2/'+base+'/functions?pageSize=100');
  if(after.nextPageToken||(after.functions||[]).some(f=>retired.has(f.name.split('/').at(-1))))throw Error('Retired function remains deployed');
  const actual=(after.functions||[]).map(f=>f.name.split('/').at(-1)).sort();
  if(JSON.stringify(actual)!==JSON.stringify(owned.functions.map(f=>f.name).sort())||(after.functions||[]).some(f=>f.state!=='ACTIVE'))throw Error('Final backend inventory differs from reviewed active source');
  const remainingJobs=await request('https://cloudscheduler.googleapis.com/v1/'+base+'/jobs?pageSize=100');
  if(remainingJobs.nextPageToken||(remainingJobs.jobs||[]).some(j=>jobNames.has(j.name.split('/').at(-1))))throw Error('Retired schedule remains');
  report.verified=true;report.remainingFunctions=actual;report.completedAt=new Date().toISOString();save();
  console.log('Verified '+actual.length+' active functions; retired names and schedules absent.');return report;
 }catch(e){report.error=e.message;save();throw e;}
 }finally{await db.terminate();}
}
if(require.main===module)run(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={validatePreflight,legacyEnabledSchedules,run};
