'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(overrides={}) {
 let clock=Date.now(),rows=new Map(),routes=new Map(),calls=[],tail=Promise.resolve();
 let user={uid:'owner',email:'owner@example.test',emailVerified:true,disabled:false};
 let admins=['owner@example.test'],deleted=false,sourceDeleted=false,sourceHasBusiness=false,firebaseRevoked=false;
 let source={uid:'google-owner',email:'new@example.test',emailVerified:true,disabled:false,providerData:[{providerId:'google.com',email:'new@example.test'}]};
 let firebaseIdentity={uid:source.uid,email:source.email,email_verified:true,firebase:{sign_in_provider:'google.com'}};const writes=[];
 const snapshot=data=>({exists:data!==undefined,data:()=>data});
 const db={collection:name=>({limit:()=>({get:async()=>({empty:!sourceHasBusiness})}),doc:id=>({key:name+'/'+id,set:async(data,options)=>writes.push({path:name+'/'+id,data,options}),get:async()=>snapshot(name==='users'?{}:name==='config'?{emails:admins}:(id==='owner'?deleted:sourceDeleted)?{}:undefined)})}),runTransaction:fn=>{
  const run=tail.then(()=>fn({get:async ref=>snapshot(rows.get(ref.key)),create:(ref,d)=>rows.set(ref.key,d),set:(ref,d)=>rows.set(ref.key,d),update:(ref,d)=>rows.set(ref.key,{...rows.get(ref.key),...d})}));tail=run.catch(()=>{});return run;
 }};
 let identity={email:'engine@project.iam.gserviceaccount.com',email_verified:true,iat:Math.floor(clock/1000)};
 const context={exports:{},require:n=>n==='google-auth-library'?{OAuth2Client:class{}}:require(n),URL,console:{warn:()=>{}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../functions/lib/authorization-browser.js'),'utf8'),context);
 context.exports.registerAuthorizationEngineAuth({post:(path,h)=>routes.set(path,h)}, {db,auth:{verifyIdToken:async(token,checkRevoked)=>{assert.equal(checkRevoked,true);if(firebaseRevoked)throw Error('auth/id-token-revoked');return firebaseIdentity;},getUser:async uid=>uid==='owner'?user:source,createCustomToken:async(...args)=>{calls.push(args);return 'private-token';}},ownerIds:['owner'],projectId:'project',config:JSON.stringify({projectId:'project',origin:'https://blasty.example',principal:identity.email,...overrides}),verifyIdentity:async(token,audience)=>{assert.equal(audience,'https://blasty.example/api/auth/engine/session');return identity;},now:()=>clock});
 async function request(path,{id,origin='https://blasty.example',cookie='',bearer='Bearer identity'}={}){
  let out={status:200};const res={set:()=>res,status:s=>(out.status=s,res),json:b=>(out.body=b,res),cookie:(n,v,flags)=>(out.cookie=n+'='+v,out.flags=flags,res),clearCookie:()=>res};
  await routes.get(path)({get:n=>({origin,cookie,authorization:bearer})[n],params:{id},ip:'fixture',socket:{}},res);return out;
 }
 return {request,rows,calls,writes,setFirebaseIdentity:i=>firebaseIdentity=i,setSource:s=>source={...source,...s},revokeFirebase:()=>firebaseRevoked=true,deleteSource:()=>sourceDeleted=true,sourceBusiness:()=>sourceHasBusiness=true,advance:ms=>clock+=ms,setIdentity:i=>identity=i,disable:()=>user.disabled=true,revoke:()=>admins=[],delete:()=>deleted=true};
}
const START='/auth/engine/session',APPROVE=START+'/:id/approve',POLL=START+'/:id';
test('one browser-bound approval signs into only the existing owner, once',async()=>{
 const f=fixture(),a=await f.request(START),b=await f.request(START),id=a.body.requestId;
 assert.equal(a.status,201);assert(a.flags.httpOnly&&a.flags.secure);assert.equal(a.flags.sameSite,'strict');
 assert.equal((await f.request(POLL,{id,cookie:a.cookie})).status,202);assert.equal(f.calls.length,0);
 assert.equal((await f.request(APPROVE,{id})).status,200);
 assert.equal((await f.request(POLL,{id,cookie:b.cookie})).status,403);
 const results=await Promise.all([f.request(POLL,{id,cookie:a.cookie}),f.request(POLL,{id,cookie:a.cookie})]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,410]);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'owner');
 assert(!JSON.stringify([...f.rows]).includes('private-token'));assert.equal((await f.request(APPROVE,{id})).status,410);
});
test('cross-origin, missing bearer, missing browser proof and bad ID fail closed',async()=>{
 const f=fixture();assert.equal((await f.request(START,{origin:'https://other.test'})).status,403);
 const a=await f.request(START),id=a.body.requestId;
 assert.equal((await f.request(APPROVE,{id,bearer:''})).status,401);
 assert.equal((await f.request(APPROVE,{id:'invalid'})).status,400);
 assert.equal((await f.request(POLL,{id,cookie:a.cookie,origin:''})).status,403);
 assert.equal((await f.request(POLL,{id})).status,403);assert.equal(f.calls.length,0);
});
test('wrong, unverified, stale and future engine identities cannot approve',async()=>{
 const f=fixture(),a=await f.request(START),id=a.body.requestId;
 for(const identity of [{email:'other@project.iam.gserviceaccount.com',email_verified:true,iat:Date.now()/1000},{email:'engine@project.iam.gserviceaccount.com',email_verified:false,iat:Date.now()/1000},{email:'engine@project.iam.gserviceaccount.com',email_verified:true,iat:Date.now()/1000-301},{email:'engine@project.iam.gserviceaccount.com',email_verified:true,iat:Date.now()/1000+120}]){f.setIdentity(identity);assert.equal((await f.request(APPROVE,{id})).status,403);}
 assert.equal(f.calls.length,0);
});
test('expired requests and disabled, deleted or no-longer-admin owners cannot sign in',async()=>{
 for(const action of ['disable','delete','revoke']){const f=fixture(),a=await f.request(START);f[action]();assert.equal((await f.request(APPROVE,{id:a.body.requestId})).status,403);assert.equal(f.calls.length,0);}
 const f=fixture(),a=await f.request(START);f.advance(600001);f.setIdentity({email:'engine@project.iam.gserviceaccount.com',email_verified:true,iat:Date.now()/1000+600});assert.equal((await f.request(APPROVE,{id:a.body.requestId})).status,410);
});
test('wrong project and start floods fail closed',async()=>{
 assert.equal((await fixture({projectId:'other'}).request(START)).status,404);
 const f=fixture();for(let i=0;i<5;i++)assert.equal((await f.request(START)).status,201);assert.equal((await f.request(START)).status,429);
});
const GOOGLE='/auth/engine/google',alias={uid:'google-owner',email:'new@example.test'};
test('configured verified Google login reaches the unchanged owner UID and updates only contact email',async()=>{
 const f=fixture({googleAliases:[alias]}),result=await f.request(GOOGLE);
 assert.equal(result.status,200);assert.equal(result.body.ownerUid,'owner');assert.equal(result.body.exchanged,true);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'owner');assert.equal(f.calls[0][1].authorizationEngineGoogle,alias.uid);
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].path,'users/owner');assert.deepEqual(Object.keys(f.writes[0].data),['email']);assert.equal(f.writes[0].data.email,alias.email);assert.equal(f.writes[0].options.merge,true);
});
test('Google mapping rejects forged/revoked, unverified, wrong-provider, wrong-email, disabled and populated source accounts',async()=>{
 const baseline={uid:alias.uid,email:alias.email,email_verified:true,firebase:{sign_in_provider:'google.com'}};
 const scenarios=[
  f=>f.revokeFirebase(),f=>f.setFirebaseIdentity({...baseline,email_verified:false}),
  f=>f.setFirebaseIdentity({...baseline,email:'someone@example.test'}),
  f=>f.setFirebaseIdentity({...baseline,firebase:{sign_in_provider:'custom'}}),
  f=>f.setSource({disabled:true}),f=>f.setSource({emailVerified:false}),
  f=>f.setSource({email:'someone@example.test'}),f=>f.setSource({providerData:[]}),
  f=>f.deleteSource(),f=>f.sourceBusiness(),f=>f.disable(),f=>f.revoke(),f=>f.delete()
 ];
 for(const change of scenarios){const f=fixture({googleAliases:[alias]});change(f);assert((await f.request(GOOGLE)).status>=400);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);}
 for(const request of [{origin:'https://other.example'},{origin:''},{bearer:''}]){const f=fixture({googleAliases:[alias]});assert((await f.request(GOOGLE,request)).status>=400);assert.equal(f.calls.length,0);}
});
test('unmapped Google users and the retained owner are never redirected or promoted',async()=>{
 for(const uid of ['unrelated','owner']){const f=fixture({googleAliases:[alias]});f.setFirebaseIdentity({uid,email:alias.email,email_verified:true,firebase:{sign_in_provider:'google.com'}});const r=await f.request(GOOGLE);assert.equal(r.status,200);assert.equal(r.body.exchanged,false);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);}
 const f=fixture();assert.equal((await f.request(GOOGLE)).body.exchanged,false);
 for(const googleAliases of [[{uid:'owner',email:alias.email}],[{uid:alias.uid,email:'invalid'}],[alias,alias],[]])assert.equal((await fixture({googleAliases}).request(GOOGLE)).status,404);
});
test('login resolves the new Google identity before reading profile data, and suppresses duplicate continuations',async()=>{
 const html=fs.readFileSync(require.resolve('../public/BlastyBiz-Login.html'),'utf8');
 const block=html.slice(html.indexOf('// Resolve only identities'),html.indexOf('\nfunction showLoginForm()'));
 let reads=[],calls=0,signIns=0;
 const owner={uid:'owner',getIdTokenResult:async()=>({claims:{firebase:{sign_in_provider:'custom'}}})};
 const source={uid:'google-owner',getIdTokenResult:async()=>({token:'fixture-id-token',claims:{firebase:{sign_in_provider:'google.com'}}})};
 const c={auth:{},AbortSignal,URLSearchParams,console,window:{location:{}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},sessionStorage:{getItem:()=>null,removeItem(){}},db:{},doc:(_, ...p)=>p.join('/'),getDoc:async path=>{reads.push(path);return {exists:()=>true,data:()=>({onboarded:true,loginGuideDone:true})};},resumePersonalSignup:async()=>null,showLoginForm(){throw Error('unexpected sign-in failure');},fetch:async(url,options)=>{calls++;assert.equal(url,'/api/auth/engine/google');assert.equal(options.headers.Authorization,'Bearer fixture-id-token');return {ok:true,json:async()=>({exchanged:true,ownerUid:'owner',customToken:'private-token'})};},signInWithCustomToken:async(_,token)=>{signIns++;assert.equal(token,'private-token');void c.afterAuth(owner);return {user:owner};}};
 vm.createContext(c);vm.runInContext(block,c);
 await Promise.all([c.afterAuth(source),c.afterAuth(source)]);
 assert.equal(calls,1);assert.equal(signIns,1);assert.deepEqual(reads,['users/owner']);assert.equal(c.window.location.href,'BlastyBiz.html');
});
test('only centrally configured Google origins can exchange; manual handoff keeps its original origin boundary',async()=>{
 const f=fixture({googleAliases:[alias],googleOrigins:['https://blasty.example','https://alias.example']});
 assert.equal((await f.request(GOOGLE,{origin:'https://alias.example'})).status,200);
 assert.equal((await f.request(GOOGLE,{origin:'https://unlisted.example'})).status,403);
 assert.equal((await f.request(START,{origin:'https://alias.example'})).status,403);
 for(const googleOrigins of [[],['http://blasty.example'],['https://blasty.example/path'],['bad']])assert.equal((await fixture({googleAliases:[alias],googleOrigins}).request(GOOGLE)).status,404);
});
