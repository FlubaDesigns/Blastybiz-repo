'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const testing=require(process.env.RULES_TEST_PATH||'@firebase/rules-unit-testing');
const firestore=require(process.env.FIREBASE_CLIENT_PATH||'firebase/firestore');
const {doc,getDoc,setDoc,deleteDoc,writeBatch}=firestore;
(async()=>{
 const env=await testing.initializeTestEnvironment({projectId:'demo-blastybiz-audit2',firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync('firestore.rules','utf8')}});
 let checks=0;
 try {
  await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await Promise.all([
   setDoc(doc(db,'users/owner'),{email:'owner@example.com',plan:'pro'}),
   setDoc(doc(db,'users/owner/businesses/business'),{businessName:'Test'}),
   setDoc(doc(db,'config/admins'),{emails:['listed@example.com']}),
   setDoc(doc(db,'config/plans'),{aiLimits:{pro:1000}}),
   setDoc(doc(db,'oauthNonces/secret-choice'),{accessToken:'fixture'}),
   setDoc(doc(db,'users/owner/businesses/business/platformConnections/facebook/private/tokens'),{accessToken:'fixture'})
  ]);});
  for(const email of ['info@blastybiz.com','listed@example.com'])for(const verified of [true,false,undefined]){
   const db=env.authenticatedContext('admin-fixture',{email,...(verified===undefined?{}:{email_verified:verified})}).firestore();
   const expect=verified===true?testing.assertSucceeds:testing.assertFails;
   await expect(getDoc(doc(db,'users/owner')));checks++;
   await expect(setDoc(doc(db,'config/plans'),{aiLimits:{pro:1000}}));checks++;
   await testing.assertFails(getDoc(doc(db,'oauthNonces/secret-choice')));checks++;
   await testing.assertFails(getDoc(doc(db,'users/owner/businesses/business/platformConnections/facebook/private/tokens')));checks++;
  }
  const owner=env.authenticatedContext('owner',{email:'owner@example.com',email_verified:true}).firestore();
  await testing.assertSucceeds(getDoc(doc(owner,'users/owner/businesses/business')));checks++;
  await testing.assertFails(setDoc(doc(owner,'users/owner'),{plan:'agency'},{merge:true}));checks++;
  await testing.assertFails(setDoc(doc(owner,'users/owner'),{dormancyWarningPending:{key:'fake'}},{merge:true}));checks++;
  await testing.assertFails(getDoc(doc(owner,'oauthNonces/secret-choice')));checks++;
  const other=env.authenticatedContext('other',{email:'other@example.com',email_verified:true}).firestore();
  await testing.assertFails(getDoc(doc(other,'users/owner')));checks++;
  await testing.assertFails(getDoc(doc(other,'users/owner/businesses/business')));checks++;
  await testing.assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'users/owner')));checks++;
  await testing.assertFails(setDoc(doc(owner,'users/owner/businesses/business/platformConnections/google'),{status:'connected',accountId:'forged',locationId:'forged'}));checks++;
  await testing.assertSucceeds(setDoc(doc(owner,'users/owner/businesses/business/platformConnections/google'),{uid:'owner',businessId:'business',platform:'google',profileUrl:'https://example.com'}));checks++;
  await testing.assertFails(setDoc(doc(owner,'users/owner/businesses/business/platformConnections/google'),{status:'connected'},{merge:true}));checks++;
  for(const provider of ['google','facebook','instagram']) {
   const ref=doc(owner,'users/owner/businesses/business/platformConnections/'+provider);
   await testing.assertSucceeds(setDoc(ref,{uid:'owner',businessId:'business',platform:provider,profileUrl:'https://example.com'},{merge:true}));checks++;
   for(const [field,value] of [['uid','other'],['businessId','other'],['platform','other']]){
    await testing.assertFails(setDoc(ref,{[field]:value},{merge:true}));checks++;
   }
  }
  for(const forged of [{uid:'other',businessId:'creation-test',platform:'google'},{uid:'owner',businessId:'wrong-business',platform:'google'},{uid:'owner',businessId:'creation-test',platform:'facebook'}]){
   // A separate business path ensures this exercises CREATE, not UPDATE.
   await testing.assertFails(setDoc(doc(owner,'users/owner/businesses/creation-test/platformConnections/google'),forged));checks++;
  }
  await testing.assertFails(setDoc(doc(owner,'users/owner/businesses/new/platformConnections/google'),{profileUrl:'https://example.com'}));checks++;
  await testing.assertFails(setDoc(doc(owner,'users/owner/businesses/business/campaigns/c/advertising/old'),{approval:{state:'approved'},schedule:{enabled:true}}));checks++;
  await testing.assertFails(deleteDoc(doc(owner,'users/owner/businesses/business')));checks++;
  await testing.assertSucceeds(setDoc(doc(owner,'users/owner'),{lastActiveAt:new Date()},{merge:true}));checks++;
  const batch = writeBatch(owner);
  for(let i=0;i<50;i++)batch.set(doc(owner,'users/owner/businesses/business/facts/batch-'+i),{bizId:'business',text:'fixture'});
  await testing.assertSucceeds(batch.commit());checks++;
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'accountDeletions/owner'),{status:'running'}));
  const blockedBatch = writeBatch(owner);
  for(let i=0;i<50;i++)blockedBatch.set(doc(owner,'users/owner/businesses/business/facts/batch-'+i),{bizId:'business',text:'changed'});
  await testing.assertFails(blockedBatch.commit());checks++;
  await testing.assertFails(setDoc(doc(owner,'users/owner'),{lastActiveAt:new Date()},{merge:true}));checks++;
  await testing.assertFails(setDoc(doc(owner,'users/owner/businesses/business/facts/new'),{bizId:'business'}));checks++;
  await testing.assertFails(setDoc(doc(owner,'copyLibrary/new'),{uid:'owner',text:'late write'}));checks++;
  await testing.assertFails(deleteDoc(doc(owner,'accountDeletions/owner')));checks++;
  await testing.assertFails(getDoc(doc(owner,'accountDeletions/owner')));checks++;
  await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),'users/owner')));
  await testing.assertFails(setDoc(doc(owner,'users/owner'),{plan:'starter'}));checks++;
  assert(checks===61);console.log(checks+' actual Firestore emulator authorization assertions passed.');
 } finally {await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
