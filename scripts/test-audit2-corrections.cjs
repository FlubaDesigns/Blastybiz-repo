'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const {database,admin}=require('./lib/test-firestore.cjs');
const {sameConnection}=require('../functions/lib/connection-state');
const {createOAuthSelection}=require('../functions/lib/oauth-selection');
const {metaRevokeToken,revokeMeta}=require('../functions/lib/meta-revoke');
const B='users/u/businesses/b',C=B+'/platformConnections/',future=()=>new Date(Date.now()+6*86400000);
let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const quiet={log(){},warn(){},error(){}};
function load(file,shared,extras={}) {
 const filename=path.resolve(file),req=createRequire(filename),exports={};
 const c={exports,module:{exports},require:p=>p==='../lib/shared'?shared:req(p),console:quiet,process:{env:{}},Date,URLSearchParams,Buffer,fetch:async()=>({ok:true}),setTimeout,...extras};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),c,{filename});return c;
}
function fixture(seed={},axios={get:async()=>{throw Error('Graph unavailable');},post:async()=>{throw Error('Google unavailable');}}) {
 const m=database({'users/u':{email:'owner@example.com'},'users/victim':{email:'victim@example.com'},[B]:{businessName:'Owner business'},...seed}),emails=[];
 m.db.getAll=(...refs)=>Promise.all(refs.map(r=>r.get()));
 const shared={db:m.db,admin,axios,onRequest:(...a)=>a.at(-1),onSchedule:(...a)=>a.at(-1),onDocumentCreated:(...a)=>a.at(-1),onDocumentUpdated:(...a)=>a.at(-1),withAuth:f=>f,setCors(){},verifyBearer:async()=>({uid:'u'}),_getConnTokens:async r=>(await r.collection('private').doc('tokens').get()).data()||{},userBizRef:(u,b)=>m.db.doc(`users/${u}/businesses/${b}`),userBizConnsRef:(u,b)=>m.db.collection(`users/${u}/businesses/${b}/platformConnections`),sendResendEmail:async e=>emails.push(e),makeUnsubSig:()=>'',_unsubSecret:()=>'',APP_BASE_URL:'https://example.com'};
 return {...m,shared,emails,worker:()=>load('functions/modules/oauth.js',shared).exports.checkPlatformTokenExpiry()};
}
const google={status:'connected',accountId:'account-old',locationId:'location-old',connectedAt:{stamp:1},expiresAt:new Date(0)};
const facebook={status:'connected',pageId:'page',connectedAt:{stamp:1},expiresAt:new Date(0)};
async function races(){
 ok(!sameConnection({connectedAt:{seconds:1,nanoseconds:1}},{status:'connected',connectedAt:{seconds:1,nanoseconds:2}}),'guard preserves full Timestamp precision');
 for(const provider of ['google','facebook'])for(const failed of [false,true]) {
  const original=provider==='google'?google:facebook,p=C+provider;
  const f=fixture({[p]:original,[p+'/private/tokens']:{accessToken:'old',refreshToken:'old-refresh',userAccessToken:'old-user'}});
  const reconnect=async()=>{await f.db.doc(p).set({...original,...(provider==='google'?{accountId:'new-account',locationId:'new-location'}:{}),connectedAt:{stamp:2},expiresAt:future()});await f.db.doc(p+'/private/tokens').set({accessToken:'fresh',refreshToken:'fresh-refresh',userAccessToken:'fresh-user'});if(failed)throw Error('provider failed after reconnect');return {data:{access_token:'stale-refresh',expires_in:3600}};};
  f.shared.axios=provider==='google'?{post:reconnect}:{get:async url=>url.endsWith('access_token')?reconnect():{data:{id:'page',access_token:'stale-page'}}};
  await f.worker();
  ok(f.get(p+'/private/tokens').accessToken==='fresh'&&f.get(p).connectedAt.stamp===2,provider+' reconnect wins over stale '+(failed?'failed':'successful')+' refresh');
  ok(f.get(p).status==='connected'&&f.emails.length===0,provider+' reconnect not expired/notified by stale sweep');
 }
 for(const disconnect of [false,true]) {
  const f=fixture({[C+'google']:google,[C+'google/private/tokens']:{accessToken:'old',refreshToken:'old-refresh'}}),calls=[];
  f.shared.axios={post:async(url,data,config)=>{
   calls.push({url,config});
   if(url.includes('/token')){await f.db.doc(C+'google').set({...google,connectedAt:{stamp:2},accountId:'new-account',locationId:'new-location',status:disconnect?'disconnected':'connected'});await f.db.doc(C+'google/private/tokens').set({accessToken:'fresh',refreshToken:'fresh-refresh'});return {data:{access_token:'stale'}};}
   if(calls.length===1)throw Object.assign(Error('unauthorized'),{response:{status:401}});
   return {data:{name:'posted'}};
  }};
  const publish=load('functions/modules/publishing.js',f.shared).module.exports._publishGoogleJob;
  const run=()=>publish({}, {...google,accessToken:'old',refreshToken:'old-refresh'},'u','b');
  if(disconnect){await assert.rejects(run(),/connection changed/);checks++;ok(calls.filter(c=>c.url.includes('localPosts')).length===1,'disconnect during refresh prevents retry');}
  else{await run();ok(calls.at(-1).url.includes('/accounts/new-account/locations/new-location/')&&calls.at(-1).config.headers.Authorization==='Bearer fresh','401 retry uses fresh location and its matching token once');}
  ok(f.get(C+'google/private/tokens').refreshToken==='fresh-refresh'&&f.get(C+'google/private/tokens').accessToken==='fresh','401 retry never overwrites fresh credentials');
 }
}
async function expiryAndIdentity(){
 for(const legacy of [true,false])for(const expired of [false,true]){
  const when=expired?new Date(0):future();
  const f=fixture({[C+'facebook']:{...facebook,expiresAt:when},[C+'instagram']:{status:'connected',pageId:'page',igUserId:'ig',connectedAt:{stamp:1},expiresAt:when},[C+'facebook/private/tokens']:{accessToken:'page',...(legacy?{}:{userAccessToken:'user'})}});
  await f.worker();
  ok(f.get(C+'facebook').status===(expired?'expired':'connected')&&f.get(C+'instagram').status===(expired?'expired':'connected'),(legacy?'legacy':'Graph error')+' respects actual expiry for both providers');
  ok(expired?f.emails.length===2:f.emails.length===0,'expiry emails occur only at actual expiry');
 }
 const f=fixture({[C+'google']:{...google,uid:'victim',businessId:'victim-business',platform:'facebook'},[C+'google/private/tokens']:{refreshToken:'google-refresh'}}),calls=[];
 f.shared.axios={post:async url=>{calls.push(url);throw Error('unavailable');},get:async()=>{throw Error('Google credential must never reach Meta');}};
 await f.worker();ok(calls.length===1&&calls[0]==='https://oauth2.googleapis.com/token','path provider overrides forged platform field');
 ok(f.emails.length===1&&f.emails[0].to==='owner@example.com'&&f.emails[0].html.includes('Owner business'),'expiry owner/business derived from path, never editable identity fields');
 const early=fixture({[C+'google']:{...google,expiresAt:new Date(Date.now()+120000)},[C+'google/private/tokens']:{refreshToken:'old'}});await early.worker();ok(early.get(C+'google').status==='connected'&&!early.emails.length,'failed proactive Google refresh also retains still-valid grant');
}
async function cancelTests(){
 const f=fixture(),worker=createOAuthSelection({db:f.db,admin,axios:{get:async()=>({data:{id:'page'}})}});
 const prepare=()=>worker.prepare({uid:'u',businessId:'b',platform:'facebook',choices:[{id:'page',pageId:'page',label:'Page',accessToken:'secret'}],userAccessToken:'user',tokenExpiresAt:future()});
 let id=await prepare();await assert.rejects(()=>worker.cancel(id,'other'),/another account/);checks++;ok(f.get('oauthNonces/'+id),'other owner cannot cancel');
 f.failNext();await assert.rejects(()=>worker.cancel(id,'u'),/offline/);checks++;ok(f.get('oauthNonces/'+id),'failed cancellation remains retryable');
 await worker.cancel(id,'u');ok(!f.get('oauthNonces/'+id),'cancel immediately removes all pending provider credentials');
 ok((await worker.cancel(id,'u')).cancelled,'cancel retry is idempotent');
 await assert.rejects(()=>worker.confirm(id,'u','page'),/expired/);checks++;
 id=await prepare();await f.db.doc('oauthNonces/'+id).update({expiresAt:new Date(0)});await worker.cancel(id,'u');ok(!f.get('oauthNonces/'+id),'expired pending credentials can be explicitly discarded');
 id=await prepare();const endpoint=load('functions/modules/oauth.js',f.shared).exports.oauthDestination,r={status(n){this.code=n;return this;},json(data){this.body=data;return this;}};await endpoint({method:'POST',body:{selection:id,cancel:true}},r,{uid:'u'});ok(r.body.cancelled&&!f.get('oauthNonces/'+id),'actual authenticated endpoint routes cancellation');
}
async function revocationTests(){
 for(const platform of ['facebook','instagram'])for(const userToken of [true,false]){
  const f=fixture({[C+'facebook']:facebook,[C+'instagram']:{status:'connected',igUserId:'ig'},[C+'facebook/private/tokens']:{accessToken:'fb-page',...(userToken?{userAccessToken:'fb-user'}:{})},[C+'instagram/private/tokens']:{accessToken:'ig-page'}}),calls=[],warnings=[];
  const c=load('functions/modules/oauth.js',f.shared,{fetch:async(url,o)=>{calls.push({url,o});return {ok:false,status:503};},console:{...quiet,warn:m=>warnings.push(m)}});
  const r={set(){},status(n){this.code=n;return this;},json(d){this.body=d;return this;}};await c.exports.disconnectPlatform({method:'POST',body:{bizId:'b',platformId:platform}},r);
  const expected=userToken?'fb-user':platform==='facebook'?'fb-page':'ig-page';
  ok(new URL(calls[0].url).searchParams.get('access_token')===expected,platform+' revoke chooses '+(userToken?'user grant':'legacy fallback'));
  ok(warnings.length===1&&warnings[0].includes('503')&&!warnings[0].includes(expected),'provider rejection logged without credentials');
  ok(r.body.ok&&!f.get(C+'facebook/private/tokens')&&!f.get(C+'instagram/private/tokens'),'disconnect clears both local credentials after revocation attempt');
 }
 // Actual purge function, with isolated Firestore/Storage and provider boundary.
 const f=fixture({[C+'facebook']:facebook,[C+'instagram']:{},[C+'facebook/private/tokens']:{accessToken:'page',userAccessToken:'user-grant'},[C+'instagram/private/tokens']:{accessToken:'ig-page'}}),calls=[],warnings=[];
 const code=fs.readFileSync('functions/lib/shared.js','utf8');
 const c={...f.shared,metaRevokeToken,revokeMeta,console:{...quiet,warn:m=>warnings.push(m)},fetch:async url=>{calls.push(url);return {ok:false,status:403};},admin:{storage:()=>({bucket:()=>({deleteFiles:async()=>{}})})}};
 c.userBizCol=u=>f.db.collection('users/'+u+'/businesses');for(const [name,collection]of [['userBizDraftsRef','listingDrafts'],['userBizJobsRef','publishJobs'],['userBizPostsRef','pendingPosts']])c[name]=(u,b)=>f.db.collection(`users/${u}/businesses/${b}/${collection}`);
 vm.runInNewContext(code.slice(code.indexOf('async function purgeUserData'),code.indexOf('\nmodule.exports =')),c);
 await c.purgeUserData('u',{cancelSubscription:false,deleteAuthUser:false});
 ok(calls.length===2&&calls.every(url=>new URL(url).searchParams.get('access_token')==='user-grant'),'purge uses user grant for Facebook and paired Instagram');
 ok(warnings.length===2,'purge also exposes non-2xx revoke failures');
}
(async()=>{for(const test of [races,expiryAndIdentity,cancelTests,revocationTests]){await test();console.log('PASS '+test.name);}console.log(checks+' Audit 2 correction assertions passed.');})().catch(e=>{console.error(e);process.exitCode=1;});
