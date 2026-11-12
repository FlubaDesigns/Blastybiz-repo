'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {database,admin}=require('./lib/test-firestore.cjs');
const reward=require('../functions/lib/annual-reward');
const config={enabled:true,partnerId:'bb-partner',storeId:'blastybiz',channelId:'bb-rewards',catalogId:'bb-shirts',productId:'qrg_11111',countries:['US']};
const payment={id:'payment',status:'COMPLETED',orderId:'order',customerId:'customer',amountMoney:{amount:19900n,currency:'USD'}};
const subscription={id:'subscription',customerId:'customer',planVariationId:'variation',status:'ACTIVE'};
const claim={claimId:reward.claimId('owner'),plan:'pro',billingPeriod:'annual',paymentId:'payment',orderId:'order',customerId:'customer',planVariationId:'variation',amountCents:19900,status:'earned'};
const shipping={name:'Customer',address1:'One St',address2:'',city:'Englewood',region:'FL',postalCode:'34224',country:'US'};
function fixture(){
 const m=database({'users/owner':{email:'owner@example.test',annualProReward:claim},'subscriptions/owner':{squareSubscriptionId:'subscription'},'settings/qrReward':config,
  'users/owner/businesses/business':{businessName:'Owner business',website:'https://business.example/'},
  ['setupNudges/'+reward.queueId('owner')]:{kind:'annual-pro-reward',uid:'owner',sent:false}});
 const calls=[],emails=[],receipts=new Map();let billingAddress,now=100000,orders=0,refund=false,failApprove=false,rejectApprove=false,failEmail=false,catalogTitle='Current catalog title';
 const square={payments:{get:async()=>({payment:{...payment,billingAddress,...(refund?{refundedMoney:{amount:19900n}}:{})}})},subscriptions:{get:async()=>({subscription})}};
 const service=reward.createAnnualRewardService({db:m.db,admin,getSquare:async()=>square,readKey:async name=>{assert.equal(name,'QR_GEAR_BLASTYBIZ_PARTNER_API_KEY');return 'psk-'+'a'.repeat(64);},appUrl:'https://blastybiz.com',clock:()=>now,
 sendEmail:async input=>{emails.push(input);if(failEmail)throw Error('network interrupted');return {sent:true};},
 fetchImpl:async(url,options)=>{
  assert.equal(url.origin,'https://qrgear-c1ffd.web.app');assert.equal(url.searchParams.get('partnerId'),'bb-partner');assert.equal(options.redirect,'error');
  const body=options.body?JSON.parse(options.body):null;calls.push({path:url.pathname,body});
  if(url.pathname.endsWith('/products'))return {ok:true,json:async()=>({store:{id:'bb-partner',storeId:'blastybiz'},catalogId:'bb-shirts',products:[{id:'qrg_11111',storeId:'blastybiz',channelId:'bb-rewards',name:catalogTitle,description:'',availableColors:['Black'],availableVariants:[{color:'Black',size:'M'}]}]})};
  let result;
  if(url.pathname.endsWith('/preview')){
   result={...body,previewId:'preview-'+crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'),proofId:'proof-'+crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'),status:'ready',mockupUrl:'https://qrgear.test/personalized.png'};delete result.logoData;receipts.set(body.claimId,result);
  }else if(url.pathname.endsWith('/approve')){
   if(rejectApprove)return {ok:false,status:409,json:async()=>({error:'Variant unavailable'})};
   if(failApprove){failApprove=false;return {ok:false,status:503,json:async()=>({})};}
   result=receipts.get(body.claimId);assert.deepEqual(body.proofApproval,{approved:true,proofId:result.proofId});if(!result.orderId){orders++;result.orderId='canonical-order';result.status='ordered';}
  }else result=receipts.get(claim.claimId);
  return {ok:true,json:async()=>structuredClone(result)};
 }});
 return {m,service,calls,emails,orders:()=>orders,billing:v=>billingAddress=v,setRefund:v=>refund=v,failApprove:()=>failApprove=true,rejectApprove:()=>rejectApprove=true,failEmail:v=>failEmail=v,setNow:v=>now=v,title:v=>catalogTitle=v};
}
const preview={action:'preview',businessId:'business',color:'Black',size:'M',graphicChoice:'qr-only',websiteUrl:'https://attacker.invalid',productId:'unapproved'};
test('one shared rule excludes monthly Pro, both Agency periods and free plans',()=>{
 assert(reward.qualifies({plan:'pro',billingPeriod:'annual'}));
 for(const plan of ['pro','agency','trial','starter'])for(const billingPeriod of ['annual','monthly'])if(plan!=='pro'||billingPeriod!=='annual')assert(!reward.qualifies({plan,billingPeriod}));
});
test('signed payment transaction awards exactly once; a failed commit creates neither claim nor email',async()=>{
 const m=database({'users/owner':{email:'owner@example.test'}}),pending={plan:'pro',billingPeriod:'annual',amountCents:19900,subscriptionPlanId:'variation'};
 const award=()=>m.db.runTransaction(async tx=>{const user=(await tx.get(m.db.doc('users/owner'))).data();reward.awardInTransaction({tx,db:m.db,uid:'owner',pending,payment,eventId:'event',user,stamp:{stamp:100}});});
 m.failNext();await assert.rejects(award());assert(!m.get('users/owner').annualProReward);assert(!m.get('setupNudges/'+reward.queueId('owner')));
 await Promise.all([award(),award(),award()]);assert.equal(m.get('users/owner').annualProReward.paymentId,'payment');assert.equal(Object.keys(m.all()).filter(k=>k.startsWith('setupNudges/')).length,1);
});
test('insufficient paid amounts and Agency never enqueue a free shirt',async()=>{
 for(const pending of [{plan:'agency',billingPeriod:'annual',amountCents:19900},{plan:'pro',billingPeriod:'monthly',amountCents:19900},{plan:'pro',billingPeriod:'annual',amountCents:1},{plan:'pro',billingPeriod:'annual'}]){
  const m=database();await m.db.runTransaction(tx=>reward.awardInTransaction({tx,db:m.db,uid:'owner',pending,payment,eventId:'event',user:{},stamp:{stamp:100}}));assert.deepEqual(m.all(),{});
 }
});
test('actual provider identity, amount, refunds and annual subscription linkage are required',()=>{
 assert.doesNotThrow(()=>reward.verifyPayment(claim,payment,subscription));
 for(const bad of [{...payment,status:'FAILED'},{...payment,orderId:'other'},{...payment,customerId:'other'},{...payment,amountMoney:{amount:1n,currency:'USD'}},{...payment,refundedMoney:{amount:1n}}])assert.throws(()=>reward.verifyPayment(claim,bad,subscription));
 for(const bad of [null,{...subscription,customerId:'other'},{...subscription,planVariationId:'monthly'},{...subscription,status:'PENDING'}])assert.throws(()=>reward.verifyPayment(claim,payment,bad));
});
test('owned selection uses canonical live catalog and saved website, never request product or URL',async()=>{
 const f=fixture();let state=await f.service.manage('owner',preview);
 assert.equal(state.product.name,'Current catalog title');assert.equal(state.product.description,'');assert.equal(state.preview.websiteUrl,'https://business.example/');
 const request=f.calls.find(c=>c.path.endsWith('/preview')).body;assert.equal(request.productId,'qrg_11111');assert.equal(request.customerRef,crypto.createHash('sha256').update('owner').digest('hex'));
 f.title('Edited in QR Gear');state=await f.service.manage('owner',{action:'status'});assert.equal(state.product.name,'Edited in QR Gear');
 await assert.rejects(f.service.manage('owner',{...preview,businessId:'someone-else'}),{httpStatus:403});
 await assert.rejects(f.service.manage('owner',{...preview,color:'Unavailable'}),{httpStatus:409});
 await assert.rejects(f.service.manage('owner',{...preview,graphicChoice:'unknown'}),{httpStatus:400});
});
test('reopening and interrupted approval retain exact saved preview, shipping and one order',async()=>{
 const f=fixture(),state=await f.service.manage('owner',preview),body={action:'approve',approved:true,previewId:state.preview.previewId,proofId:state.preview.proofId,shipping};
 await assert.rejects(f.service.manage('owner',{...body,previewId:'stale'}),{httpStatus:409});assert.equal(f.orders(),0);
 f.failApprove();await assert.rejects(f.service.manage('owner',body));assert(f.m.get('users/owner').annualProReward.approvedAt);
 const resumed=await f.service.manage('owner',{action:'status',refresh:true});assert(resumed.approved);assert.deepEqual(resumed.shipping,shipping);
 const attempts=await Promise.allSettled([f.service.manage('owner',body),f.service.manage('owner',{...body,shipping:{...shipping,address1:'attacker change'}})]);assert(attempts.some(a=>a.status==='fulfilled'));
 assert.equal(f.orders(),1);assert.deepEqual(f.calls.filter(c=>c.path.endsWith('/approve')).at(-1).body.shipping,shipping);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/approve')).at(-1).body.authorization.paymentId,'payment');
 await assert.rejects(f.service.manage('owner',preview),{httpStatus:409});
});
test('refund and changed business destination block unfulfilled approval',async()=>{
 for(const changed of ['refund','website']){
  const f=fixture(),state=await f.service.manage('owner',preview);if(changed==='refund')f.setRefund(true);else await f.m.db.doc('users/owner/businesses/business').update({website:'https://new.example/'});
  await assert.rejects(f.service.manage('owner',{action:'approve',approved:true,previewId:state.preview.previewId,proofId:state.preview.proofId,shipping}));assert.equal(f.orders(),0);
 }
});
test('another account cannot reach the original reward or partner',async()=>{
 const f=fixture();await f.m.db.doc('users/other').set({plan:'pro',billingPeriod:'annual'});
 assert.equal((await f.service.manage('other',{action:'status',uid:'owner'})).eligible,false);assert.equal(f.calls.length,0);
 await assert.rejects(f.service.manage('other',{...preview,uid:'owner'}),{httpStatus:403});assert.equal(f.calls.length,0);
});
test('notification uses same owned page; concurrent sends and ambiguous retries share one provider key',async()=>{
 const f=fixture();await Promise.all([f.service.deliver('owner'),f.service.deliver('owner')]);assert.equal(f.emails.length,1);
 assert.match(f.emails[0].html,/https:\/\/blastybiz.com\/BlastyBiz-Rewards.html\?ownerUid=owner/);assert(!JSON.stringify(f.emails).includes('psk-'));
 const g=fixture();g.failEmail(true);await assert.rejects(g.service.deliver('owner'));g.failEmail(false);await g.service.deliver('owner');assert.equal(g.emails[0].idempotencyKey,g.emails[1].idempotencyKey);
 const h=fixture();h.failEmail(true);await assert.rejects(h.service.deliver('owner'));h.setNow(100000+24*3600000);await h.service.deliver('owner');assert.equal(h.emails.length,1);assert(h.m.get('setupNudges/'+reward.queueId('owner')).needsReview);
});
test('real webhook handler preserves signature checks and atomic claim ownership',async()=>{
 const m=database({'users/owner':{email:'owner@example.test'},'pendingCheckouts/order':{uid:'owner',plan:'pro',billingPeriod:'annual',subscriptionPlanId:'variation',amountCents:19900},'settings/pricing':{}});
 const signature='fixture-signature-key',c={exports:{},console:{warn(){},error(){}},Buffer,Date,Intl,process:{env:{SQUARE_WEBHOOK_SIGNATURE_KEY:signature}},require:p=>{
  if(p==='../lib/annual-reward')return reward;
  assert.equal(p,'../lib/shared');return {onRequest:(_,fn)=>fn,withAuth:fn=>fn,db:m.db,admin,crypto,userBizCol:uid=>m.db.collection('users/'+uid+'/businesses'),APP_BASE_URL:'https://blastybiz.com',sendResendEmail:async()=>{},};
 }};
 vm.runInNewContext(fs.readFileSync('functions/modules/payments.js','utf8'),c);
 const event={event_id:'event',type:'payment.updated',created_at:new Date().toISOString(),data:{object:{payment:{...payment,amountMoney:{amount:19900,currency:'USD'}}}}};
 const rawBody=Buffer.from(JSON.stringify(event)),url='https://us-central1-blastybiz-9523e.cloudfunctions.net/squareWebhook';
 const response=()=>({code:200,status(n){this.code=n;return this;},json(x){this.body=x;return this;}});
 let res=response();await c.exports.squareWebhook({rawBody,body:event,headers:{}},res);assert.equal(res.code,403);assert(!m.get('users/owner').annualProReward);
 const headers={'x-square-hmacsha256-signature':crypto.createHmac('sha256',signature).update(url+rawBody.toString()).digest('base64')};
 res=response();await c.exports.squareWebhook({rawBody,body:event,headers},res);assert.equal(res.code,200);assert.equal(m.get('users/owner').annualProReward.claimId,reward.claimId('owner'));
 await c.exports.squareWebhook({rawBody,body:event,headers},response());assert.equal(Object.keys(m.all()).filter(k=>k.startsWith('setupNudges/')).length,1);
});
test('two simultaneous first approvals use the same durable shipping address',async()=>{
 const f=fixture(),state=await f.service.manage('owner',preview);
 await Promise.allSettled([f.service.manage('owner',{action:'approve',approved:true,previewId:state.preview.previewId,proofId:state.preview.proofId,shipping}),f.service.manage('owner',{action:'approve',approved:true,previewId:state.preview.previewId,proofId:state.preview.proofId,shipping:{...shipping,address1:'Different street'}})]);
 const saved=f.m.get('users/owner').annualProReward.shipping;
 for(const call of f.calls.filter(c=>c.path.endsWith('/approve')))assert.deepEqual(call.body.shipping,saved);
 assert.equal(f.orders(),1);
});
test('claim binding cannot move partners; catalog metadata refresh does not invalidate a preview',async()=>{
 const f=fixture(),state=await f.service.manage('owner',preview);
 await f.m.db.doc('settings/qrReward').update({updatedAt:'new',terms:'Current terms'});
 await f.service.manage('owner',{action:'approve',approved:true,previewId:state.preview.previewId,proofId:state.preview.proofId,shipping});
 await f.m.db.doc('settings/qrReward').update({partnerId:'other-partner'});
 const count=f.calls.length;await assert.rejects(f.service.manage('owner',{action:'status',refresh:true}),{httpStatus:409});assert.equal(f.calls.length,count);
 assert.throws(()=>reward.verifyPayment({...claim,subscriptionId:'wrong'},payment,subscription));
 for(const patch of [{amountCents:0},{customerId:''},{planVariationId:''}])assert.throws(()=>reward.verifyPayment({...claim,...patch},payment,subscription));
});
test('a lost preview response is recovered from the same partner receipt',async()=>{
 const f=fixture(),state=await f.service.manage('owner',preview);
 await f.m.db.doc('users/owner').update({'annualProReward.preview':null});
 const resumed=await f.service.manage('owner',{action:'status',refresh:true});assert.equal(resumed.preview.previewId,state.preview.previewId);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/preview')).length,1);
});

