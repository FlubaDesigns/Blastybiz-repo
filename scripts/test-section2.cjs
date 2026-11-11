'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const read=p=>fs.readFileSync(p,'utf8');
const inline=(html,needle)=>[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(m=>m[2].includes(needle))[2];
const turn=()=>new Promise(r=>setImmediate(r));
async function run({source=read}={}){
 const login=source('public/BlastyBiz-Login.html');
 // Both auth timing orders and stale returning flags must honor explicit intent, with no mascot.
 for(const query of ['?start=guided','?start=forms','?intent=create','?intent=signin&start=guided',''])for(const ready of [false,true])for(const returning of [false,true]){
  const dom=new JSDOM(login,{url:'https://blastybiz.com/BlastyBiz-Login'+query,runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
  if(returning){w.localStorage.setItem('bb_guide_done','1');w.localStorage.setItem('bb_start_choice','guided');}
  if(ready)w.document.getElementById('auth-card-wrap').classList.add('ready');
  w.fetch=async()=>({ok:false});
  // No guidance library: core entry intent must still work if optional guidance fails.
  try{w.eval(inline(login,'function switchTab'));}catch(error){assert.match(error.message,/BBBlasty/);}
  const signup=!!query&&!query.includes('intent=signin');
  assert(w.document.getElementById('form-'+(signup?'signup':'signin')).classList.contains('active'),query);
  w.document.getElementById('auth-card-wrap').classList.add('ready');await turn();
  w.switchTab('signin');assert(w.document.getElementById('form-signin').classList.contains('active'));
  dom.window.close();
 }
 // Actual optional guide, initialized before or after auth, cannot lock the forms route.
 for(const ready of [false,true]){
  const dom=new JSDOM(login,{url:'https://blastybiz.com/BlastyBiz-Login?start=forms',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
  w.fetch=async()=>({ok:false});w.HTMLElement.prototype.scrollIntoView=function(){};
  for(const file of ['business-form.js','blasty-registry.js','blasty-events.js','blasty-guidance.js'])w.eval(source('public/'+file));
  if(ready)w.document.getElementById('auth-card-wrap').classList.add('ready');w.eval(inline(login,'function switchTab'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));w.document.getElementById('auth-card-wrap').classList.add('ready');await turn();
  assert.equal(w.document.querySelectorAll('.bb-field-blur').length,0);assert(!w.document.getElementById('auth-card-wrap').classList.contains('bb-unpicked'));
  w.document.getElementById('login-help').click();assert(w._loginGuideEnabled);w.document.getElementById('login-help').click();assert(!w._loginGuideEnabled);assert.equal(w.document.querySelectorAll('.bb-field-blur').length,0);dom.window.close();
 }
 const home=new JSDOM(source('public/BlastyBiz-Home.html'),{url:'https://blastybiz.com',runScripts:'outside-only'}),w=home.window;
 for(const file of ['escape-utils.js','platforms-authority.js','post-preview.js','home-demo.js'])w.eval(source('public/'+file));
 const texts=[];for(const button of w.document.querySelectorAll('[data-demo-platform]')){button.click();texts.push(w.document.querySelector('.pub-post-text').textContent);assert.equal(w.document.querySelectorAll('.pub-post-photo img').length,1);assert.match(w.document.querySelector('.pub-post-meta').textContent,/Example/);assert.equal(button.getAttribute('aria-pressed'),'true');}
 assert.equal(new Set(texts).size,3);assert(!w.document.querySelector('[data-rail-copy]'));home.window.close();
 // Review uses real form controls; preserve known data, in-flight edits, personal flow and recovery events.
 const setup=source('public/BlastyBiz-CreateBiz.html');
 const dom=new JSDOM(setup,{url:'https://blastybiz.com/BlastyBiz-CreateBiz',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),s=dom.window,el=id=>s.document.getElementById(id);
 s._cbReady=true;s.cbPersonal=()=>el('f-sellerType').value==='personal';s.cbConfigureForm=()=>{};let requests=0,resolve,events=0;
 s.document.addEventListener('input',()=>events++);s.eval(source('public/website-utils.js'));s.eval(source('public/business-import.js'));s.eval(source('public/setup-import.js'));
 s.fetch=async(url,opts)=>{requests++;assert.equal(JSON.parse(opts.body).setup,true);await new Promise(r=>resolve=r);return {ok:true,json:async()=>({aiContext:{story:'Source-backed story',awards:null},profile:{businessName:'Imported name',phone:'555-555-1234',city:'Source city'}})};};
 s.mountSetupImport({getToken:async()=>'fixture',getBizId:()=>null});el('setup-import-url').value='example.com';el('f-bizName').value='Known business';el('setup-import-button').click();el('setup-import-button').click();await turn();assert.equal(requests,1);el('f-city').value='My edit';resolve();await turn();assert.equal(el('f-story').value,'');assert.equal(el('f-phone').value,'');assert(!el('setup-import-review').hidden);
 [...el('setup-import-review').querySelectorAll('button')].find(b=>b.textContent==='Use these details').click();assert.equal(el('f-story').value,'Source-backed story');assert.equal(el('f-phone').value,'555-555-1234');assert.equal(el('f-bizName').value,'Known business');assert.equal(el('f-city').value,'My edit');assert.equal(el('f-awards').value,'');assert(events>0,'existing recovery cache sees imported changes');
 el('f-sellerType').value='personal';el('setup-import-button').click();await turn();assert.equal(requests,1);dom.window.close();
 console.log('PASS section 2 UI: deterministic fresh/returning auth intent, optional guide timing, shared three-platform demo, reviewed import, duplicate taps, existing/in-flight answers, recovery events, personal exclusion.');
}
async function backend(){
 let writes=0,allowance=0,calls=0,exists=true,thin=false,limited=false;
 const ref={collection:()=>ref,doc:()=>ref,get:async()=>({exists,data:()=>({})}),set:async()=>writes++,onSnapshot(){}};
 const shared={db:ref,onRequest:(_,f)=>f,withAuth:f=>f,checkUidRateLimit:async()=>true,safeFetchUrl:async()=>thin?'short':'Source business content. '.repeat(30),reserveAiAction:async()=>{if(limited)throw Error('LIMIT_REACHED');allowance++;},trackAiUsage:async()=>{},callAI:async prompt=>{calls++;assert.match(prompt,/untrusted data/);return {text:JSON.stringify({story:'Grounded story',awards:null,profile:{businessName:'Source name',city:null,ownerName:'Must not pass'}}),model:'fixture',usage:{}};},admin:{firestore:{FieldValue:{serverTimestamp:()=>0}}},bbLog(){}};
 const req=require('node:module').createRequire(require('node:path').resolve('functions/modules/ai.js'));
 const c={exports:{},console,require:n=>n==='../lib/shared'?shared:req(n)};vm.runInNewContext(read('functions/modules/ai.js'),c);
 const call=async body=>{const r={code:200,status(v){this.code=v;return this;},json(v){this.body=v;return this;}};await c.exports.extractBizContext({body},r,{uid:'fixture'});return r;};
 assert.equal((await call({sourceUrl:'example.com'})).code,400);
 const result=await call({setup:true,sourceUrl:'example.com'});assert.equal(result.code,200);assert.equal(result.body.profile.businessName,'Source name');assert(!result.body.profile.ownerName);assert(!result.body.profile.city);assert.equal(writes,0);assert.equal(allowance,1);
 exists=false;assert.equal((await call({setup:true,bizId:'other',sourceUrl:'example.com'})).code,403);assert.equal(calls,1);
 exists=true;thin=true;assert.equal((await call({setup:true,sourceUrl:'example.com'})).body.thin,true);assert.equal(calls,1);thin=false;limited=true;assert.equal((await call({setup:true,sourceUrl:'example.com'})).code,429);assert.equal(calls,1);limited=false;
 assert.equal((await call({bizId:'owned',sourceUrl:'example.com'})).code,200);assert.equal(writes,1,'existing workspace extraction metadata remains');
 console.log('PASS section 2 import endpoint: same auth wrapper, owner boundary, proposal-only setup, thin/allowance rejection before AI, existing workspace metadata, whitelisted grounded fields. No real provider calls.');
}
module.exports={run,backend};
if(require.main===module)run().then(backend).catch(e=>{console.error(e);process.exitCode=1;});
