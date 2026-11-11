'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {database,admin:baseAdmin}=require('./lib/test-firestore.cjs');
const {createAiAllowance}=require('../functions/lib/ai-allowance');
const {generatePlatformCopy}=require('../functions/lib/platform-copy');
const admin={firestore:{...baseAdmin.firestore,Timestamp:{fromMillis:stamp=>({stamp})}}};
const fingerprint='a'.repeat(64),request={id:'attempt',fingerprint};
function fixture(seed={}) {
 let now=new Date('2026-11-10T12:00:00Z');const data=database({'users/u':{plan:'starter'},...seed});
 const service=createAiAllowance({db:data.db,admin,getPlanConfig:async()=>({aiLimits:{starter:3}}),clock:()=>now});
 return {data,...service,advance:ms=>{now=new Date(+now+ms);}};
}
test('simultaneous identical requests reserve once; completed result replays',async()=>{
 const f=fixture(),results=await Promise.allSettled([f.reserve('u',{request}),f.reserve('u',{request})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'GENERATION_PENDING');
 assert.equal(f.data.get('users/u').aiActionsUsed,1);const receipt=results.find(r=>r.status==='fulfilled').value;
 await f.settle('u',receipt,{adaptations:{facebook:'Ready'},status:'complete'});
 assert.equal((await f.reserve('u',{request})).result.adaptations.facebook,'Ready');assert.equal(f.data.get('users/u').aiActionsUsed,1);
 await assert.rejects(()=>f.reserve('u',{request:{...request,fingerprint:'b'.repeat(64)}}),e=>e.code==='REQUEST_CONFLICT');
});
test('failed generation returns the reservation exactly once',async()=>{
 const f=fixture(),r=await f.reserve('u',{request});await f.settle('u',r,null);await f.settle('u',r,null);
 assert.equal(f.data.get('users/u').aiActionsUsed,0);await f.reserve('u',{request});assert.equal(f.data.get('users/u').aiActionsUsed,1);
});
test('free rewrite failure restores its grant; unrelated consumption is protected',async()=>{
 const path='users/u/businesses/b/listingDrafts/d',grant=path+'/private/aiAllowance';
 const f=fixture({[path]:{},[grant]:{uid:'u',freeRegenUsed:false}}),r=await f.reserve('u',{request,isRegeneration:true,draftRef:f.data.db.doc(path)});
 assert.equal(r.freeRegen,true);await f.settle('u',r,null);assert.equal(f.data.get(grant).freeRegenUsed,false);
 const next=await f.reserve('u',{request,isRegeneration:true,draftRef:f.data.db.doc(path)});await f.settle('u',r,null);assert.equal(f.data.get(grant).reservationToken,next.token);
});
test('expired lease restores old reservation; stale worker cannot settle replacement',async()=>{
 const f=fixture(),old=await f.reserve('u',{request});f.advance(6*60000);const next=await f.reserve('u',{request});
 assert.equal(f.data.get('users/u').aiActionsUsed,1);assert.equal(await f.settle('u',old,null),false);
 await f.settle('u',next,{status:'complete'});assert.equal(f.data.get('users/u').aiActionsUsed,1);
});
test('refund from previous month cannot decrement current allowance',async()=>{
 const f=fixture(),old=await f.reserve('u',{request});f.advance(32*86400000);
 await f.reserve('u',{request:{id:'new-month',fingerprint}});await f.settle('u',old,null);assert.equal(f.data.get('users/u').aiActionsUsed,1);
});
test('allowance and deletion restrictions remain enforced',async()=>{
 const f=fixture();for(let i=0;i<3;i++)await f.reserve('u',{request:{id:'r'+i,fingerprint}});
 await assert.rejects(()=>f.reserve('u',{request}),/LIMIT_REACHED/);await f.data.db.doc('accountDeletions/u').set({});
 await assert.rejects(()=>f.reserve('u',{request}),e=>e.code==='ACCOUNT_DELETING');
});
const platforms=[{id:'facebook',doc:{maxChars:20}},{id:'instagram',doc:{maxChars:20}}];
test('repair retries only missing/invalid destinations and preserves valid copy',async()=>{
 const calls=[];const result=await generatePlatformCopy({platforms,prompt:'Facts',generate:async p=>{calls.push(p);return {text:JSON.stringify({adaptations:calls.length===1?{facebook:'Good',instagram:42}:{facebook:'Overwrite',instagram:'Repaired'}})};}});
 assert.equal(result.status,'complete');assert.equal(result.adaptations.facebook,'Good');assert.equal(result.adaptations.instagram,'Repaired');assert.match(calls[1],/REPAIR ONLY.*instagram/);
});
test('empty, malformed and overlong output cannot succeed; retry is bounded',async()=>{
 for(const text of ['{}','bad json','{"adaptations":{"facebook":"'+ 'x'.repeat(21)+'"}}']){
 let calls=0;await assert.rejects(()=>generatePlatformCopy({platforms,prompt:'Facts',generate:async()=>{calls++;return {text};}}),e=>e.code==='GENERATION_FAILED');assert.equal(calls,2);
 }
});
test('partial interactive output is explicit; scheduled refresh requires every platform',async()=>{
 const args={platforms,prompt:'Facts',generate:async()=>({text:'{"adaptations":{"facebook":"Good"}}'})};
 const result=await generatePlatformCopy(args);assert.equal(result.status,'partial');assert.deepEqual(result.failedPlatforms,['instagram']);
 await assert.rejects(()=>generatePlatformCopy({...args,requireAll:true}),e=>e.code==='GENERATION_FAILED');
});
test('actual generation handler refunds provider failure and validates response',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),file=require('node:path').resolve('functions/modules/ai.js');
 const source=fs.readFileSync(file,'utf8'),handler=source.slice(source.indexOf('exports.adaptListing ='),source.indexOf('exports.resolveCategories ='));
 const f=fixture();let bad=true,calls=0;
 const c={exports:{},require:require('node:module').createRequire(file),crypto,onRequest:(_,fn)=>fn,withAuth:fn=>fn,db:f.data.db,admin,
   reserveAiAction:f.reserve,settleAiAction:f.settle,platformAuthority:require('../functions/lib/platforms'),PLATFORM_DOCS:{},buildPlatformBlock:()=>'',
   _getAdminPlatformDocs:async()=>({}),_mergeAdminPlatformDoc:b=>b,console:{error(){},warn(){}},loggedAI:async()=>{calls++;if(bad)throw Error('Provider offline');return {text:'{"adaptations":{"facebook":"Ready"}}'};}};
 vm.runInNewContext(handler,c);const run=async()=>{const res={code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}};await c.exports.adaptListing({body:{listing:{name:'Example',offer:'Offer',requestId:'attempt'},platforms:[{id:'facebook'}]}},res,{uid:'u'});return res;};
 assert.equal((await run()).code,502);assert.equal(f.data.get('users/u').aiActionsUsed,0);bad=false;assert.equal((await run()).body.status,'complete');assert.equal(f.data.get('users/u').aiActionsUsed,1);
 const before=calls;assert.equal((await run()).body.adaptations.facebook,'Ready');assert.equal(calls,before);
});

