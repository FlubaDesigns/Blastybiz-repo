'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {database,admin}=require('./lib/test-firestore.cjs');
const cadence=require('../functions/lib/email-cadence');
const {createLifecycle}=require('../functions/lib/lifecycle');
const source=fs.readFileSync('functions/lib/shared.js','utf8');
async function run(){
 let now=Date.parse('2027-01-01T23:55Z'),mode='ok',calls=0;
 const m=database();
 const injected={reserve:(db,to)=>cadence.reserve(db,to,now),settle:(db,slot,accepted)=>cadence.settle(db,slot,accepted,now)};
 const ctx={db:m.db,require:()=>injected,readFlubaProviderKey:async()=> 'fixture',console:{error(){},log(){}},fetch:async()=>{calls++;if(mode==='timeout')throw Error('timeout');return {ok:mode==='ok',status:429};}};
 vm.runInNewContext(source.slice(source.indexOf('async function sendResendEmail'),source.indexOf('// ── Lazy-init Square')),ctx);
 const send=(to='Owner@Example.com')=>ctx.sendResendEmail({to,subject:'Fixture',html:'Fixture',dailyLimited:true});
 const results=await Promise.all(Array.from({length:20},(_,i)=>send(i%2?' owner@example.com ':'Owner@Example.com')));
 assert.equal(calls,1);assert.equal(results.filter(r=>r.deferred).length,19);
 now+=10*60000;assert.equal((await send()).deferred,true,'midnight does not reset the rolling window');
 now+=cadence.DAY-10*60000-1;assert.equal((await send()).deferred,true,'24 hours minus one millisecond is blocked');
 now++;assert.equal((await send()).sent,true,'exactly 24 hours permits one new message');
 assert.equal((await send('other@example.com')).sent,true,'different recipients do not block each other');
 mode='reject';await assert.rejects(()=>send('rejected@example.com'),e=>e.providerRejected===true);
 mode='ok';assert.equal((await send('rejected@example.com')).sent,true,'definite rejection leaves send retryable');
 mode='timeout';await assert.rejects(()=>send('uncertain@example.com'),/timeout/);
 mode='ok';assert.equal((await send('uncertain@example.com')).deferred,true,'ambiguous provider result keeps its slot');
 // A delayed completion cannot release another worker's later slot.
 let a=await cadence.reserve(m.db,'late@example.com',now),b=await cadence.reserve(m.db,'late@example.com',now+cadence.DAY);
 await cadence.settle(m.db,a,false,now+cadence.DAY);assert.equal(await cadence.reserve(m.db,'late@example.com',now+cadence.DAY),null);
 await cadence.settle(m.db,b,true,now+cadence.DAY+1000);assert.equal(await cadence.reserve(m.db,'late@example.com',now+2*cadence.DAY),null);
 // Actual lifecycle callers defer across businesses and do not start expiry on an unsent final email.
 const B='users/u/businesses/b',C='users/u/businesses/c',D=B+'/listingDrafts/d',E=C+'/listingDrafts/e';
 for(const [path,value] of Object.entries({'users/u':{email:'lifecycle@example.com'},[B]:{},[C]:{},[D]:{status:'approved',startedAt:new Date(now).toISOString()},[E]:{status:'approved',startedAt:new Date(now).toISOString()},[B+'/publishJobs/j']:{draftId:'d',platform:'craigslist',status:'manual_required'},[C+'/publishJobs/k']:{draftId:'e',platform:'fbmarket',status:'manual_required'}}))await m.db.doc(path).set(value);
 const life=createLifecycle({db:m.db,admin,clock:()=>new Date(now),sendEmail:p=>ctx.sendResendEmail({...p,dailyLimited:true})});
 const config={remindersStartAt:'2027-01-01T00:00:00Z',manualLapseDays:12};
 let start=calls;await Promise.all([life.notify(m.db.doc(D),'ready',config),life.notify(m.db.doc(E),'ready',config)]);assert.equal(calls-start,1,'different businesses share one recipient slot');
 const deferred=m.get(D).reminders?.readySentAt?E:D;
 assert.equal(m.get(deferred).reminders?.readySentAt,undefined,'deferred reminder is not marked sent');
 await m.db.doc(deferred).update({'reminders.firstSentAt':new Date(now-cadence.DAY).toISOString()});
 await life.notify(m.db.doc(deferred),'final',config);assert.equal(m.get(deferred).reminders.finalSentAt,undefined,'deferred final does not start expiration');
 now+=cadence.DAY;await life.notify(m.db.doc(deferred),'final',config);assert.ok(m.get(deferred).reminders.finalSentAt,'deferred final can run on the next day');
 console.log('Email cadence passed: concurrency, shared recipients, 24-hour boundary, failures, stale workers, and lifecycle deferral. No real emails sent.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
