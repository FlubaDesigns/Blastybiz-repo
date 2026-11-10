'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/ai-generation.js','utf8');
function fixture(fetch){const rows=new Map(),c={window:{_bbUid:'u'},fetch,crypto:require('node:crypto'),Response,AbortController,Date,setTimeout,clearTimeout,sessionStorage:{getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)}};vm.runInNewContext(source,c);return {rows,run:body=>c.window.BBAI.fetch('/adaptListing',{method:'POST',body:JSON.stringify({listing:{businessId:'b',campaignId:'c',adId:'a',offer:'Offer'},platforms:[{id:'facebook'}],...body})})};}
test('concurrent browser requests share one provider request and reusable responses',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return Response.json({adaptations:{facebook:'Copy'},status:'complete'});});const responses=await Promise.all([f.run(),f.run()]);assert.equal(calls,1);assert.equal((await responses[0].json()).adaptations.facebook,'Copy');assert.equal((await responses[1].json()).status,'complete');assert.equal(f.rows.size,0);
});
test('network interruption preserves request ID across retry, changed content gets a new ID',async()=>{
 const ids=[];let fail=true;const f=fixture(async(_,o)=>{ids.push(JSON.parse(o.body).listing.requestId);if(fail)throw Error('offline');return Response.json({status:'complete'});});await assert.rejects(()=>f.run(),/request is saved/);fail=false;await f.run();assert.equal(new Set(ids).size,1);await f.run({listing:{offer:'Another'}});assert.notEqual(ids.at(-1),ids[0]);
});
