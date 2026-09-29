'use strict';
function rollupCosts(rows) {
 const business={},accounts={},copyBehavior={};
 for(const r of rows) {
   const cost=Number.isFinite(r.costUsd)?r.costUsd:0,key=(r.uid||'system')+'/'+(r.businessId||'unattributed');
   const b=business[key]||={uid:r.uid,businessId:r.businessId||null,totalCostUsd:0,callCount:0,purpose:{}};
   b.totalCostUsd+=cost;b.callCount++;
   const p=b.purpose[r.purpose||'unattributed']||={costUsd:0,callCount:0};p.costUsd+=cost;p.callCount++;
   const tier=['trial','starter','free'].includes(r.tier)?'free':r.tier||'unknown';
   const a=accounts[(r.uid||'system')+'/'+tier]||={costUsd:0,tier};a.costUsd+=cost;
   const x=copyBehavior[r.copyBehavior||'unattributed']||={costUsd:0,callCount:0};x.costUsd+=cost;x.callCount++;
 }
 const tiers={};
 for(const tier of ['free','pro','agency','unknown']) {
   const values=Object.values(accounts).filter(a=>a.tier===tier).map(a=>a.costUsd).sort((a,b)=>a-b);
   tiers[tier]={accounts:values.length,meanCostUsd:values.length?values.reduce((a,b)=>a+b,0)/values.length:0,p90CostUsd:values.length?values[Math.ceil(values.length*.9)-1]:0};
 }
 return {businesses:Object.values(business),tiers,copyBehavior,note:'Tier statistics cover accounts with logged calls; stored historical costs are summed without repricing.'};
}
module.exports={rollupCosts};
