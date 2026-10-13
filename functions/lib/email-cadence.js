'use strict';
const {createHash,randomUUID}=require('node:crypto');
const DAY=24*60*60*1000;
// A shared recipient slot covers all businesses, blasts and routine email types.
// Reserve before contacting the provider. An ambiguous send retains its slot.
async function reserve(db,to,now=Date.now()) {
 const recipient=String(to||'').trim().toLowerCase();
 if(!recipient)throw Error('Email recipient is required.');
 const ref=db.collection('emailCadence').doc(createHash('sha256').update(recipient).digest('hex'));
 const token=randomUUID();
 return db.runTransaction(async tx=>{
  const previous=(await tx.get(ref)).data()||{};
  if(Number(previous.nextAllowedAt)>now)return null;
  tx.set(ref,{token,reservedAt:now,nextAllowedAt:now+DAY});
  return {ref,token};
 });
}
async function settle(db,slot,accepted,now=Date.now()) {
 return db.runTransaction(async tx=>{
  const state=(await tx.get(slot.ref)).data();
  if(state?.token!==slot.token)return;
  if(accepted)tx.update(slot.ref,{sentAt:now,nextAllowedAt:now+DAY});
  else tx.delete(slot.ref); // Only a definite provider rejection releases a slot.
 });
}
module.exports={reserve,settle,DAY};