test('initial copy and its free rewrite grant commit together; deleted drafts are not recreated',async()=>{
 const path='users/u/businesses/b/listingDrafts/d',grant=path+'/private/aiAllowance';
 const f=fixture({[path]:{}}),r=await f.reserve('u',{request,draftRef:f.data.db.doc(path)});
 assert.equal(f.data.get(grant),undefined);await f.settle('u',r,{adaptations:{facebook:'Ready'}});
 assert.equal(f.data.get(grant).freeRegenUsed,false);assert.equal((await f.reserve('u',{request})).cached,true);
 const next=await f.reserve('u',{request:{id:'rewrite',fingerprint},draftRef:f.data.db.doc(path),isRegeneration:true});
 await f.data.db.doc(path).delete();f.advance(6*60000);await f.reserve('u',{request:{id:'rewrite',fingerprint}});
 assert.equal(f.data.get(path),undefined);assert.equal(await f.settle('u',next,null),false);
});

test('rewrite direction reaches the real prompt; malformed requests never reserve allowance',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),file=require('node:path').resolve('functions/modules/ai.js'),source=fs.readFileSync(file,'utf8');
 let prompt='',reserved=0;
 const c={exports:{},require:require('node:module').createRequire(file),crypto:require('node:crypto'),onRequest:(_,fn)=>fn,withAuth:fn=>fn,db:fixture().data.db,admin,
  reserveAiAction:async()=>{reserved++;return{};},settleAiAction:async()=>true,platformAuthority:require('../functions/lib/platforms'),PLATFORM_DOCS:{},buildPlatformBlock:()=>'',_getAdminPlatformDocs:async()=>({}),_mergeAdminPlatformDoc:b=>b,console,loggedAI:async(_u,_fn,_body,text)=>{prompt=text;return {text:'{"adaptations":{"facebook":"Valid rewritten copy"}}'};}};
 vm.runInNewContext(source.slice(source.indexOf('exports.adaptListing ='),source.indexOf('exports.resolveCategories =')),c);
 const run=async rewrite=>{const res={code:200,status(n){this.code=n;return this;},json(b){this.body=b;return this;}};await c.exports.adaptListing({body:{listing:{name:'Example',offer:'Weekend offer'},platforms:[{id:'facebook'}],isRegeneration:true,rewrite}},res,{uid:'u'});return res;};
 c.bbLog=()=>{};
 for(const direction of ['Shorter','More local','More upbeat','Keep the price. Mention weekend pickup.']){
  assert.equal((await run({source:'Existing offer $25',direction})).code,200);assert(prompt.includes(direction));assert(prompt.includes('Existing offer $25'));assert.match(prompt,/Never invent a location/);assert.match(prompt,/NAME PRIVACY/);
 }
 const before=reserved;for(const rewrite of [null,[],{source:'copy',direction:''},{source:'copy',direction:'x'.repeat(1001)},{source:42,direction:'Shorter'},{source:'x'.repeat(15001),direction:'Shorter'}])assert.equal((await run(rewrite)).code,400);
 assert.equal(reserved,before);
});
