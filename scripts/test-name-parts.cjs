'use strict';
const assert=require('node:assert/strict');
const names=require('../functions/lib/business-form');
const {cleanCreative,createAdService}=require('../functions/lib/ads');
const {database,admin}=require('./lib/test-firestore.cjs');
(async()=>{
const full={ownerName:'David Percey'};
assert.deepEqual(names.nameParts(full),{ownerFirstName:'David',ownerLastName:'Percey',ownerName:'David Percey'});
assert.equal(names.nameParts({...full,ownerFirstName:'David',ownerLastName:''}).ownerName,'David');
assert.equal(names.nameParts({ownerFirstName:'Mary Jane',ownerLastName:'van der Meer'}).ownerName,'Mary Jane van der Meer');
assert.equal(names.nameParts({ownerName:'Cher'}).ownerLastName,'');
for(const firstName of ['yes','no'])for(const lastName of ['yes','no']){
 const expected=[firstName==='yes'?'David':'',lastName==='yes'?'Percey':''].filter(Boolean).join(' ');
 assert.equal(names.mentionedName(full,{firstName,lastName}),expected);
 assert.deepEqual(cleanCreative({mentions:{firstName,lastName}}).mentions,names.mentions({firstName,lastName}));
}
assert.equal(names.mentions({name:'yes',lastName:'no'}).lastName,'no');
assert.equal(names.mentions({name:'yes'}).firstName,'yes');
assert.equal(names.mentions({name:'yes'}).lastName,'yes');
assert.equal(names.profileMentions({ynMentionName:'yes',ynMentionLastName:'no'}).lastName,'no');
assert.equal(names.validate({sellerType:'personal',ownerFirstName:'David',ownerLastName:'',email:'d@example.com',phone:'9413751504'}).length,0);
assert(names.validate({sellerType:'personal',ownerFirstName:'',ownerLastName:'Percey',email:'d@example.com',phone:'9413751504'}).some(p=>p.field.key==='ownerFirstName'));
const base='users/u/businesses/b',camp=base+'/campaigns/c';
const state=database({[base]:{...full,ynMentionFirstName:'yes',ynMentionLastName:'no'},[camp]:{name:'Sale'}});
const call=createAdService(state.db,admin);
let {ad}=await call('u',{action:'create',businessId:'b',campaignId:'c',adId:'a',requestId:'create'});
assert.equal(ad.mentions.firstName,'yes');assert.equal(ad.mentions.lastName,'no');
({ad}=await call('u',{action:'save',businessId:'b',campaignId:'c',adId:'a',requestId:'save',expectedRevision:ad.revision,creative:{mentions:{firstName:'no',lastName:'yes'}}}));
const saved=await call('u',{action:'get',businessId:'b',campaignId:'c',adId:'a'});
assert.equal(saved.ad.mentions.firstName,'no');assert.equal(saved.ad.mentions.lastName,'yes');
console.log('Name parts: optional last name, legacy profiles, independent mentions and saved Ad roundtrip passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
