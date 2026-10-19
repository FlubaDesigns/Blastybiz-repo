'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createLinkedIn,SCOPES}=require('../functions/lib/linkedin');
const {createOAuthSelection}=require('../functions/lib/oauth-selection');
const {hash}=require('../functions/lib/oauth-binding');
const {database,admin}=require('./lib/test-firestore.cjs');
function fixture(){
 let allowed=true,pages=0;
 const axios={get:async(url,options)=>{
   assert.equal(options.headers.Authorization,'Bearer fixture-token');
   assert.equal(options.headers['LinkedIn-Version'],'202609');
   if(url.endsWith('organizationAcls')){
     assert.equal(options.params.q,'roleAssignee');pages++;
     return {data:{elements:allowed?[
       {organization:'urn:li:organization:123',role:'ADMINISTRATOR',state:'APPROVED'},
       {organization:'urn:li:person:456',role:'ADMINISTRATOR',state:'APPROVED'},
       {organization:'urn:li:organization:789',role:'ADMINISTRATOR',state:'REVOKED'},
       {organization:'urn:li:organization:987',role:'ANALYST',state:'APPROVED'}]:[],paging:{links:[]}}};
   }
   assert.equal(url,'https://api.linkedin.com/rest/organizations/123');
   return {data:{id:123,localizedName:'Company <&> name'}};
 }};
 return {axios,revoke(){allowed=false;},count:()=>pages};
}
test('company inventory excludes personal profiles, revoked roles and analytics-only roles',async()=>{
 const f=fixture(),api=createLinkedIn(f);
 assert(!SCOPES.includes('member_social'));
 const choices=await api.choices('fixture-token');assert.equal(choices.length,1);
 assert.equal(choices[0].organizationUrn,'urn:li:organization:123');assert.equal(choices[0].label,'Company <&> name');
 await assert.rejects(api.verify('fixture-token',{id:'456',organizationId:'456',organizationUrn:'urn:li:person:456'}));
 assert.equal(f.count(),1);
});
test('confirmation is owner/browser bound, rechecks provider access and consumes private credentials once',async()=>{
 const f=fixture(),m=database({'users/owner/businesses/company':{}}),api=createLinkedIn(f),selection=createOAuthSelection({db:m.db,admin,axios:f.axios});
 const verifier='a'.repeat(64),choices=await api.choices('fixture-token');
 const id=await selection.prepare({uid:'owner',businessId:'company',platform:'linkedin',choices,accessToken:'fixture-token',tokenExpiresAt:new Date(Date.now()+3600000),state:'attempt',verifierHash:hash(verifier)});
 await assert.rejects(selection.inspect(id,'other',verifier));
 await assert.rejects(selection.confirm(id,'owner','123','b'.repeat(64)));
 assert(!JSON.stringify(await selection.inspect(id,'owner',verifier)).includes('fixture-token'));
 await assert.rejects(selection.confirm(id,'owner','urn:li:person:456',verifier));
 f.revoke();await assert.rejects(selection.confirm(id,'owner','123',verifier));
 assert(!m.get('users/owner/businesses/company/platformConnections/linkedin'));
 const restored=fixture(),other=createOAuthSelection({db:m.db,admin,axios:restored.axios});
 const result=await Promise.allSettled([other.confirm(id,'owner','123',verifier),other.confirm(id,'owner','123',verifier)]);
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
 const connection=m.get('users/owner/businesses/company/platformConnections/linkedin');
 assert.equal(connection.organizationUrn,'urn:li:organization:123');assert(!JSON.stringify(connection).includes('fixture-token'));
 assert.equal(m.get('users/owner/businesses/company/platformConnections/linkedin/private/tokens').accessToken,'fixture-token');
 assert(!m.get('oauthNonces/'+id));
});
test('pagination stays on the fixed LinkedIn endpoint and fails closed on unbounded inventory',async()=>{
 let calls=0;
 const api=createLinkedIn({axios:{get:async(url)=>{assert.equal(url,'https://api.linkedin.com/rest/organizationAcls');calls++;return {data:{elements:[],paging:{links:[{rel:'next',href:'https://attacker.invalid'}]}}};}}});
 await assert.rejects(api.choices('fixture-token'));assert.equal(calls,5);
});
test('expired grants cannot be confirmed and both phone pages compile',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const f=fixture(),m=database({'users/owner/businesses/company':{}}),selection=createOAuthSelection({db:m.db,admin,axios:f.axios});
 const verifier='a'.repeat(64),id=await selection.prepare({uid:'owner',businessId:'company',platform:'linkedin',choices:await createLinkedIn(f).choices('fixture-token'),accessToken:'fixture-token',tokenExpiresAt:new Date(Date.now()-1),state:'attempt',verifierHash:hash(verifier)});
 await assert.rejects(selection.confirm(id,'owner','123',verifier));
 for(const file of ['BlastyBiz-Connect.html','BlastyBiz-Connected.html']){
   const html=fs.readFileSync('public/'+file,'utf8');
   for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
     if(match[1].includes('importmap'))continue;
     new vm.Script(match[2].replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g,''),{filename:file});
   }
 }
 assert.equal(require('../functions/lib/platforms').byId.linkedin.deliveryMode,'manual');
});
