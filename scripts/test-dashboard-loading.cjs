'use strict';
// Execute the real dashboard scripts with deterministic account/read responses.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const html=fs.readFileSync('public/BlastyBiz-Dashboard.html','utf8');
async function run(mode){
 const dom=new JSDOM(html,{url:'https://blastybiz.com/BlastyBiz-Dashboard',runScripts:'outside-only'}),w=dom.window,context=dom.getInternalVMContext();
 let complete;const finished=new Promise(resolve=>complete=resolve);
 w.fetch=async()=>({text:async()=>''});w.console.error=()=>{};
 w.auth={authStateReady:async()=>{}};w.db={};
 w.onAuthStateChanged=(_,callback)=>callback({uid:'fixture',email:'fixture@example.invalid'}).then(complete,complete);
 w.doc=w.collection=(_, ...parts)=>parts.join('/');w.query=p=>p;w.orderBy=w.limit=()=>{};w.setDoc=async()=>{};
 w.getDoc=async p=>{
  if(p==='users/fixture'&&mode==='error')throw Error('permission-denied');
  if(p==='users/fixture'&&mode==='timeout')return new Promise(()=>{});
  return {exists:()=>true,data:()=>p==='users/fixture'?{plan:'agency',activeBusiness:'stale-business'}:{}};
 };
 w.getDocs=async p=>{
  if(p.endsWith('businesses')&&mode==='business-error')throw Error('unavailable');
  const docs=p.endsWith('businesses')?(mode==='empty'?[]:[{id:'b',data:()=>({name:'Existing Business'})}]):p.endsWith('campaigns')?[{id:'c',data:()=>({name:'Existing Campaign'})}]:[];
  return {empty:docs.length===0,docs};
 };
 const realTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms)=>realTimeout(fn,ms===15000?5:ms);
 vm.runInContext(fs.readFileSync('public/escape-utils.js','utf8'),context);
 for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
  if(/src=|importmap/.test(script[1]))continue;
  let code=script[2];if(script[1].includes('module'))code='(function(){'+code.replace(/import\s+[\s\S]*?\sfrom\s*['"][^'"]+['"];?/g,'')+'})()';
  vm.runInContext(code,context);
 }
 await finished;
 const label=w.document.getElementById('biz-dd-label'),campaigns=w.document.getElementById('dashboard-campaign-list'),status=w.document.getElementById('dashboard-load-status');
 assert(!label.textContent.includes('Loading'));assert(!campaigns.textContent.includes('Loading'));
 if(mode==='empty'){
  assert(!status.classList.contains('hidden'));assert.match(status.textContent,/fixture@example.invalid/);
  assert.match(status.textContent,/Use another account/);assert(status.compareDocumentPosition(campaigns)&w.Node.DOCUMENT_POSITION_FOLLOWING,'empty explanation precedes campaigns');
 }else if(['error','timeout','business-error'].includes(mode)){
  assert(!status.classList.contains('hidden'));assert.match(status.textContent,/Retry/);assert(!status.textContent.includes('No businesses'),'failed read is not an empty account');
 }else{assert.equal(label.textContent,'Existing Business');assert.match(campaigns.textContent,/Existing Campaign/);assert.equal(w.activeBizId,'b');}
 dom.window.close();
}
(async()=>{for(const mode of ['loaded','empty','error','timeout','business-error'])await run(mode);console.log('PASS dashboard: saved data, empty Google account, rejected reads, timed-out reads, stale business selection.');})().catch(e=>{console.error(e);process.exitCode=1;});
