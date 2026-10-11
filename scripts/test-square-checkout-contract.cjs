'use strict';
// Actual handlers and Square 44.2.0 serialization, with no network or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const { SquareClient } = require('../functions/node_modules/square');
const { database, admin: baseAdmin } = require('./lib/test-firestore.cjs');
const source = fs.readFileSync('functions/modules/payments.js', 'utf8');
const admin = { ...baseAdmin, firestore: { ...baseAdmin.firestore, Timestamp: { fromMillis: stamp => ({stamp}) } } };
const defaults = { proMonthly: 19, proAnnual: 199, agencyMonthly: 99, agencyAnnual: 999 };
const response = () => ({code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
const variation = (id='variation', cents=1900, cadence='MONTHLY') => ({type:'SUBSCRIPTION_PLAN_VARIATION',id,subscriptionPlanVariationData:{name:'Plan',phases:[{cadence,ordinal:0n,pricing:{type:'STATIC',priceMoney:{amount:BigInt(cents),currency:'USD'}}}]}});
function fixture({pricing={squareProMonthlyPlanId:'variation'}, location='location', object=variation(), relatedObjects=[], failAt=0, badLink=false}={}) {
  const m=database({'settings/pricing':pricing}), calls=[], catalogCalls=[], gets=[];
  const square={catalog:{object:{get:async req=>{gets.push(req);return {object,relatedObjects};},upsert:async req=>{
    catalogCalls.push(req); if(catalogCalls.length===failAt)return {errors:[{code:'FAILED'}]};
    return {catalogObject:{...req.object,id:'catalog-'+catalogCalls.length}};
  }}},checkout:{paymentLinks:{create:async req=>{calls.push(req);return badLink?{paymentLink:{url:'https://example.invalid'}}:{paymentLink:{url:'https://example.invalid',orderId:'order'}};}}}};
  const c={exports:{},console:{error(){},warn(){}},process:{env:{SQUARE_LOCATION_ID:location}},Date,Intl,Buffer,require:p=>{assert.equal(p,'../lib/shared');return {onRequest:(_,f)=>f,withAuth:f=>f,db:m.db,admin,crypto,getSquare:()=>square,checkUidRateLimit:async()=>true,APP_BASE_URL:'https://blastybiz.com',getPlanConfig:async()=>({retention:{}})};}};
  vm.runInNewContext(source,c);
  return {m,c,calls,catalogCalls,gets,square,run:async(body={plan:'pro'},endpoint='createCheckoutSession')=>{const r=response();await c.exports[endpoint]({body},r,{uid:'user',email:'user@example.invalid'});return r;}};
}
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
  for(const plan of ['pro','agency'])for(const period of ['monthly','annual'])await test(`${plan} ${period} uses canonical cents, location, variation and durable linkage`,async()=>{
    const field=plan+(period==='annual'?'Annual':'Monthly'), price=defaults[field]+0.25;
    const key='square'+field[0].toUpperCase()+field.slice(1)+'PlanVariationId';
    const f=fixture({pricing:{[field]:price,[key]:'variation'},object:variation('variation',Math.round(price*100),period==='annual'?'ANNUAL':'MONTHLY')});
    assert.equal((await f.run({plan,billingPeriod:period,amount:1,locationId:'attacker',subscriptionPlanId:'attacker',returnPath:'https://attacker.invalid'})).code,200);
    const req=f.calls[0];assert.equal(req.quickPay.priceMoney.amount,BigInt(Math.round(price*100)));assert.equal(req.quickPay.priceMoney.currency,'USD');assert.equal(req.quickPay.locationId,'location');assert.equal(req.checkoutOptions.subscriptionPlanId,'variation');assert.match(req.checkoutOptions.redirectUrl,/BlastyBiz-Dashboard/);assert.equal(f.m.get('pendingCheckouts/order').subscriptionPlanId,'variation');
  });
  await test('modern field takes precedence over legacy ID; allowed return path preserved',async()=>{const f=fixture({pricing:{squareProMonthlyPlanVariationId:'variation',squareProMonthlyPlanId:'legacy'}});await f.run({plan:'pro',returnPath:'/BlastyBiz-Plan.html?from=publish'});assert.equal(f.gets[0].objectId,'variation');assert.equal(f.calls[0].checkoutOptions.redirectUrl,'https://blastybiz.com/BlastyBiz-Plan.html?from=publish');});
  await test('legacy parent resolves exactly one matching variation without writes',async()=>{const f=fixture({pricing:{squareProMonthlyPlanId:'parent'},object:{type:'SUBSCRIPTION_PLAN',id:'parent',subscriptionPlanData:{subscriptionPlanVariations:[variation()]}}});assert.equal((await f.run()).code,200);assert.equal(f.calls[0].checkoutOptions.subscriptionPlanId,'variation');assert.equal(f.catalogCalls.length,0);});
  await test('legacy related variation is resolved and duplicates deduplicated',async()=>{const v=variation();v.subscriptionPlanVariationData.subscriptionPlanId='parent';const f=fixture({pricing:{squareProMonthlyPlanId:'parent'},object:{type:'SUBSCRIPTION_PLAN',id:'parent',subscriptionPlanData:{subscriptionPlanVariations:[v]}},relatedObjects:[v]});assert.equal((await f.run()).code,200);});
  for(const object of [variation('variation',2000),variation('variation',1900,'ANNUAL'),{...variation(),isDeleted:true},{type:'SUBSCRIPTION_PLAN',id:'variation',subscriptionPlanData:{subscriptionPlanVariations:[variation('a'),variation('b')]}},{type:'SUBSCRIPTION_PLAN',id:'variation',subscriptionPlanData:{phases:[{cadence:'MONTHLY'}]}}])await test('invalid, mismatched or ambiguous catalog fails closed',async()=>{const f=fixture({object});assert.equal((await f.run()).code,503);assert.equal(f.calls.length,0);});
  for(const price of [0,-1,'19',19.001,Infinity])await test('invalid configured price is rejected: '+price,async()=>{const f=fixture({pricing:{proMonthly:price,squareProMonthlyPlanId:'variation'}});assert.equal((await f.run()).code,503);assert.equal(f.calls.length,0);});
  await test('missing location prevents provider request',async()=>{const f=fixture({location:''});assert.equal((await f.run()).code,503);assert.equal(f.calls.length,0);});
  await test('incomplete payment link never creates linkage or returns success',async()=>{const f=fixture({badLink:true});assert.equal((await f.run()).code,502);assert.equal(f.m.get('pendingCheckouts/order'),undefined);});
  await test('repeat checkout is idempotent; changed return path gets a distinct key',async()=>{const f=fixture();await f.run();await f.run();assert.equal(f.calls[0].idempotencyKey,f.calls[1].idempotencyKey);await f.run({plan:'pro',returnPath:'/BlastyBiz-Plan.html'});assert.notEqual(f.calls[0].idempotencyKey,f.calls[2].idempotencyKey);assert.equal(f.m.get('pendingCheckouts/order').uid,'user');});
  await test('admin creates parent plus static variation for all four prices atomically',async()=>{const f=fixture();const r=await f.run(defaults,'adminUpdatePricing');assert.equal(r.code,200);assert.equal(f.catalogCalls.length,8);for(let i=0;i<8;i+=2){const p=f.catalogCalls[i].object,v=f.catalogCalls[i+1].object;assert.equal(p.type,'SUBSCRIPTION_PLAN');assert.equal(p.subscriptionPlanData.phases,undefined);assert.equal(v.type,'SUBSCRIPTION_PLAN_VARIATION');assert.equal(v.subscriptionPlanVariationData.subscriptionPlanId,'catalog-'+(i+1));assert.equal(v.subscriptionPlanVariationData.phases[0].pricing.type,'STATIC');}assert.equal(f.m.get('settings/pricing').squareProMonthlyPlanVariationId,'catalog-2');assert.equal(f.m.get('settings/pricing').squareProMonthlyPlanId,'catalog-2');});
  await test('partial Square catalog failure preserves all configured pricing',async()=>{const pricing={proMonthly:19,squareProMonthlyPlanId:'old'},f=fixture({pricing,failAt:6});assert.equal((await f.run(defaults,'adminUpdatePricing')).code,502);assert.deepEqual(f.m.get('settings/pricing'),pricing);});
  for(const price of ['19oops',0,19.001])await test('admin invalid price is rejected before catalog mutation: '+price,async()=>{const f=fixture();assert.equal((await f.run({...defaults,proMonthly:price},'adminUpdatePricing')).code,400);assert.equal(f.catalogCalls.length,0);});
  await test('actual Square SDK serializes required checkout and catalog fields',async()=>{
    const wire=[];const sdk=new SquareClient({token:'test-only',fetcher:async args=>{wire.push(args);return {ok:true,body:args.url.includes('payment-links')?{payment_link:{id:'link',order_id:'order',url:'https://example.invalid'}}:{catalog_object:{...args.body.object,id:'catalog'}},headers:{}};}});
    const f=fixture();await f.run();await sdk.checkout.paymentLinks.create(f.calls[0]);assert.equal(wire[0].body.quick_pay.location_id,'location');assert.equal(String(wire[0].body.quick_pay.price_money.amount),'1900');assert.equal(wire[0].body.checkout_options.subscription_plan_id,'variation');
    await f.run(defaults,'adminUpdatePricing');await sdk.catalog.object.upsert(f.catalogCalls[1]);assert.equal(wire[1].body.object.type,'SUBSCRIPTION_PLAN_VARIATION');assert.equal(wire[1].body.object.subscription_plan_variation_data.phases[0].pricing.type,'STATIC');
  });
  console.log(`${count} Square checkout contract tests passed (offline).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
