'use strict';
const assert=require('node:assert/strict');
const {validatePreflight,legacyEnabledSchedules}=require('./retire-legacy-functions.cjs');
const expected=[{name:'oldWorker',expectedUpdateTime:'2026-09-04T00:00:00Z'}];
const fixture=()=>({functions:[{name:'projects/blastybiz-9523e/locations/us-central1/functions/oldWorker',updateTime:expected[0].expectedUpdateTime,serviceConfig:{uri:'https://old-worker.run.app'}}],jobs:[{name:'projects/blastybiz-9523e/locations/us-central1/jobs/firebase-schedule-oldWorker-us-central1',httpTarget:{uri:'https://old-worker.run.app/'}}],data:{advertising:0,blastRuns:0,onboardingDrafts:0,legacyRunJobs:0,legacyEnabledSchedules:0},traffic:{truncated:false,successfulNonOptions:0}});
let assertions=0;
function rejects(mutate,pattern){const state=fixture();mutate(state);assert.throws(()=>validatePreflight(state,expected),pattern);assertions++;}
assert.deepEqual(validatePreflight(fixture(),expected).retired,['oldWorker']);assertions++;
rejects(s=>s.functions[0].updateTime='changed',/Candidate changed/);
for(const key of Object.keys(fixture().data)){
 rejects(s=>s.data[key]=1,/Legacy data dependency/);
 rejects(s=>delete s.data[key],/Legacy data dependency/);
}
rejects(s=>s.traffic.successfulNonOptions=1,/caller traffic/);
rejects(s=>s.traffic.truncated=true,/evidence incomplete/);
rejects(s=>delete s.traffic.truncated,/evidence incomplete/);
rejects(s=>s.jobs[0].httpTarget.uri='https://current-worker.run.app',/target does not match/);
rejects(s=>s.jobs[0].name='projects/blastybiz-9523e/locations/us-central1/jobs/current-worker',/Unexpected scheduler/);
const canonical=fixture();canonical.jobs[0].httpTarget.uri='https://us-central1-blastybiz-9523e.cloudfunctions.net/oldWorker';
assert.deepEqual(validatePreflight(canonical,expected).retired,['oldWorker']);assertions++;
rejects(s=>s.jobs[0].httpTarget.uri='https://us-central1-other-project.cloudfunctions.net/oldWorker',/target does not match/);
rejects(s=>s.jobs[0].httpTarget.uri='https://us-central1-blastybiz-9523e.cloudfunctions.net/currentWorker',/target does not match/);
rejects(s=>delete s.jobs[0].httpTarget.uri,/target does not match/);
rejects(s=>{s.functions=[];s.jobs[0].httpTarget.uri='https://current-worker.run.app';},/target does not match/);
const retry=fixture();retry.functions=[];retry.jobs=[];
assert.deepEqual(validatePreflight(retry,expected),{retired:['oldWorker'],jobs:[]});assertions++;
assert.equal(legacyEnabledSchedules([{schedule:{enabled:true},scheduleAdPath:'users/u/businesses/b/campaigns/c/ads/a'},{schedule:{enabled:true}},{schedule:{enabled:false}},{}]),1);assertions++;

