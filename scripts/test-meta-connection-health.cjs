'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {database,admin}=require('./lib/test-firestore.cjs');
const {checkMetaDestination,saveVerifiedMetaConnection}=require('../functions/lib/meta-connection-health');
const {createOAuthSelection}=require('../functions/lib/oauth-selection');
const {hash}=require('../functions/lib/oauth-binding');
const C='users/owner/businesses/biz/platformConnections/';
const original={status:'expired',pageId:'123',igUserId:'456',connectedAt:{stamp:1},expiresAt:new Date(0)};
function fixture(status='expired'){return database({[C+'facebook']:{...original,status},[C+'facebook/private/tokens']:{accessToken:'page-secret'},[C+'publishJobs/untouched']:{status:'needs_connection'}});}
test('valid Page and linked Instagram survive user-grant expiry without renewal',async()=>{
 for(const platform of ['facebook','instagram']){
  const calls=[],axios={get:async(url,o)=>{calls.push({url,o});return {data:{id:'123',instagram_business_account:{id:'456'}}};}};
  const result=await checkMetaDestination({platform,connection:original,accessToken:'page-secret',axios});
  assert.equal(result.state,'valid');assert.equal(calls.length,1);assert.ok(!calls[0].url.includes('page-secret'));assert.equal(calls[0].o.headers.Authorization,'Bearer page-secret');assert.ok(!calls[0].url.includes('oauth/access_token'));
 }
});
test('transient failures do not imply expired authorization; definitive rejections do',async()=>{
 for(const [status,code,want] of [[503,190,'unknown'],[429,4,'unknown'],[400,4,'unknown'],[400,190,'invalid'],[403,200,'invalid'],[401,102,'invalid']]){
  const axios={get:async()=>{throw Object.assign(Error('secret must never escape'),{response:{status,data:{error:{code,message:'secret must never escape'}}}});}};
  const result=await checkMetaDestination({platform:'facebook',connection:original,accessToken:'secret',axios});assert.equal(result.state,want);assert.ok(!JSON.stringify(result).includes('secret'));
 }
});
test('changed Page or Instagram identity cannot be accepted',async()=>{
 for(const data of [{id:'999'},{id:'123',instagram_business_account:{id:'999'}},{id:'123'}]){
  assert.equal((await checkMetaDestination({platform:'instagram',connection:original,accessToken:'secret',axios:{get:async()=>({data})}})).state,'invalid');
 }
});
test('verified recovery changes only the connection and preserves original grant expiry',async()=>{
 const m=fixture(),ref=m.db.doc(C+'facebook');const before=m.get(C+'publishJobs/untouched');
 assert.equal(await saveVerifiedMetaConnection({db:m.db,admin,ref,expected:original,accessToken:'page-secret'}),false);
 assert.equal(await saveVerifiedMetaConnection({db:m.db,admin,ref,expected:original,accessToken:'page-secret',allowExpired:true}),true);
 const c=m.get(C+'facebook');assert.equal(c.status,'connected');assert.equal(c.expiresAt,null);assert.equal(c.userTokenExpiresAt.getTime(),0);assert.deepEqual(c.connectedAt,{stamp:1});assert.deepEqual(m.get(C+'publishJobs/untouched'),before);assert.equal(m.get(C+'facebook/private/tokens').accessToken,'page-secret');
});
test('disconnect, reconnect, token rotation, and destination changes win races',async()=>{
 for(const change of ['disconnect','reconnect','token','destination']){
  const m=fixture('connected'),ref=m.db.doc(C+'facebook'),expected=(await ref.get()).data();
  if(change==='token')await ref.collection('private').doc('tokens').update({accessToken:'new'});
  else await ref.update(change==='disconnect'?{status:'disconnected'}:change==='reconnect'?{connectedAt:{stamp:2}}:{pageId:'999'});
  assert.equal(await saveVerifiedMetaConnection({db:m.db,admin,ref,expected,accessToken:'page-secret'}),false,change);
 }
});
test('new Meta bindings store renewal expiry separately from publishing credentials',async()=>{
 const m=database({'users/owner/businesses/biz':{}}),verifier='a'.repeat(64),expiry=new Date(Date.now()+86400000);
 const worker=createOAuthSelection({db:m.db,admin,axios:{get:async()=>({data:{id:'123',instagram_business_account:{id:'456'}}})}});
 const id=await worker.prepare({uid:'owner',businessId:'biz',platform:'facebook',state:'state',verifierHash:hash(verifier),tokenExpiresAt:expiry,userAccessToken:'user-secret',choices:[{id:'123',pageId:'123',label:'Page',accessToken:'page-secret',instagramAuthorized:true}]});
 await worker.confirm(id,'owner','123',verifier);
 for(const platform of ['facebook','instagram']){const c=m.get(C+platform);assert.equal(c.expiresAt,null);assert.equal(c.userTokenExpiresAt.getTime(),expiry.getTime());assert.equal(c.status,'connected');}
});
