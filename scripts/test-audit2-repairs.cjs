'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const {database,admin:baseAdmin}=require('./lib/test-firestore.cjs');
const admin={firestore:{...baseAdmin.firestore,Timestamp:{fromMillis:stamp=>Object.defineProperty({stamp},'toMillis',{value:()=>stamp})}}};
const {createOAuthSelection}=require('../functions/lib/oauth-selection');
const api=require('../functions/lib/provider-api');
const quiet={log(){},error(){},warn(){}};
let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};
async function rejects(fn,pattern){await assert.rejects(fn,pattern);checks++;}
function load(file,shared,extras={}){
 const filename=path.resolve(file),req=createRequire(filename),exports={};
 const c={exports,module:{exports},require:p=>p==='../lib/shared'?shared:req(p),console:quiet,process:{env:{}},URLSearchParams,Buffer,Date,fetch:async()=>({ok:true}),setTimeout,...extras};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),c,{filename});return c;
}
const response=()=>({code:200,set(){return this;},status(n){this.code=n;return this;},json(x){this.body=x;return this;},send(x){this.body=x;return this;},redirect(url){this.url=url;return this;}});
const B='users/u/businesses/b',C=B+'/platformConnections/';
async function oauthTests(){
 const m=database({[B]:{},[C+'facebook']:{status:'connected',pageId:'old'},[C+'instagram']:{status:'connected',igUserId:'old-ig'},[C+'instagram/private/tokens']:{accessToken:'old-token'}}),requests=[];
 let ig='',failed=false;
 const axios={get:async(url,o)=>{requests.push({url,o});if(failed)throw Error('provider down');
  if(url.endsWith('/me/permissions'))return {data:{data:['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish'].map(permission=>({permission,status:'granted'}))}};
  if(url.endsWith('/me/accounts'))return {data:o.params.after?{data:[{id:'second',name:'Intended',access_token:'token-second',tasks:['CREATE_CONTENT']},{id:'readOnly',access_token:'read',tasks:['ANALYZE']}]}:{data:[{id:'first',name:'First',access_token:'token-first',tasks:['CREATE_CONTENT']}],paging:{next:'https://evil.invalid/do-not-fetch',cursors:{after:'next'}}}};
  if(url.endsWith('/accounts'))return {data:o.params.pageToken?{accounts:[{name:'accounts/account2',accountName:'Other account'}]}:{accounts:[{name:'accounts/account1',accountName:'Account one'}],nextPageToken:'page2'}};
  if(url.includes('/locations'))return {data:{locations:[{name:'locations/location'+(url.includes('account2')?'2':'1'),title:'Business',storefrontAddress:{addressLines:['123 Main']}}]}};
  const id=url.split('/').at(-1);return {data:{id,...(ig?{instagram_business_account:{id:ig}}:{})}};
 }};
 const worker=createOAuthSelection({db:m.db,admin,axios});
 const pages=await worker.facebookChoices('user-token');ok(pages.length===2&&pages[1].id==='second','all Facebook pages, excluding non-publishing roles');
 ok(requests.filter(r=>r.url.endsWith('/me/accounts')).length===2&&!requests.some(r=>r.url.startsWith('https://evil')),'cursor pagination stays on fixed host');
 const locations=await worker.googleChoices('google-token');ok(locations.length===2&&locations[1].accountId==='account2','all Google accounts and locations discovered');
 ok(requests.filter(r=>r.url.includes('/locations')).every(r=>r.o.params.readMask.includes('title')),'current Google locations readMask contract');
 const p={uid:'u',businessId:'b',returnTo:'onboarding',platform:'facebook',choices:pages,userAccessToken:'user-token',tokenExpiresAt:new Date(Date.now()+3600000)};
 let selection=await worker.prepare(p);ok(m.get(C+'facebook').pageId==='old','pending choice leaves existing connection unchanged');
 const safe=await worker.inspect(selection,'u');ok(safe.choices.length===2&&!JSON.stringify(safe).includes('token'),'browser choices never include credentials');
 await rejects(()=>worker.inspect(selection,'someoneElse'),/another account/);
 await rejects(()=>worker.confirm(selection,'u','forged'),/Choose one/);
 failed=true;await rejects(()=>worker.confirm(selection,'u','second'),/provider down/);failed=false;
 ok(m.get(C+'instagram').igUserId==='old-ig'&&m.get(C+'instagram/private/tokens').accessToken==='old-token','failed lookup preserves previous paired credentials');
 m.failNext();await rejects(()=>worker.confirm(selection,'u','second'),/offline/);
 ok(m.get(C+'facebook').pageId==='old'&&m.get('oauthNonces/'+selection),'failed transaction leaves choice retryable');
 const result=await worker.confirm(selection,'u','second');ok(result.businessId==='b'&&result.returnTo==='onboarding','initiating business and return path retained');
 ok(m.get(C+'facebook').pageId==='second'&&m.get(C+'facebook/private/tokens').accessToken==='token-second','explicit second choice binds matching Page token');
 ok(m.get(C+'instagram').status==='disconnected'&&!m.get(C+'instagram').igUserId&&!m.get(C+'instagram/private/tokens'),'new Page without Instagram clears previous paired ID/token');
 await rejects(()=>worker.confirm(selection,'u','first'),/expired/);
 ig='new-ig';selection=await worker.prepare(p);await worker.confirm(selection,'u','first');
 ok(m.get(C+'instagram').igUserId==='new-ig'&&m.get(C+'instagram').pageId==='first'&&m.get(C+'instagram/private/tokens').accessToken==='token-first','linked Instagram ID and token bound to same selected Page');
 selection=await worker.prepare(p);const competing=await Promise.allSettled([worker.confirm(selection,'u','first'),worker.confirm(selection,'u','second')]);ok(competing.filter(r=>r.status==='fulfilled').length===1,'concurrent choices consume exactly one binding');
 selection=await worker.prepare(p);await m.db.doc('oauthNonces/'+selection).update({expiresAt:new Date(0)});await rejects(()=>worker.confirm(selection,'u','first'),/expired/);
 await rejects(()=>worker.prepare({...p,choices:[]}),/No eligible/);
 selection=await worker.prepare({...p,platform:'google',choices:locations,accessToken:'google-token',refreshToken:'refresh'});await worker.confirm(selection,'u',locations[1].id);
 ok(m.get(C+'google').accountId==='account2'&&m.get(C+'google').locationId==='location2'&&m.get(C+'google/private/tokens').refreshToken==='refresh','selected Google account/location/token persist atomically');
 // Actual callback boundary: nonce provider, one-time use, cancellation, empty destinations.
 const shared={db:m.db,admin,axios,onRequest:(...a)=>a.at(-1),onSchedule:(...a)=>a.at(-1),withAuth:f=>f,APP_BASE_URL:'https://example.com',userBizRef:(u,b)=>m.db.doc(`users/${u}/businesses/${b}`),userBizConnsRef:()=>m.db.collection(C.slice(0,-1))};
 const c=load('functions/modules/oauth.js',shared);
 await m.db.doc('oauthNonces/state').set({uid:'u',businessId:'b',platform:'google',phase:'oauth',expiresAt:{stamp:Date.now()+60000}});
 let r=response();await c.exports.facebookOAuthCallback({query:{code:'code',state:'state'}},r);ok(r.code===400&&m.get('oauthNonces/state'),'provider-mismatched OAuth state rejected without consumption');
 r=response();await c.exports.googleOAuthCallback({query:{state:'state'}},r);ok(r.url.includes('bizId=b')&&r.url.includes('error=google')&&!m.get('oauthNonces/state'),'cancellation consumes nonce and retains original business');
 r=response();await c.exports.googleOAuthCallback({query:{state:'state'}},r);ok(r.code===400,'callback replay rejected');
}
async function publisherTests(){
 const calls=[];let authFail=false,missingName=false;
 const model=database({[C+'google']:{status:'connected',accountId:'a',locationId:'l'}});
 const shared={db:model.db,onRequest:(...a)=>a.at(-1),onSchedule:(...a)=>a.at(-1),onDocumentCreated:(...a)=>a.at(-1),onDocumentUpdated:(...a)=>a.at(-1),withAuth:f=>f,admin,axios:{post:async(url,data,config)=>{calls.push({url,data,config});if(authFail&&url.includes('localPosts')){authFail=false;throw Object.assign(Error('expired'),{response:{status:401}});}if(url.includes('/token'))return {data:{access_token:'refreshed'}};return {data:url.includes('localPosts')?(missingName?{}:{name:'accounts/a/locations/l/localPosts/post'}):{id:'media'}};},get:async()=>({data:{status_code:'FINISHED'}})},userBizConnsRef:()=>model.db.collection(C.slice(0,-1)),_setConnTokens:async()=>{}};
 const c=load('functions/modules/publishing.js',shared),pub=c.module.exports;
 await pub._publishGoogleJob({payload:{adaptedContent:'Copy',imageUrls:['https://example.com/image']}},{accountId:'a',locationId:'l',accessToken:'t'},'u','b');
 ok(calls[0].url==='https://mybusiness.googleapis.com/v4/accounts/a/locations/l/localPosts'&&calls[0].data.topicType==='STANDARD'&&calls[0].data.media[0].mediaFormat==='PHOTO','documented Google parent and standard post payload');
 const count=calls.length;await rejects(()=>pub._publishGoogleJob({}, {locationId:'l'}),/Reconnect/);ok(calls.length===count,'missing Google account never calls provider');
 authFail=true;await pub._publishGoogleJob({}, {accountId:'a',locationId:'l',accessToken:'old',refreshToken:'refresh'},'u','b');ok(calls.at(-1).config.headers.Authorization==='Bearer refreshed','401 retries using refreshed token on same destination');
 missingName=true;await rejects(()=>pub._publishGoogleJob({}, {accountId:'a',locationId:'l'}),e=>e.publicationUncertain===true);missingName=false;
 await pub._publishFacebookJob({payload:{adaptedContent:'Copy'}},{pageId:'p',accessToken:'page-token'});ok(calls.at(-1).url===api.META_GRAPH_BASE+'/p/feed'&&calls.at(-1).data.access_token==='page-token','supported Meta version and Page token used for feed');
 await pub._publishInstagramJob({payload:{imageUrls:['https://example.com/image']}},{igUserId:'ig',pageId:'p',accessToken:'page-token'});ok(calls.at(-1).url===api.META_GRAPH_BASE+'/ig/media_publish'&&calls.at(-1).data.creation_id==='media','Instagram publishes only after container readiness');
 const before=calls.filter(r=>r.url.endsWith('media_publish')).length;shared.axios.get=async()=>({data:{status_code:'ERROR'}});await rejects(()=>pub._publishInstagramJob({payload:{imageUrls:['https://example.com/image']}},{igUserId:'ig',pageId:'p'}),/not ready/);ok(calls.filter(r=>r.url.endsWith('media_publish')).length===before,'failed container never published');
}
async function deletionTests(){
 const m=database({'users/u':{activeBusiness:'b',businessIds:['b','z']},[B]:{},'users/u/businesses/z':{}});let cleanupFail=true;
 m.db.recursiveDelete=async ref=>{if(cleanupFail)throw Error('cleanup interrupted');await ref.delete();};
 const shared={db:m.db,admin,onRequest:(...a)=>a.at(-1),withAuth:f=>f,setCors(){},requireAdmin:async()=>{}};
 const c=load('functions/modules/admin.js',shared),run=async body=>{const r=response();await c.exports.adminDeleteBusiness({method:'POST',body},r);return r;};
 let r=await run({uid:'u',bizId:'b'});ok(r.code===500&&m.get('users/u').activeBusiness==='z'&&!m.get(B),'interrupted cleanup already repairs pointers transactionally');
 cleanupFail=false;r=await run({uid:'u',bizId:'b'});ok(r.body.ok&&r.body.activeBusiness==='z','admin can retry after deleted parent');
 r=await run({uid:'u',bizId:'z'});ok(r.body.ok&&m.get('users/u').activeBusiness===null&&m.get('users/u').businessIds.length===0,'admin last-business deletion clears pointers');
 r=await run({uid:'u/other',bizId:'b'});ok(r.code===400,'malformed admin target rejected');
}
async function retentionTests(){
 const original=fs.readFileSync('functions/lib/shared.js','utf8');
 const code=original.slice(original.indexOf('async function sendResendEmail'),original.indexOf('// ── Lazy-init Square'));
 for(const failure of ['missing','rejected','network','success']) {
  const m=database({'users/u':{plan:'trial',email:'u@example.com',lastActiveAt:{stamp:Date.now()-400*86400000}}}),calls=[];
  const email={process:{env:{RESEND_API_KEY:failure==='missing'?'':'fixture'}},console:quiet,fetch:async(url,options)=>{calls.push(options);if(failure==='network')throw Error('offline');return {ok:failure==='success',status:503};}};
  vm.runInNewContext(code,email);
  const shared={db:m.db,admin,onRequest:(...a)=>a.at(-1),onSchedule:(...a)=>a.at(-1),withAuth:f=>f,getPlanConfig:async()=>({retention:{mode:'warn'}}),sendResendEmail:email.sendResendEmail,makeUnsubSig:()=>'',_unsubSecret:()=>'',APP_BASE_URL:'https://example.com',purgeUserData:async()=>{throw Error('Unexpected purge');}};
  const c=load('functions/modules/retention.js',shared);
  // Execute actual scheduled sweep, including real strict email helper and transactional markers.
  await c.exports.scheduledRetentionSweep();
  const d=m.get('users/u');ok(!!d.dormancyWarnedAt===(failure==='success')&&!!d.dormancyPurgeAt===(failure==='success'),failure+': only provider acceptance starts warning/purge clock');
  if(failure==='rejected') {
   const first=d.dormancyWarningPending.key;await c.exports.scheduledRetentionSweep();
   ok(m.get('users/u').dormancyWarningPending.key===first&&calls[0].headers['Idempotency-Key']===calls[1].headers['Idempotency-Key']&&calls[0].body===calls[1].body,'failed warning retries stable key and identical payload');
  }
 }
 // A returning customer during send must never regain deletion markers.
 const m=database({'users/u':{plan:'trial',email:'u@example.com',lastActiveAt:{stamp:Date.now()-400*86400000}}});
 const c=load('functions/modules/retention.js',{db:m.db,admin,onRequest:(...a)=>a.at(-1),onSchedule:(...a)=>a.at(-1),withAuth:f=>f,getPlanConfig:async()=>({retention:{mode:'warn'}}),sendResendEmail:async()=>m.db.doc('users/u').update({lastActiveAt:{stamp:Date.now()}}),makeUnsubSig:()=>'',_unsubSecret:()=>'',APP_BASE_URL:'https://example.com'});
 await c.exports.scheduledRetentionSweep();ok(!m.get('users/u').dormancyPurgeAt,'activity during send cancels marker update');
}
async function refreshTests(){
 const m=database({[B]:{},[C+'facebook']:{platform:'facebook',status:'connected',pageId:'p',expiresAt:new Date(0)},[C+'instagram']:{platform:'instagram',status:'connected',pageId:'p',igUserId:'ig',expiresAt:new Date(0)}}),calls=[];
 const shared={db:m.db,admin,onRequest:(...a)=>a.at(-1),onSchedule:(...a)=>a.at(-1),withAuth:f=>f,_getConnTokens:async()=>({accessToken:'page-old',userAccessToken:'user-old'}),axios:{get:async(url,o)=>{calls.push({url,o});return {data:url.endsWith('/oauth/access_token')?{access_token:'user-new',expires_in:36000000}:{id:'p',access_token:'page-new',instagram_business_account:{id:'ig'}}};}}};
 const c=load('functions/modules/oauth.js',shared);await c.exports.checkPlatformTokenExpiry();
 ok(calls[0].o.params.fb_exchange_token==='user-old'&&calls[1].o.params.access_token==='user-new','refresh exchanges user token then reacquires exact Page token');
 ok(m.get(C+'facebook/private/tokens').accessToken==='page-new'&&m.get(C+'instagram/private/tokens').accessToken==='page-new','paired refresh saves Page token rather than user token');
 await m.db.doc(C+'facebook').update({expiresAt:new Date(0)});await m.db.doc(C+'instagram').update({igUserId:'old-ig'});await c.exports.checkPlatformTokenExpiry();
 ok(m.get(C+'instagram').status==='disconnected'&&!m.get(C+'instagram/private/tokens'),'changed linked Instagram identity never receives refreshed token');
}
async function migrationTests(){
 const {parseArgs,runCli}=require('./migrate-pass11.cjs');
 for(const args of [[],['--apply'],['--project=flubadesigns-25482','--apply'],['--project=blastybiz-9523e','--unknown']]){assert.throws(()=>parseArgs(args));checks++;}
 const m=database({'config/plans':{aiLimits:{pro:17}}});m.db.initializeIfNeeded=async()=>{};m.db.projectId='blastybiz-9523e';let init;
 const sdk={initializeApp:opts=>{init=opts;return opts;},firestore:()=>m.db};
 let out=await runCli(['--project=blastybiz-9523e'],sdk);ok(init.projectId==='blastybiz-9523e'&&!m.get('config/lifecycle'),'CLI sets explicit SDK project and dry run never writes');
 out=await runCli(['--project=blastybiz-9523e','--apply'],sdk);ok(out.verified.lifecycle.remindersStartAt&&out.verified.aiLimits.pro===17&&out.projectId==='blastybiz-9523e','CLI applies and reads back exact project preserving configured values');
 const {repair}=require('./repair-business-pointers.cjs');
 const pointers=database({'users/one':{activeBusiness:'deleted',businessIds:['deleted','b']},'users/one/businesses/b':{},'users/two':{activeBusiness:'gone'},'users/three':{activeBusiness:'good'},'users/three/businesses/good':{}});
 let report=await repair(pointers.db);ok(report.affected===2&&pointers.get('users/one').activeBusiness==='deleted','pointer preview is read-only');
 report=await repair(pointers.db,true);ok(report.reselected===1&&report.cleared===1&&pointers.get('users/one').activeBusiness==='b'&&pointers.get('users/two').activeBusiness===null,'repair selects only existing business or clears missing pointer');
 ok((await repair(pointers.db,true)).affected===0,'pointer repair is idempotent and preserves valid selection');
 m.db.projectId='flubadesigns-25482';await rejects(()=>runCli(['--project=blastybiz-9523e','--apply'],sdk),/target mismatch/);
}
(async()=>{for(const fn of [oauthTests,publisherTests,deletionTests,retentionTests,refreshTests,migrationTests]){await fn();console.log('PASS '+fn.name);}console.log(checks+' Audit 2 backend regression assertions passed.');})().catch(e=>{console.error(e);process.exitCode=1;});