// Execute the actual CLI control flow with isolated cloud responses. An empty
// retirement must not touch ownership, Firestore, logs, or any DELETE endpoint.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const manifest=require('../deployment/retired-functions.json');
const candidate=manifest.functions[0];
const functionName=name=>'projects/blastybiz-9523e/locations/us-central1/functions/'+name;
function harness({functions=[{name:functionName('futureEndpoint'),state:'DEPLOYING'}],jobs=[],functionPage,schedulerPage,allowData=false,drafts=[],env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',RELEASE_SHA:'a'.repeat(40)}}={}){
 const calls=[],reports=[],messages=[],selections=[];let ownershipReads=0,terminated=false;
 const query=collection=>({
  select(...fields){
   selections.push({collection,fields});
   return {limit:()=>({get:async()=>{
    const rows=collection==='listingDrafts'?drafts:[];
    return {size:rows.length,docs:rows.map(data=>({data:()=>data}))};
   }})};
  }
 });
 const db={projectId:'blastybiz-9523e',initializeIfNeeded:async()=>{},collectionGroup:query,collection:query,terminate:async()=>{terminated=true;}};
 const ctx={module:{exports:{}},console:{log:x=>messages.push(x)},process:{env,cwd:()=>'/fixture'},Date,AbortSignal,setTimeout,
  require(name){
   if(name==='node:fs')return {writeFileSync:(p,text)=>reports.push(JSON.parse(text))};
   if(name==='node:path')return path;
   if(name==='node:child_process')return {execFileSync:()=> 'fixture-token'};
   if(name==='../deployment/retired-functions.json')return manifest;
   if(name==='./check-backend-ownership.cjs')return {inventory:()=>{ownershipReads++;if(!allowData)throw Error('Ownership should not be read');return {functions:[]};}};
   if(name==='../functions/node_modules/firebase-admin'){if(!allowData)throw Error('Firestore should not be initialized');return {initializeApp(){},firestore:()=>db};}
   throw Error('Unexpected module: '+name);
  },
  async fetch(url,options){
   calls.push({url,method:options.method});assert.equal(options.method==='GET'||url==='https://logging.googleapis.com/v2/entries:list',true,'no deletion/write requests in fixtures');
   if(url.includes('/functions?pageSize='))return {ok:true,status:200,json:async()=>({functions,nextPageToken:functionPage})};
   if(url.includes('/jobs?pageSize='))return {ok:true,status:200,json:async()=>({jobs,nextPageToken:schedulerPage})};
   if(url==='https://logging.googleapis.com/v2/entries:list'&&allowData)return {ok:true,status:200,json:async()=>({entries:[]})};
   throw Error('Unexpected cloud request: '+url);
  }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'retire-legacy-functions.cjs'),'utf8'),ctx);
 return {run:ctx.module.exports.run,calls,reports,messages,selections,get ownershipReads(){return ownershipReads;},get terminated(){return terminated;}};
}
async function controlFlow(){
 for(const apply of [false,true]){
  const h=harness(),r=await h.run(['--project=blastybiz-9523e',...(apply?['--apply']:[])]);
  assert.equal(r.nothingToRetire,true);assertions++;
  assert.equal(h.ownershipReads,0);assertions++;
  assert.equal(h.calls.length,2);assertions++;
  assert.equal(h.calls.every(c=>c.method==='GET'),true);assertions++;
  assert.equal(h.messages.includes('Nothing to retire'),true);assertions++;
  assert.equal(h.reports[0].apply,apply);assertions++;
 }
 for(const [opts,message]of [[{functionPage:'more'},/Function inventory truncated/],[{schedulerPage:'more'},/Scheduler inventory truncated/]]){
  const h=harness(opts);await assert.rejects(()=>h.run(['--project=blastybiz-9523e']),message);assertions++;
  assert.equal(h.reports.length,0);assertions++;
 }
 const unauthorized=harness({env:{GITHUB_REF:'refs/heads/preview'}});
 await assert.rejects(()=>unauthorized.run(['--project=blastybiz-9523e','--apply']),/verified Main/);assertions++;
 assert.equal(unauthorized.calls.length,0);assertions++;
 for(const opts of [
  {functions:[{name:functionName(candidate.name),updateTime:candidate.expectedUpdateTime}]},
  {functions:[],jobs:[{name:'projects/blastybiz-9523e/locations/us-central1/jobs/firebase-schedule-'+candidate.name+'-us-central1'}]}
 ]){
  const h=harness(opts);await assert.rejects(()=>h.run(['--project=blastybiz-9523e']),/Ownership should not be read/);assertions++;
  assert.equal(h.messages.includes('Nothing to retire'),false);assertions++;
 }
 const present=[{name:functionName(candidate.name),updateTime:candidate.expectedUpdateTime}];
 const modern=harness({functions:present,allowData:true,drafts:[{schedule:{enabled:true},scheduleAdPath:'users/u/businesses/b/campaigns/c/ads/a'}]});
 const result=await modern.run(['--project=blastybiz-9523e']);
 assert.equal(result.data.legacyEnabledSchedules,0);assertions++;
 assert.equal(modern.selections.find(s=>s.collection==='listingDrafts').fields.includes('scheduleAdPath'),true);assertions++;
 assert.equal(modern.terminated,true);assertions++;
 const legacy=harness({functions:present,allowData:true,drafts:[{schedule:{enabled:true}}]});
 await assert.rejects(()=>legacy.run(['--project=blastybiz-9523e']),/Legacy data dependency/);assertions++;
 console.log(`Retirement guard checks: ${assertions} passed; no network or data writes.`);
}
controlFlow().catch(e=>{console.error(e);process.exitCode=1;});
