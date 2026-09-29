'use strict';
const assert=require('node:assert/strict');
const {verifyScheduledBackup}=require('./verify-backend-repairs.cjs');
const operation='projects/blastybiz-9523e/databases/(default)/operations/test';
const outputUriPrefix='gs://blastybiz-firestore-backups/test';
const record=(status,version=1,extra={})=>({exists:true,updateTime:{seconds:1,nanoseconds:version},data:()=>({status,operation,outputUriPrefix,serviceAccount:'firestore-backup@blastybiz-9523e.iam.gserviceaccount.com',...extra})});
const absent={exists:false,data:()=>undefined};
let checks=0;
async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
function fixture({before=record('failed'),polls=[],start='2026-09-29T12:00:00Z',nextBefore=absent,invokeError,readError}={}){
 let time=Date.parse(start),invoked=false,index=0;
 const reads=[],sleeps=[];
 const args={
  clock:()=>time,timeoutMs:20000,
  read:async date=>{
   reads.push({date,invoked});
   if(!invoked)return date===start.slice(0,10)?before:nextBefore;
   if(readError)throw Error(readError);
   return polls[Math.min(index++,polls.length-1)]||absent;
  },
  invoke:async()=>{assert.equal(reads.length,2);if(invokeError)throw Error(invokeError);invoked=true;},
  sleep:async ms=>{sleeps.push(ms);time+=ms;}
 };
 return {args,reads,sleeps};
}
(async()=>{
 await test('stale failed record survives several polls before running and completion',async()=>{
  const f=fixture({polls:[record('failed'),record('failed'),record('running',2),record('completed',3)]});
  const r=await verifyScheduledBackup(f.args);
  assert.equal(r.completed,true);assert.equal(r.ignoredStaleFailures,2);
  assert.equal(r.evidence,'completion-observed-after-dispatch');assert.equal(f.sleeps.length,3);
 });
 await test('fresh failure rejects even when error, status and operation are unchanged',async()=>{
  const f=fixture({polls:[record('failed',1,{lastError:'denied'}),record('failed',2,{lastError:'denied'})]});
  await assert.rejects(()=>verifyScheduledBackup(f.args),/Scheduled backup failed: denied/);assert.equal(f.sleeps.length,1);
 });
 await test('fresh failure after running rejects',async()=>{
  const f=fixture({polls:[record('running',2),record('failed',3,{lastError:'export error'})]});
  await assert.rejects(()=>verifyScheduledBackup(f.args),/export error/);
 });
 await test('unchanged failure times out instead of passing or failing immediately',async()=>{
  const f=fixture({polls:[record('failed')]});
  await assert.rejects(()=>verifyScheduledBackup(f.args),/before timeout/);assert.equal(f.sleeps.length,4);
 });
 await test('missing result times out',async()=>{
  const f=fixture({before:absent});await assert.rejects(()=>verifyScheduledBackup(f.args),/before timeout/);
 });
 await test('pending operation times out',async()=>{
  const f=fixture({before:record('running'),polls:[record('running')]});await assert.rejects(()=>verifyScheduledBackup(f.args),/before timeout/);
 });
 await test('new record completes without needing to observe running',async()=>{
  const f=fixture({before:absent,polls:[record('completed')]});
  assert.equal((await verifyScheduledBackup(f.args)).evidence,'completion-observed-after-dispatch');
 });
 await test('new failed record rejects when no prior record existed',async()=>{
  const f=fixture({before:absent,polls:[record('failed',1,{lastError:'new failure'})]});
  await assert.rejects(()=>verifyScheduledBackup(f.args),/new failure/);
 });
 await test('already completed daily backup is explicitly reported as reused',async()=>{
  const f=fixture({before:record('completed'),polls:[record('completed')]});
  assert.equal((await verifyScheduledBackup(f.args)).evidence,'existing-completed-daily-backup');assert.equal(f.sleeps.length,0);
 });
 await test('UTC midnight follows the new daily document',async()=>{
  const f=fixture({start:'2026-09-29T23:59:59Z',polls:[record('failed'),record('completed',2)]});
  const r=await verifyScheduledBackup(f.args);assert.equal(r.date,'2026-09-30');
  assert.deepEqual(f.reads.map(r=>r.date),['2026-09-29','2026-09-30','2026-09-29','2026-09-30']);
 });
 await test('midnight failure is compared to its own baseline',async()=>{
  const f=fixture({start:'2026-09-29T23:59:59Z',nextBefore:record('failed',7),polls:[record('failed'),record('failed',7),record('completed',8)]});
  assert.equal((await verifyScheduledBackup(f.args)).ignoredStaleFailures,2);
 });
 await test('Scheduler rejection is not hidden by an old completed backup',async()=>{
  const f=fixture({before:record('completed'),invokeError:'Scheduler HTTP 403'});
  await assert.rejects(()=>verifyScheduledBackup(f.args),/Scheduler HTTP 403/);assert.equal(f.reads.length,2);
 });
 await test('Firestore read errors remain failures',async()=>{
  const f=fixture({readError:'read denied'});await assert.rejects(()=>verifyScheduledBackup(f.args),/read denied/);
 });
 await test('missing server revision fails closed before dispatch',async()=>{
  const f=fixture({before:{exists:true,data:()=>({status:'failed'})}});
  await assert.rejects(()=>verifyScheduledBackup(f.args),/revision unavailable/);assert.equal(f.reads.length,1);
 });
 await test('completed export from another project is rejected',async()=>{
  const f=fixture({polls:[record('completed',2,{operation:'projects/other/databases/(default)/operations/test'})]});
  await assert.rejects(()=>verifyScheduledBackup(f.args),/Unexpected completed backup target/);
 });
 await test('completed export to another bucket is rejected',async()=>{
  const f=fixture({polls:[record('completed',2,{outputUriPrefix:'gs://other/test'})]});
  await assert.rejects(()=>verifyScheduledBackup(f.args),/Unexpected completed backup target/);
 });
 await test('old shared-runtime completion waits for the dedicated export',async()=>{
  const old=record('completed',1,{serviceAccount:undefined});
  const f=fixture({before:old,polls:[old,record('running',2),record('completed',3)]});
  assert.equal((await verifyScheduledBackup(f.args)).evidence,'completion-observed-after-dispatch');assert.equal(f.sleeps.length,2);
 });
 await test('old runtime completion alone cannot pass identity verification',async()=>{
  const old=record('completed',1,{serviceAccount:undefined});
  const f=fixture({before:old,polls:[old]});await assert.rejects(()=>verifyScheduledBackup(f.args),/before timeout/);
 });
 console.log(checks+' backup verification scenarios passed; actual verifier, fake clock and providers, no live writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
