'use strict';
// Offline regression tests. No provider, storage or authentication service is contacted.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const {database,admin}=require('./lib/test-firestore.cjs');
const {createAccountDeletion}=require('../functions/lib/account-deletion');
const {hash}=require('../functions/lib/oauth-binding');
const origin='https://blastybiz.com',secret='a'.repeat(64),otherSecret='b'.repeat(64);
let checks=0;
const ok=(v,m)=>{assert(v,m);checks++;};
const res=()=>({code:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(c){this.code=c;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;},redirect(...args){this.url=args.at(-1);this.code=args.length===2?args[0]:302;return this;}});
function fixture(){
 const m=database({'users/attacker/businesses/collision':{},'users/victim/businesses/collision':{}}),calls=[];
 const axios={post:async(url)=>{calls.push(url);return {data:{access_token:'google-private',refresh_token:'refresh-private'}};},get:async(url)=>{
  calls.push(url);
  if(url.endsWith('/oauth/access_token'))return {data:{access_token:'meta-private'}};
  if(url.endsWith('/me/permissions'))return {data:{data:['pages_show_list','pages_read_engagement','pages_manage_posts'].map(permission=>({permission,status:'granted'}))}};
  if(url.endsWith('/me/accounts'))return {data:{data:[{id:'page',name:'Victim page',access_token:'page-private',tasks:['CREATE_CONTENT']}]}};
  if(url.endsWith('/accounts'))return {data:{accounts:[{name:'accounts/account',accountName:'Account'}]}};
  if(url.endsWith('/locations'))return {data:{locations:[{name:'locations/location',title:'Victim location'}]}};
  return {data:{id:'page'}};
 }};
 const shared={setCors(){},db:m.db,admin,axios,APP_BASE_URL:origin,ALLOWED_ORIGINS:new Set([origin]),onRequest:(...a)=>a.at(-1),onSchedule:(...a)=>a.at(-1),withAuth:fn=>async(req,r)=>req.auth?fn(req,r,req.auth):r.status(401).json({error:'Unauthorized'}),checkUidRateLimit:async()=>true,userBizRef:(uid,id)=>m.db.doc(`users/${uid}/businesses/${id}`)};
 const filename=path.resolve('functions/modules/oauth.js'),realRequire=createRequire(filename),exports={};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{exports,require:p=>p==='../lib/shared'?shared:realRequire(p),process:{env:{GOOGLE_CLIENT_ID:'fixture-google',FACEBOOK_APP_ID:'fixture-meta'}},console:{error(){},warn(){},log(){}},URLSearchParams,Date,Buffer},{filename});
 async function call(name,req){const r=res();await exports[name](req,r);return r;}
 async function initiate(platform,extra={}){
  const r=await call(platform==='google'?'initiateGoogleOAuth':'initiateFacebookOAuth',{auth:{uid:'attacker'},headers:{origin},query:{businessId:'collision',verifierHash:hash(secret),...extra}});
  assert.equal(r.code,200);return r.body;
 }
 async function start(state,extra={}){return call('oauthStart',{method:'POST',headers:{origin},body:{state,verifier:secret},...extra});}
 async function callback(platform,state,cookie,code='code'){return call(platform==='google'?'googleOAuthCallback':'facebookOAuthCallback',{method:'GET',query:{state,...(code?{code}:{})},headers:{cookie}});}
 return {...m,calls,call,initiate,start,callback};
}
async function oauth(){
 for(const platform of ['google','facebook']){
  const f=fixture(),init=await f.initiate(platform),state=init.state;
  ok(new URL(init.url).origin===origin&&new URL(init.url).pathname==='/BlastyBiz-OAuth-Start.html','same-origin bridge preserves sessionStorage across custom domains');
  ok(!init.url.includes(secret)&&!init.url.includes('private'),'URL carries no verifier or credentials');
  const transferredStart=await f.start(state,{headers:{origin:'https://attacker.example'}});
  ok(transferredStart.code===403&&f.get('oauthNonces/'+state).phase==='start','external form cannot plant attacker browser cookie');
  const wrongProof=await f.start(state,{body:{state,verifier:otherSecret}});
  ok(wrongProof.code===403,'transferred bridge without same-tab secret fails');
  const start=await f.start(state),cookie=start.headers['Set-Cookie'].split(';')[0];
  ok(start.code===303&&/HttpOnly; Secure; SameSite=Lax/.test(start.headers['Set-Cookie']),'top-level POST sets secure first-party callback cookie and GET redirect');
  ok((await f.start(state)).code===403,'start ticket is single-use');
  const before=f.calls.length,transferred=await f.callback(platform,state,'');
  ok(transferred.code===400&&f.calls.length===before&&f.get('oauthNonces/'+state),'transferred provider authorization URL fails before token exchange or token persistence');
  ok((await f.callback(platform,state,cookie+'wrong')).code===400,'incorrect callback cookie fails');
  ok((await f.callback(platform==='google'?'facebook':'google',state,cookie)).code===400,'provider mismatch rejected');
  const callback=await f.callback(platform,state,cookie),fragment=new URLSearchParams(new URL(callback.url).hash.slice(1)),selection=fragment.get('selection');
  ok(selection&&fragment.get('state')===state&&!new URL(callback.url).searchParams.has('selection'),'opaque completion ticket stays in fragment');
  ok(!f.get(`users/attacker/businesses/collision/platformConnections/${platform}`),'sole provider destination is never automatically attached');
  ok((await f.callback(platform,state,cookie)).code===400,'callback state replay rejected');
  const endpoint=(body,uid='attacker')=>f.call('oauthDestination',{method:'POST',auth:uid?{uid}:null,body:{selection,verifier:secret,...body}});
  ok((await endpoint({action:'inspect'},null)).code===401,'completion requires Firebase authentication');
  ok((await endpoint({action:'inspect'},'victim')).code===403,'callback recipient cannot complete attacker account');
  for(const body of [{action:'inspect'},{choiceId:platform==='google'?'account_location':'page'},{cancel:true}]){
   ok((await endpoint({...body,verifier:otherSecret})).code===403,'same UID without originating browser proof cannot inspect, confirm or cancel');
  }
  const inspected=await endpoint({action:'inspect'});
  ok(inspected.body.choices.length===1&&!JSON.stringify(inspected.body).includes('private'),'authenticated browser sees names but no private provider tokens');
  const choiceId=inspected.body.choices[0].id;
  const competing=await Promise.all([endpoint({choiceId}),endpoint({choiceId})]);
  ok(competing.filter(r=>r.code===200).length===1,'concurrent confirmation consumes exactly one selection');
  ok(f.get(`users/attacker/businesses/collision/platformConnections/${platform}`).status==='connected','valid original browser/authenticated choice connects');
  ok(!f.get(`users/victim/businesses/collision/platformConnections/${platform}`),'tenant collision does not affect another owner');
  ok((await endpoint({choiceId})).code===403&&!f.get('oauthNonces/'+selection),'selection and credentials consumed, replay rejected');
 }
 const f=fixture();
 ok((await f.call('oauthStart',{method:'OPTIONS',headers:{origin}})).code===204,'start endpoint supports safe hosting/engine preflight');
 ok((await f.call('oauthStart',{method:'GET',headers:{origin}})).code===405,'direct GET cannot set callback cookie');
 ok((await f.call('oauthStart',{method:'POST',headers:{origin},body:{}})).code===403,'empty POST rejected');
 for(const badOrigin of [undefined,'null']){const attempt=await f.initiate('google');ok((await f.start(attempt.state,{headers:{origin:badOrigin}})).code===403,'missing or opaque Origin rejected');}
 const one=await f.initiate('google'),two=await f.initiate('google'),oneStart=await f.start(one.state),twoStart=await f.start(two.state);
 const combined=oneStart.headers['Set-Cookie'].split(';')[0]+'; '+twoStart.headers['Set-Cookie'].split(';')[0];
 ok((await f.callback('google',one.state,combined,'')).code===302&&(await f.callback('google',two.state,combined,'')).code===302,'separate attempt cookies coexist without overwrite');
 let init=await f.initiate('google'),start=await f.start(init.state),cookie=start.headers['Set-Cookie'].split(';')[0];
 let r=await f.callback('google',init.state,cookie,'');
 ok(new URL(r.url).searchParams.get('error')==='google'&&!f.get('oauthNonces/'+init.state)&&!f.calls.length,'provider cancel consumes state without provider exchange');
 init=await f.initiate('google');await f.db.doc('oauthNonces/'+init.state).update({expiresAt:new Date(0)});
 ok((await f.start(init.state)).code===403,'expired initiation rejected');
 init=await f.initiate('google');start=await f.start(init.state);cookie=start.headers['Set-Cookie'].split(';')[0];await f.db.doc('oauthNonces/'+init.state).update({expiresAt:new Date(0)});
 ok((await f.callback('google',init.state,cookie)).code===400,'expired callback rejected');
 for(const expire of [false,true]){
  init=await f.initiate('google');start=await f.start(init.state);r=await f.callback('google',init.state,start.headers['Set-Cookie'].split(';')[0]);
  const selection=new URLSearchParams(new URL(r.url).hash.slice(1)).get('selection');
  if(expire){await f.db.doc('oauthNonces/'+selection).update({expiresAt:new Date(0)});r=await f.call('oauthDestination',{method:'POST',auth:{uid:'attacker'},body:{selection,verifier:secret,choiceId:'account_location'}});ok(r.code===403,'expired selection cannot activate');}
  r=await f.call('oauthDestination',{method:'POST',auth:{uid:'attacker'},body:{selection,verifier:secret,cancel:true}});
  ok(r.body.cancelled&&!f.get('oauthNonces/'+selection),'owner can cancel live or expired selection and erase pending tokens');
 }
}
async function deletion(){
 const m=database({'users/attacker':{},'users/attacker/businesses/collision':{ownerUid:'attacker'},'users/victim':{},'users/victim/businesses/collision':{ownerUid:'victim'},'accountDeletions/attacker':{status:'retry_required',storagePrefixes:['businesses/collision/','photos/victim/','users/victim/images/']}});
 const objects=new Set(['businesses/collision/victim.jpg','businesses/collision/ambiguous.jpg','photos/victim/image.jpg','users/victim/images/old.jpg','photos/attacker/image.jpg','users/attacker/images/old.jpg']);
 const deleted=[];
 m.db.recursiveDelete=async ref=>{for(const p of Object.keys(m.all()))if(p===ref.path||p.startsWith(ref.path+'/'))await m.db.doc(p).delete();};
 const fakeAdmin={...admin,auth:()=>({deleteUser:async()=>{}}),storage:()=>({bucket:()=>({deleteFiles:async({prefix})=>{deleted.push(prefix);for(const name of objects)if(name.startsWith(prefix))objects.delete(name);}})})};
 const purge=createAccountDeletion({db:m.db,admin:fakeAdmin,getSquare:()=>{throw Error('Unexpected billing');},revokeConnections:async()=>{}});
 const dry=await purge('attacker',{dryRun:true});
 ok(JSON.stringify(dry.storagePrefixes)===JSON.stringify(['users/attacker/images/','photos/attacker/'])&&!deleted.length,'dry-run includes only provably owned UID prefixes');
 await purge('attacker');
 ok(deleted.length===2&&deleted.every(p=>p.includes('/attacker/')),'retry sanitizes legacy journal prefixes, never trusts business IDs or old journal ownership');
 ok(objects.size===4&&objects.has('businesses/collision/ambiguous.jpg')&&objects.has('businesses/collision/victim.jpg'),'ambiguous legacy objects preserved despite tenant-selected ID collision');
 ok(objects.has('photos/victim/image.jpg')&&objects.has('users/victim/images/old.jpg')&&m.get('users/victim/businesses/collision'),'other tenant files and business remain intact');
 ok(!objects.has('photos/attacker/image.jpg')&&!m.get('users/attacker'),'verified owner current data deleted');
}
(async()=>{await oauth();await deletion();console.log(checks+' account/OAuth security assertions passed (offline mocks).');})().catch(e=>{console.error(e);process.exitCode=1;});
