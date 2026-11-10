'use strict';
// Account controls use the existing Square subscription and pricing owners.
// Provider responses describe pending changes; only billing events change access.
const {randomUUID}=require('node:crypto');
const fail=(status,message)=>{throw Object.assign(Error(message),{httpStatus:status});};
const apiOptions={timeoutInSeconds:20,maxRetries:0};
function createSubscriptionManagement({db,admin,getSquare,loadPricing,checkoutVariationId,priceCents,appUrl}) {
 return async function manage(uid,body={}) {
   const action=body.action||'status';
   if(!['status','cancel','change','undo'].includes(action))fail(400,'Unknown billing action.');
   const ref=db.collection('subscriptions').doc(uid),stored=await ref.get(),owned=stored.data();
   if(!owned)return {hasSubscription:false,url:appUrl+'/BlastyBiz-Choose-Plan.html',message:'Choose a plan to subscribe.'};
   if(!owned.squareSubscriptionId)return {hasSubscription:true,url:appUrl+'/BlastyBiz-Account.html?billing=1',pending:true,message:'Payment confirmation is still being linked. Refresh shortly.'};
   const square=await getSquare(),pricing=await loadPricing();
   async function retrieve(){
     const result=await square.subscriptions.get({subscriptionId:owned.squareSubscriptionId,include:'actions'},apiOptions);
     const subscription=result.subscription;
     if(result.errors?.length||!subscription||subscription.id!==owned.squareSubscriptionId||!owned.squareCustomerId||subscription.customerId!==owned.squareCustomerId)fail(503,'We could not verify your subscription. Refresh before making a change.');
     return {subscription,actions:result.actions||subscription.actions||[]};
   }
   let current=await retrieve();
   const choices=[];
   for(const plan of ['pro','agency'])for(const period of ['monthly','annual']){
     const amount=priceCents(pricing[plan+(period==='annual'?'Annual':'Monthly')]);
     if(amount&&pricing.planIds[plan][period])choices.push({plan,period,amountCents:amount});
   }
   const matches=(change,state)=>change?.action==='cancel'?state.subscription.canceledDate||state.actions.some(a=>a.type==='CANCEL'):
     change?.action==='change'?state.subscription.planVariationId===change.targetVariationId||state.actions.some(a=>a.type==='SWAP_PLAN'&&a.newPlanVariationId===change.targetVariationId):
     change?.action==='undo'?!state.actions.some(a=>a.id===change.actionId):false;
   const summary=()=>({hasSubscription:true,url:appUrl+'/BlastyBiz-Account.html?billing=1',plan:owned.plan,billingPeriod:owned.billingPeriod,
     status:current.subscription.status,version:String(current.subscription.version??''),paidThrough:current.subscription.chargedThroughDate||null,cancelDate:current.subscription.canceledDate||null,
     actions:current.actions.filter(a=>['CANCEL','SWAP_PLAN'].includes(a.type)).map(a=>({id:a.id,type:a.type,effectiveDate:a.effectiveDate||null})),choices,
     pending:['pending','uncertain'].includes(owned.billingChange?.state)&&!matches(owned.billingChange,current)});
   if(action==='status')return summary();
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(body.requestId||''))fail(400,'A billing request identifier is required.');
   if(body.expectedVersion!==String(current.subscription.version??''))fail(409,'Your subscription changed. Refresh and review it again.');
   if(!['ACTIVE','PAUSED'].includes(current.subscription.status))fail(409,'This subscription is no longer active. Refresh to see its current status.');
   const intent={action,requestId:body.requestId};
   if(action==='change') {
     const choice=choices.find(c=>c.plan===body.plan&&c.period===body.period);
     if(!choice||body.expectedPriceCents!==choice.amountCents)fail(409,'Pricing changed or is unavailable. Refresh and review the current price.');
     intent.plan=choice.plan;intent.billingPeriod=choice.period;intent.amountCents=choice.amountCents;
     intent.targetVariationId=await checkoutVariationId(square,pricing.planIds[choice.plan][choice.period],choice.period,choice.amountCents);
     if(current.subscription.planVariationId===intent.targetVariationId)return summary();
   }
   if(action==='undo') {
     const selected=current.actions.find(a=>a.id===body.actionId&&['CANCEL','SWAP_PLAN'].includes(a.type));
     if(!selected)fail(409,'That scheduled change is no longer available. Refresh your subscription.');
     intent.actionId=selected.id;
   }
   if(action==='cancel'&&matches(intent,current))return summary();
   if(action==='change'&&matches(intent,current))return summary();
   if(action!=='undo'&&current.actions.some(a=>['CANCEL','SWAP_PLAN'].includes(a.type)))fail(409,'Undo the existing scheduled change before choosing another.');
   const token=randomUUID();
   const claimed=await db.runTransaction(async tx=>{
     const fresh=(await tx.get(ref)).data();
     if(fresh?.squareSubscriptionId!==owned.squareSubscriptionId||fresh.squareCustomerId!==owned.squareCustomerId)fail(409,'Subscription changed. Refresh before continuing.');
     const previous=fresh.billingChange;
     if(previous?.requestId===intent.requestId){
       if(previous.action!==intent.action||previous.targetVariationId!==intent.targetVariationId||previous.actionId!==intent.actionId)fail(409,'This request belongs to another billing change.');
       if(previous.state!=='failed')return false;
     }
     if(['pending','uncertain'].includes(previous?.state)&&!matches(previous,current))fail(409,'The previous billing request is awaiting provider confirmation. Refresh shortly.');
     tx.update(ref,{billingChange:{...intent,token,state:'pending',createdAt:admin.firestore.FieldValue.serverTimestamp()}});return true;
   });
   if(!claimed)return {...summary(),pending:true,message:'This billing request is already recorded. Refresh for confirmation.'};
   try {
     const request={subscriptionId:owned.squareSubscriptionId};
     const result=action==='cancel'?await square.subscriptions.cancel(request,apiOptions):action==='undo'?await square.subscriptions.deleteAction({...request,actionId:intent.actionId},apiOptions):
       await square.subscriptions.swapPlan({...request,newPlanVariationId:intent.targetVariationId},apiOptions);
     if(result.errors?.length)throw Object.assign(Error('Provider rejected the billing change.'),{definite:true});
     current=await retrieve();
     if(!matches(intent,current))throw Error('Provider confirmation pending.');
     await db.runTransaction(async tx=>{const fresh=(await tx.get(ref)).data();if(fresh?.billingChange?.token===token&&fresh.billingChange.state!=='applied')tx.update(ref,{'billingChange.state':'confirmed'});});
     return {...summary(),pending:false,message:action==='undo'?'Scheduled change removed.':'Change confirmed for the end of your billing period. Your current access remains available until then.'};
   }catch(e){
     await db.runTransaction(async tx=>{const fresh=(await tx.get(ref)).data();if(fresh?.billingChange?.token===token&&fresh.billingChange.state==='pending')tx.update(ref,{'billingChange.state':e.definite?'failed':'uncertain'});});
     fail(e.definite?502:503,e.definite?'The provider could not accept this change. Your current subscription is unchanged.':'Confirmation is pending. Refresh your subscription before making another request.');
   }
 };
}
module.exports={createSubscriptionManagement};
