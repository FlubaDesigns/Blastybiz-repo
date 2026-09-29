'use strict';
const fs=require('node:fs'),path=require('node:path');
const testing=require(process.env.RULES_TEST_PATH||'@firebase/rules-unit-testing');
const {doc,setDoc}=require(process.env.FIREBASE_CLIENT_PATH||'firebase/firestore');
const {ref,uploadBytes}=require(process.env.FIREBASE_CLIENT_PATH?path.resolve(process.env.FIREBASE_CLIENT_PATH,'../storage'):'firebase/storage');
(async()=>{
 const env=await testing.initializeTestEnvironment({projectId:'demo-blastybiz-audit2',firestore:{host:'127.0.0.1',port:8089,rules:fs.readFileSync('firestore.rules','utf8')},storage:{host:'127.0.0.1',port:9199,rules:fs.readFileSync('storage.rules','utf8')}});
 try{
  const user=env.authenticatedContext('upload-owner');
  const upload=p=>uploadBytes(ref(user.storage(),p),new Uint8Array([255,216,255]),{contentType:'image/jpeg'});
  await testing.assertSucceeds(upload('photos/upload-owner/global/before.jpg'));
  await testing.assertFails(upload('photos/other/global/forged.jpg'));
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'accountDeletions/upload-owner'),{status:'retry_required'}));
  await testing.assertFails(upload('photos/upload-owner/global/after.jpg'));
  await testing.assertFails(upload('users/upload-owner/images/after.jpg'));
  console.log('4 actual Storage emulator authorization assertions passed.');
 }finally{await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
