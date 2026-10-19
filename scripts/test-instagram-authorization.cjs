'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {database,admin}=require('./lib/test-firestore.cjs');
const {createOAuthSelection}=require('../functions/lib/oauth-selection');
const {createFacebookAuthorization}=require('../functions/lib/facebook-authorization');
const {hash}=require('../functions/lib/oauth-binding');
const pageId='1436320489559900',igId='17841400000000123',username='litigantai',verifier='a'.repeat(64),base='users/owner/businesses/business';
function fixture(options={}){
 const request={schema:'facebook-page/v1',phase:'authorization-request',uid:'owner',businessId:'business',pageId,pageName:'Litigant-ai',requiredPlatform:'instagram',instagramUsername:username,status:'awaiting-consent',expiresAt:new Date(Date.now()+86400000)};
 const m=database({[base]:{},[base+'/platformConnections/facebook']:{status:'connected',pageId},'oauthNonces/request':request});
 const axios={get:async()=>{
  if(options.providerError)throw Error('provider offline');
  return {data:{id:pageId,...(options.missing?{}:{instagram_business_account:{id:igId,username:options.wrong?'otheraccount':username}})}};
 }};
 const selection=createOAuthSelection({db:m.db,admin,axios}),requests=createFacebookAuthorization({db:m.db});
 return {...m,selection,requests,async prepare(){return selection.prepare({uid:'owner',businessId:'business',platform:'facebook',state:'state',verifierHash:hash(verifier),authorizationRequest:'request',tokenExpiresAt:new Date(Date.now()+86400000),userAccessToken:'private-user',choices:[{id:pageId,pageId,label:'Litigant-ai',accessToken:'private-page',instagramAuthorized:options.denied?false:true}]});}};
}
test('Facebook-only completion cannot satisfy an Instagram request',async()=>{
 const f=fixture();await f.db.doc('oauthNonces/request').update({status:'connected'});
 const value=await f.requests.inspect('request','owner','business');
 assert.equal(value.facebookConnected,true);assert.equal(value.requiredPlatform,'instagram');assert.equal(value.connected,false);
});
test('missing, wrong, denied or unavailable Instagram never consumes the attempt or marks request complete',async()=>{
 for(const options of [{missing:true},{wrong:true},{denied:true},{providerError:true}]){
  const f=fixture(options),id=await f.prepare(),before=f.get(base+'/platformConnections/facebook');
  await assert.rejects(f.selection.confirm(id,'owner',pageId,verifier));
  assert.deepEqual(f.get(base+'/platformConnections/facebook'),before);
  assert.equal(f.get('oauthNonces/request').status,'awaiting-consent');
  assert(f.get('oauthNonces/'+id));assert.equal(f.get(base+'/platformConnections/instagram'),undefined);
 }
});
test('the exact Instagram account is saved atomically and final destination is Instagram',async()=>{
 const f=fixture(),id=await f.prepare(),inspection=await f.selection.inspect(id,'owner',verifier);
 assert.equal(inspection.requiredPlatform,'instagram');assert.equal(inspection.instagramUsername,username);
 assert(!JSON.stringify(inspection).includes('private-'));
 const result=await f.selection.confirm(id,'owner',pageId,verifier);
 assert.equal(result.platform,'instagram');assert.equal(f.get('oauthNonces/'+id),undefined);
 assert.equal(f.get(base+'/platformConnections/instagram').igUsername,username);
 assert.equal(f.get(base+'/platformConnections/instagram/private/tokens').accessToken,'private-page');
 assert.equal((await f.requests.inspect('request','owner','business')).connected,true);
});
test('all connection inline scripts compile, including the Instagram button and result branch',()=>{
 for(const file of ['BlastyBiz-Connect.html','BlastyBiz-Connected.html']){
  const html=fs.readFileSync('public/'+file,'utf8');
  for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
   if(/src=|importmap/.test(match[1]))continue;
   new vm.Script(match[2].replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g,''),{filename:file});
  }
 }
});
