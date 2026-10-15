'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(overrides={}) {
 let clock=Date.now(),rows=new Map(),routes=new Map(),calls=[],tail=Promise.resolve();
 let user={uid:'owner',email:'owner@example.test',emailVerified:true,disabled:false};
 let admins=['owner@example.test'],deleted=false;
 const snapshot=data=>({exists:data!==undefined,data:()=>data});
 const db={collection:name=>({doc:id=>({key:name+'/'+id,get:async()=>snapshot(name==='users'?{}:name==='config'?{emails:admins}:deleted?{}:undefined)})}),runTransaction:fn=>{
  const run=tail.then(()=>fn({get:async ref=>snapshot(rows.get(ref.key)),create:(ref,d)=>rows.set(ref.key,d),set:(ref,d)=>rows.set(ref.key,d),update:(ref,d)=>rows.set(ref.key,{...rows.get(ref.key),...d})}));tail=run.catch(()=>{});return run;
 }};
 let identity={email:'engine@project.iam.gserviceaccount.com',email_verified:true,iat:Math.floor(clock/1000)};
 const context={exports:{},require:n=>n==='google-auth-library'?{OAuth2Client:class{}}:require(n),URL,console:{warn:()=>{}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../functions/lib/authorization-browser.js'),'utf8'),context);
 context.exports.registerAuthorizationEngineAuth({post:(path,h)=>routes.set(path,h)}, {db,auth:{getUser:async()=>user,createCustomToken:async(...args)=>{calls.push(args);return 'private-token';}},ownerIds:['owner'],projectId:'project',config:JSON.stringify({projectId:'project',origin:'https://blasty.example',principal:identity.email,...overrides}),verifyIdentity:async(token,audience)=>{assert.equal(audience,'https://blasty.example/api/auth/engine/session');return identity;},now:()=>clock});
 async function request(path,{id,origin='https://blasty.example',cookie='',bearer='Bearer identity'}={}){
  let out={status:200};const res={set:()=>res,status:s=>(out.status=s,res),json:b=>(out.body=b,res),cookie:(n,v,flags)=>(out.cookie=n+'='+v,out.flags=flags,res),clearCookie:()=>res};
  await routes.get(path)({get:n=>({origin,cookie,authorization:bearer})[n],params:{id},ip:'fixture',socket:{}},res);return out;
 }
 return {request,rows,calls,advance:ms=>clock+=ms,setIdentity:i=>identity=i,disable:()=>user.disabled=true,revoke:()=>admins=[],delete:()=>deleted=true};
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
