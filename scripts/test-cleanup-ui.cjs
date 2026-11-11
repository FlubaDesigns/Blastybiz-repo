"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const dom=new JSDOM(fs.readFileSync('public/BlastyBiz-Admin-Subscriptions.html','utf8'),{runScripts:'outside-only',url:'https://blastybiz.com/BlastyBiz-Admin-Subscriptions'}),w=dom.window;
 let calls=0,offline=false;w.AbortController=AbortController;w.fetch=async()=>{calls++;if(offline)throw Error('offline');return{ok:true,json:async()=>({prices:{},bizLimits:{starter:2,pro:7,agency:19}})}};
 w.eval(fs.readFileSync('public/pricing.js','utf8'));await tick();assert.deepEqual(await Promise.all(['starter','pro','agency'].map(p=>w.BBPlans.businessLimit(p))),[2,7,19]);assert.equal(calls,1);assert.equal(await w.BBPlans.businessLimit('unknown'),null);
 let saved;Object.assign(w,{db2:{},auth:{},doc:(_db,...p)=>p.join('/'),getDoc:async()=>({exists:()=>false}),setDoc:async(path,data,opts)=>{saved=JSON.parse(JSON.stringify({path,data,opts}));}});
 const source=[...w.document.querySelectorAll('script[type="module"]')].at(-1).textContent.replace(/^import .*;\n/gm,'');w.eval(source);await tick();assert.equal(w.document.getElementById('btn-save-lim').disabled,false);
 for(const [plan,value] of Object.entries({starter:2,pro:7,agency:19}))assert.equal(w.document.getElementById('inp-lim-'+plan).value,String(value));
 w.document.getElementById('inp-lim-pro').value='8';await w.saveBizLimits();assert.deepEqual(saved,{path:'config/plans',data:{bizLimits:{starter:2,pro:8,agency:19}},opts:{merge:true}});
 // Actual Firestore merge preservation is also exercised by the emulator check.
 saved=null;w.document.getElementById('inp-lim-pro').value='1.5';await w.saveBizLimits();assert.equal(saved,null);
 offline=true;await assert.rejects(()=>w.BBPlans.get({refresh:true}));assert.equal(await w.BBPlans.businessLimit('pro'),null);dom.window.close();
 let checked=0,allowed=false;const context={auth:{currentUser:null},AbortSignal,fetch:async(_url,opts)=>{checked++;assert.equal(opts.headers.Authorization,'Bearer token');return{ok:allowed};}};
 const code=fs.readFileSync('public/firebase-init-v2.js','utf8');vm.runInNewContext(code.slice(code.indexOf('export async function isAdmin')).replace('export ',''),context);
 assert.equal(await context.isAdmin(null),false);assert.equal(await context.isAdmin({emailVerified:false}),false);assert.equal(checked,0);
 const user={emailVerified:true,getIdToken:async()=> 'token',claims:{admin:true}};
 assert.equal(await context.isAdmin(user),false,'A custom claim never grants display eligibility');allowed=true;user.claims={};assert.equal(await context.isAdmin(user),true,'Canonical membership works without custom claims');
 context.fetch=async()=>{throw Error('offline')};assert.equal(await context.isAdmin(user),false);
 console.log('PASS cleanup UI: cached canonical capacities, no guessed fallback, existing admin editor writes only config/plans with merge, invalid saves rejected, server membership controls admin display and fails closed.');
})().catch(e=>{console.error(e);process.exitCode=1});