test('confirmed unavailable variant without an order unlocks editing; uncertain approvals stay frozen',async()=>{
 const f=fixture(),state=await f.service.manage('owner',preview);f.rejectApprove();
 await assert.rejects(f.service.manage('owner',{action:'approve',approved:true,previewId:state.preview.previewId,proofId:state.preview.proofId,shipping}),{httpStatus:409});
 assert.equal(f.m.get('users/owner').annualProReward.approvedAt,null);assert.equal(f.orders(),0);
 await f.service.manage('owner',preview);
});

test('only the verified payment supplies optional billing prefill; missing data stays editable',async()=>{
 const f=fixture();assert.equal((await f.service.manage('owner',{action:'status'})).billingAddress,null);
 f.billing({firstName:'Pat',lastName:'Buyer',addressLine1:'Billing St',addressLine2:'Unit 2',addressLine3:'Floor 3',locality:'Town',administrativeDistrictLevel1:'FL',postalCode:'12345',country:'US'});
 const status=await f.service.manage('owner',{action:'status',billingAddress:{address1:'Untrusted'}});
 assert.deepEqual(status.billingAddress,{name:'Pat Buyer',address1:'Billing St',address2:'Unit 2, Floor 3',city:'Town',region:'FL',postalCode:'12345',country:'US'});assert.match(status.terms,/BlastyBiz covers shipping/);
 f.setRefund(true);await assert.rejects(f.service.manage('owner',{action:'status'}),{httpStatus:403});
});

test('proof approval is explicit and bound to individual text color choices',async()=>{
 const f=fixture(),first=await f.service.manage('owner',preview);
 for(const patch of [{approved:false,proofId:first.preview.proofId},{approved:true},{approved:true,proofId:'stale'}])await assert.rejects(f.service.manage('owner',{action:'approve',previewId:first.preview.previewId,shipping,...patch}));
 assert.equal(f.orders(),0);assert(!f.m.get('users/owner').annualProReward.approvedAt);
 // The QR-only recipe ignores text controls and still requires its own proof.
 const ignored=await f.service.manage('owner',{...preview,textColorMode:'dark'});
 assert.equal(ignored.preview.textColorMode,'auto');
 assert.equal(ignored.preview.proofId,first.preview.proofId);
});
