'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(setImmediate);};
(async()=>{
 const html=fs.readFileSync('public/BlastyBiz-Account.html','utf8');
 const code=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)][0][1].replace(/^import .*;$/gm,'');
 for(const pending of [true,false]){
  const dom=new JSDOM(html,{url:'https://example.invalid/BlastyBiz-Account.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
  const user={uid:'u',email:'test@example.invalid',getIdToken:async()=>'fixture',getIdTokenResult:async()=>({claims:{}})};
  Object.assign(w,{auth:{authStateReady:async()=>{}},db:{},onAuthStateChanged:(_,cb)=>cb(user),doc:()=>{},getDoc:async()=>{throw Error('permission-denied');},fetch:async url=>({status:409,ok:false,json:async()=>url.includes('createCheckoutSession')?{code:'EXISTING_SUBSCRIPTION',error:'To change your plan or billing period, contact support@blastybiz.com.'}:{code:pending?'ACCOUNT_DELETION_PENDING':'OTHER'}})});
  w.eval(code);await settle();
  const status=w.document.getElementById('acct-deletion-status');assert.equal(status.hidden,false);
  assert.match(status.textContent,pending?/Deletion in progress/:/could not be loaded/);
  if(pending){assert.equal(w.document.querySelector('.delete-account-btn').textContent,'Retry Delete Account');assert.equal(w.document.getElementById('acct-billing-btn').style.display,'none');}
  w.openDeleteModal();assert.equal(w.document.getElementById('delete-overlay').style.display,'flex');
  await w.startCheckout('agency');const toast=w.document.getElementById('toast');assert.match(toast.textContent,/support@blastybiz.com/);assert(toast.classList.contains('show'));assert.equal(toast.style.whiteSpace,'normal');
  dom.window.close();
 }
 console.log('PASS actual Account DOM: deletion retry remains available; permission errors are not misidentified; checkout support message is visible and wraps on mobile.');
})().catch(e=>{console.error(e);process.exitCode=1;});
