'use strict';
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const dom=new JSDOM('<section id="billing"></section>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window;
 const requests=[],base={hasSubscription:true,status:'ACTIVE',version:'12',plan:'pro',billingPeriod:'monthly',paidThrough:'2026-12-10',actions:[],choices:[{plan:'pro',period:'monthly',amountCents:1900},{plan:'agency',period:'monthly',amountCents:4900}]};
 let result=base,accepted=false;
 w.fetch=async(url,opts)=>{requests.push({url,...JSON.parse(opts.body),authorization:opts.headers.Authorization});return {ok:true,json:async()=>structuredClone(result)};};
 w.confirm=()=>accepted;w.eval(fs.readFileSync('public/billing-account.js','utf8'));
 await w.BBBilling.mount(w.document.getElementById('billing'),{getIdToken:async()=>'fixture'});
 const el=id=>w.document.getElementById(id),tick=()=>new Promise(r=>setTimeout(r,10));
 assert.equal(requests[0].action,'status');assert.equal(requests[0].authorization,'Bearer fixture');assert(!el('billing-change').hidden);
 el('billing-plan').value='agency:monthly';el('billing-save').click();await tick();assert.equal(requests.length,1,'declined confirmation never changes billing');
 accepted=true;result={...base,actions:[{id:'swap',type:'SWAP_PLAN',effectiveDate:'2026-12-10'}]};el('billing-save').click();await tick();
 const change=requests.at(-1);assert.equal(change.action,'change');assert.equal(change.expectedVersion,'12');assert.equal(change.expectedPriceCents,4900);assert.equal(change.plan,'agency');assert(!('subscriptionId' in change));
 assert(el('billing-save').disabled);assert(el('billing-cancel').disabled);assert.match(el('billing-actions').textContent,/Undo scheduled change/);
 result={...base,pending:true};el('billing-refresh').click();await tick();assert(el('billing-change').hidden,'pending provider confirmation prevents another plan change');
 result={hasSubscription:false};el('billing-refresh').click();await tick();assert(el('billing-change').hidden);assert.match(el('billing-message').textContent,/Choose a plan/);
 dom.window.close();console.log('PASS billing controls: authenticated status, explicit reviewed amount, cancellation of confirmation, pending state and no client subscription ownership.');
})().catch(e=>{console.error(e);process.exitCode=1;});
