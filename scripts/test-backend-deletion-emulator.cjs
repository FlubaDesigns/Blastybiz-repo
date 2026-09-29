'use strict';
const assert=require('node:assert/strict');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Deletion test requires Firestore emulator');
const admin=require('../functions/node_modules/firebase-admin');
const {createAccountDeletion}=require('../functions/lib/account-deletion');
admin.initializeApp({projectId:'demo-blastybiz-audit2'});const db=admin.firestore();
let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const fakeAdmin={firestore:admin.firestore,storage:()=>({bucket:()=>({deleteFiles:async()=>{}})}),auth:()=>({deleteUser:async()=>{}})};
(async()=>{
 const uid='deletion-emulator',root=db.doc('users/'+uid),journal=db.doc('accountDeletions/'+uid);
 await root.set({plan:'starter'});
 await root.collection('businesses').doc('b').collection('listingDrafts').doc('missing-parent').collection('private').doc('receipt').set({secret:'fixture'});
 await db.doc('copyLibrary/deletion-test').set({uid,text:'fixture'});
 await db.doc('aiUsageLogs/deletion-test').set({uid,costUsd:1});
 const purge=createAccountDeletion({db,admin:fakeAdmin,getSquare:()=>{throw Error('Unexpected billing call');},revokeConnections:async()=>{}});
 await purge(uid);
 ok(!(await root.get()).exists,'user removed');
 ok(!(await root.collection('businesses').doc('b').collection('listingDrafts').doc('missing-parent').collection('private').doc('receipt').get()).exists,'recursive cleanup removes descendants below nonexistent parents');
 ok(!(await db.doc('copyLibrary/deletion-test').get()).exists,'owned saved copy removed');
 ok((await db.doc('aiUsageLogs/deletion-test').get()).exists,'accounting log retained');
 ok((await journal.get()).data().status==='completed','completion receipt persisted');
 // Reproduce the audit race: activity lands after the due-query snapshot
 // and before the actual transactional deletion claim.
 const active='retention-race-emulator',ref=db.doc('users/'+active),now=Date.now();
 await ref.set({plan:'starter',lastActiveAt:admin.firestore.Timestamp.fromMillis(1),dormancyWarnedAt:admin.firestore.Timestamp.fromMillis(1),dormancyPurgeAt:admin.firestore.Timestamp.fromMillis(2)});
 await ref.update({lastActiveAt:admin.firestore.Timestamp.fromMillis(now)});
 const safe=createAccountDeletion({db,admin:fakeAdmin,getSquare:()=>{throw Error('Unexpected billing');},revokeConnections:async()=>{throw Error('Deletion should have been cancelled');}});
 const result=await safe(active,{retention:{cutoff:now-1000,lastActiveAt:1,purgeAt:2}});
 ok(result.skipped&&(await ref.get()).exists,'transaction checks fresh state and preserves newly active user');
 ok(!(await db.doc('accountDeletions/'+active).get()).exists,'reactivation creates no deletion claim');
 console.log(checks+' actual Firestore account-deletion assertions passed.');
})().finally(()=>db.terminate()).catch(e=>{console.error(e);process.exitCode=1;});
