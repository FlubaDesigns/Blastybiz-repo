'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {database,admin:baseAdmin}=require('./lib/test-firestore.cjs');
const {createSubscriptionManagement}=require('../functions/lib/subscription-management');
const admin={firestore:{...baseAdmin.firestore,Timestamp:{fromMillis:stamp=>({stamp})}}};
function fixture(){
 const data=database({'users/u':{plan:'pro'},'users/u/businesses/b':{currentPlan:'pro'},'subscriptions/u':{uid:'u',squareCustomerId:'customer',squareSubscriptionId:'subscription',plan:'pro',billingPeriod:'monthly',status:'active'}});
 const subscription={id:'subscription',customerId:'customer',planVariationId:'pro-monthly',status:'ACTIVE',version:1n,chargedThroughDate:'2026-12-10'},actions=[],calls=[];
 const square={subscriptions:{get:async()=>({subscription:{...subscription},actions:[...actions]}),cancel:async input=>{calls.push(['cancel',input]);subscription.canceledDate='2026-12-10';subscription.version++;actions.push({id:'cancel',type:'CANCEL',effectiveDate:'2026-12-10'});return {subscription};},swapPlan:async input=>{calls.push(['change',input]);subscription.version++;actions.push({id:'change',type:'SWAP_PLAN',newPlanVariationId:input.newPlanVariationId,effectiveDate:'2026-12-10'});return {subscription};},deleteAction:async input=>{calls.push(['undo',input]);actions.splice(actions.findIndex(a=>a.id===input.actionId),1);delete subscription.canceledDate;subscription.version++;return {subscription};}}};
 const prices={proMonthly:19,proAnnual:199,agencyMonthly:99,agencyAnnual:999,planIds:{pro:{monthly:'pro-monthly',annual:'pro-annual'},agency:{monthly:'agency-monthly',annual:'agency-annual'}}};
 const manage=createSubscriptionManagement({db:data.db,admin,getSquare:async()=>square,loadPricing:async()=>prices,priceCents:p=>Math.round(p*100),checkoutVariationId:async(_,id)=>id,appUrl:'https://blastybiz.com'});
 return {data,square,subscription,actions,calls,prices,manage,run:body=>manage('u',{expectedVersion:String(subscription.version),requestId:crypto.randomUUID(),...body})};
}
test('status is owner-scoped and exposes server prices without changing access',async()=>{
 const f=fixture(),r=await f.run({action:'status',subscriptionId:'someone-else'});assert.equal(r.choices.length,4);assert.equal(r.plan,'pro');assert.equal(f.calls.length,0);assert.equal(f.data.get('users/u').plan,'pro');
 f.subscription.customerId='other';await assert.rejects(()=>f.run({action:'cancel'}),e=>e.httpStatus===503);assert.equal(f.calls.length,0);
});
test('cancellation is confirmed for paid-period end and does not revoke access',async()=>{
 const f=fixture(),r=await f.run({action:'cancel'});assert.equal(r.cancelDate,'2026-12-10');assert.equal(f.calls.length,1);assert.equal(f.data.get('users/u').plan,'pro');
 await f.run({action:'cancel'});assert.equal(f.calls.length,1);await f.run({action:'undo',actionId:'cancel'});assert.equal(f.subscription.canceledDate,undefined);
});
test('plan changes require exact reviewed price and version; pending changes can be undone',async()=>{
 const f=fixture();await assert.rejects(()=>f.run({action:'change',plan:'agency',period:'monthly',expectedPriceCents:1}),e=>e.httpStatus===409);
 await assert.rejects(()=>f.run({action:'cancel',expectedVersion:'old'}),e=>e.httpStatus===409);assert.equal(f.calls.length,0);
 const r=await f.run({action:'change',plan:'agency',period:'monthly',expectedPriceCents:9900});assert.equal(r.actions[0].type,'SWAP_PLAN');assert.equal(f.data.get('users/u').plan,'pro');
 await assert.rejects(()=>f.run({action:'cancel'}),e=>e.httpStatus===409);await f.run({action:'undo',actionId:'change'});assert.equal(f.actions.length,0);
});
test('concurrent clicks and ambiguous provider results cannot repeat a mutation',async()=>{
 const f=fixture();let release;const wait=new Promise(r=>release=r);f.square.subscriptions.cancel=async()=>{f.calls.push(['cancel']);await wait;throw Error('Response lost');};
 const first=f.run({action:'cancel'});await new Promise(r=>setTimeout(r,10));await assert.rejects(()=>f.run({action:'cancel'}),e=>e.httpStatus===409);release();await assert.rejects(first,e=>e.httpStatus===503);
 await assert.rejects(()=>f.run({action:'cancel'}),e=>e.httpStatus===409);assert.equal(f.calls.length,1);assert.equal((await f.run({action:'status'})).pending,true);
});
test('provider rejection never reports confirmed cancellation',async()=>{
 const f=fixture();f.square.subscriptions.cancel=async()=>({errors:[{code:'FAILED'}]});await assert.rejects(()=>f.run({action:'cancel'}),e=>e.httpStatus===502);assert.equal(f.data.get('subscriptions/u').billingChange.state,'failed');assert.equal(f.data.get('users/u').plan,'pro');
});
test('verified billing events apply a scheduled plan once; stale events cannot undo it',async()=>{
 const f=fixture();await f.run({action:'change',plan:'agency',period:'monthly',expectedPriceCents:9900});
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('functions/modules/payments.js','utf8');
 const c={db:f.data.db,admin,crypto,userBizCol:uid=>f.data.db.collection('users').doc(uid).collection('businesses')};
 vm.runInNewContext(source.slice(source.indexOf('async function applySquareEvent('),source.indexOf('exports.squareWebhook =')),c);
 const event={event_id:'applied',type:'subscription.updated',created_at:'2026-12-10T00:00:00Z',data:{object:{subscription:{id:'subscription',customer_id:'customer',status:'ACTIVE',plan_variation_id:'agency-monthly',version:3,created_at:'2026-01-01T00:00:00Z'}}}};
 await c.applySquareEvent(event);assert.equal(f.data.get('users/u').plan,'agency');assert.equal(f.data.get('users/u/businesses/b').currentPlan,'agency');assert.equal(f.data.get('subscriptions/u').billingChange.state,'applied');
 await c.applySquareEvent({...event,event_id:'old',data:{object:{subscription:{...event.data.object.subscription,status:'CANCELED',version:2}}}});assert.equal(f.data.get('users/u').plan,'agency');
 await c.applySquareEvent({...event,event_id:'canceled',data:{object:{subscription:{...event.data.object.subscription,status:'CANCELED',version:4}}}});assert.equal(f.data.get('users/u').plan,'starter');
});
test('installed Square SDK serializes static plan swap and action deletion',async()=>{
 const {SquareClient}=require('../functions/node_modules/square');const wire=[];
 const client=new SquareClient({token:'fixture',fetcher:async args=>{wire.push(args);return {ok:true,body:{subscription:{id:'subscription'}},headers:{}};}});
 await client.subscriptions.swapPlan({subscriptionId:'subscription',newPlanVariationId:'agency-monthly'},{maxRetries:0});await client.subscriptions.deleteAction({subscriptionId:'subscription',actionId:'change'},{maxRetries:0});
 assert.equal(wire[0].body.new_plan_variation_id,'agency-monthly');assert(wire[1].url.endsWith('/subscriptions/subscription/actions/change'));
});
