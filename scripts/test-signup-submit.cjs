'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const html=fs.readFileSync('public/BlastyBiz-Login.html','utf8');
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!m[1].includes('src=')&&!m[1].includes('importmap'));
const helpers=scripts.find(m=>m[2].includes('function switchTab('))[2];
const authCode=scripts.find(m=>m[1].includes('module')&&m[2].includes('window.handleSignUp'))[2];
function env({error,blockedStorage=false,wait}={}){
 const dom=new JSDOM(html,{url:'https://example.invalid',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window,calls=[];
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.setTimeout=()=>1;
 w.eval(helpers.slice(0,helpers.indexOf('// ── Login Blasty Guide')));
 w.eval(fs.readFileSync('public/business-form.js','utf8'));
 Object.assign(w,{auth:{},db:{},BBBlasty:{fire(){}},createUserWithEmailAndPassword:async()=>{calls.push('auth');if(wait)await wait;if(error)throw error;return {user:{uid:'fixture',email:'seller@example.invalid'}};},doc:()=>({}),setDoc:async(_,data)=>calls.push(data),serverTimestamp:()=>null,sendVerificationViaResend:async()=>calls.push('email'),showLoginForm(){},showVerifyView:email=>calls.push('verify:'+email)});
 if(blockedStorage)Object.defineProperty(w,'sessionStorage',{value:{setItem(){throw Error('Storage disabled');}}});
 w.eval(authCode.slice(authCode.indexOf('let signupInProgress'),authCode.indexOf('window.handleGoogle')));
 w.eval(scripts.find(m=>m[2].includes('function bbSignupSellerType'))[2]);
 for(const [id,value] of Object.entries({'su-name':'Fixture Seller','su-email':'seller@example.invalid','su-phone':'5551234567','su-password':'test-only-1234','su-password2':'test-only-1234','su-sellerType':'personal'}))w.document.getElementById(id).value=value;
 w.bbSignupSellerType();
 const terms=w.document.getElementById('su-terms');terms.checked=true;w.Function(terms.getAttribute('onchange')).call(terms);
 const form=w.document.querySelector('#form-signup form');form.onsubmit=w.Function(form.getAttribute('onsubmit'));
 return {dom,w,calls,form,status:()=>w.document.getElementById('su-submit-status'),click:()=>w.document.getElementById('btn-signup').click()};
}
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 {
  const e=env(),input=e.w.document.getElementById('su-phone');
  input.oninput=e.w.Function('event',input.getAttribute('oninput'));input.onblur=e.w.Function('event',input.getAttribute('onblur'));
  input.value='';
  for(const digit of '9413751504'){input.value+=digit;input.dispatchEvent(new e.w.InputEvent('input',{inputType:'insertText'}));}
  assert.equal(input.value,'941-375-1504');
  input.value='(941) 375-1504';input.dispatchEvent(new e.w.InputEvent('input',{inputType:'insertFromPaste'}));assert.equal(input.value,'941-375-1504');
  input.value='941375-1504';input.setSelectionRange(3,3);input.dispatchEvent(new e.w.InputEvent('input',{inputType:'deleteContentBackward'}));assert.equal(input.value,'941375-1504');assert.equal(input.selectionStart,3);
  input.dispatchEvent(new e.w.Event('blur'));assert.equal(input.value,'941-375-1504');
  input.value='9421-375-1504';input.setSelectionRange(3,3);input.dispatchEvent(new e.w.InputEvent('input',{inputType:'insertText'}));assert.equal(input.selectionStart,3);assert.equal(input.value,'9421-375-1504');
  assert.equal(e.w.BBSetup.formatPhone('+1 (941) 375-1504'),'+1 941-375-1504');
  for(const value of ['+44 20 7946 0958','9413751504 ext 12','123456789012'])assert.equal(e.w.BBSetup.formatPhone(value),value);
  e.dom.window.close();
 }
 for(const blockedStorage of [false,true]){
  const e=env({blockedStorage});assert(e.form.noValidate);e.click();await tick();
  assert.equal(e.calls.filter(c=>c==='auth').length,1);assert.equal(e.calls.find(c=>c.setupHandoff)?.setupHandoff.sellerType,'personal');assert(e.calls.includes('verify:seller@example.invalid'));e.dom.window.close();
 }
 let e=env();e.w.document.getElementById('su-sellerType').value='';e.click();await tick();assert.equal(e.calls.length,0);assert.match(e.status().textContent,/Business or Personal/);assert.equal(e.w.document.activeElement.id,'su-sellerType');e.dom.window.close();
 e=env();e.w.document.getElementById('su-password2').value='different';e.click();await tick();assert.equal(e.calls.length,0);assert.match(e.status().textContent,/match/);assert.equal(e.w.document.activeElement.id,'su-password2');e.dom.window.close();
 e=env();e.w.document.getElementById('su-phone').value='';e.click();await tick();assert.equal(e.calls.length,0);assert.match(e.status().textContent,/phone/);assert.equal(e.w.document.activeElement.id,'su-phone');e.dom.window.close();
 e=env({error:{code:'auth/email-already-in-use'}});e.click();await tick();assert.match(e.status().textContent,/already has an account/);const link=e.status().querySelector('button');assert(link);link.click();assert(e.w.document.getElementById('form-signin').classList.contains('active'));assert.equal(e.w.document.getElementById('si-email').value,'seller@example.invalid');e.dom.window.close();
 e=env({error:{code:'auth/network-request-failed'}});e.click();await tick();assert.match(e.status().textContent,/Connection failed/);assert(!e.w.document.getElementById('btn-signup').disabled);assert.equal(e.w.document.getElementById('su-name').value,'Fixture Seller');e.dom.window.close();
 let release;const wait=new Promise(r=>release=r);e=env({wait});e.click();await e.w.handleSignUp();assert.equal(e.calls.filter(c=>c==='auth').length,1);release();await tick();e.dom.window.close();
 e=env();const style=e.w.document.createElement('style');style.textContent=fs.readFileSync('public/global-style.css','utf8');e.w.document.head.appendChild(style);const css=e.w.getComputedStyle(e.w.document.getElementById('su-terms'));assert.equal(css.width,'22px');assert.equal(css.minWidth,'22px');assert.equal(css.padding,'0px');e.dom.window.close();
 for(const start of ['', 'guided', 'forms']){
  const dom=new JSDOM(html,{url:'https://example.invalid'+(start?'?start='+start:''),runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window,timers=[];
  await tick();
  w.fetch=async()=>({ok:false});w.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length;};w.clearTimeout=()=>{};
  for(const file of ['blasty-registry.js','blasty-events.js','blasty-guidance.js'])w.eval(fs.readFileSync('public/'+file,'utf8'));
  const tab=w.document.getElementById('tab-signup');tab.onclick=w.Function(tab.getAttribute('onclick'));
  w.eval(helpers);w.eval(scripts.find(m=>m[2].includes('function bbSignupSellerType'))[2]);
  const seller=w.document.getElementById('su-sellerType'),field=seller.closest('.field'),picker=w.document.getElementById('plan-picker');
  assert.equal(w.document.querySelector('#form-signup form > .field'),field);assert.equal(seller.value,'');
  if(start){w.document.getElementById('auth-card-wrap').classList.add('ready');await tick();timers.filter(t=>t.ms===120).forEach(t=>t.fn());}
  else tab.click();
  assert(!field.classList.contains('bb-field-blur'), 'Seller choice must be first for '+(start||'tab')+'; '+w.document.getElementById('login-bubble').textContent);assert(picker.classList.contains('bb-field-blur'));
  timers.filter(t=>t.ms===100).forEach(t=>t.fn());assert.match(w.document.getElementById('login-bubble').textContent,/Business or Personal/);
  for(const type of ['personal','business']){
   seller.value=type;w.bbSignupSellerType();seller.dispatchEvent(new w.Event('change'));seller.dispatchEvent(new w.Event('blur'));
   assert(!picker.classList.contains('bb-field-blur'));assert.equal(w.document.getElementById('su-business').closest('.field').hidden,type==='personal');
   w.selectPlan('starter');timers.filter(t=>t.ms===3000).forEach(t=>t.fn());assert(!w.document.getElementById('su-name').closest('.field').classList.contains('bb-field-blur'));
  }
  dom.window.close();
 }
 // Personal signup goes directly to Create using the already-saved identity.
 {
  const dom=new JSDOM(html,{url:'https://example.invalid',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
  let savedProfiles=[],requests=[],fail=false;const writes=[];
  const user={uid:'fixture',email:'seller@example.invalid',getIdToken:async()=> 'fixture-token'};
  const data={setupHandoff:{sellerType:'personal',ownerName:'Fixture Seller',phone:'555-123-4567',email:user.email}};
  Object.assign(w,{db:{},collection:()=>({}),doc:()=>({}),getDocs:async()=>({docs:savedProfiles.map(p=>({id:p.id,data:()=>p}))}),setDoc:async(_,d)=>writes.push(d),fetch:async(_,options)=>{requests.push(JSON.parse(options.body));return {ok:!fail,json:async()=>fail?{error:'Please retry'}:{success:true,bizId:'fixture'}};}});
  w.eval(authCode.slice(authCode.indexOf('async function resumePersonalSignup('),authCode.indexOf('async function afterAuth(user)')));
  const target=await w.resumePersonalSignup(user,data);
  assert.match(target,/tab=create&newcampaign=1/);assert(!target.includes('CreateBiz'));
  assert.equal(requests[0].profileData.ownerName,'Fixture Seller');assert.equal(requests[0].profileData.sellerType,'personal');assert.equal(requests[0].profileData.phone,'555-123-4567');assert.equal(requests[0].bizId,'fixture');assert(!requests[0].campaignData);
  await w.resumePersonalSignup(user,data);assert.equal(requests[1].bizId,requests[0].bizId);
  savedProfiles=[{id:'existing',sellerType:'personal'}];let existing=await w.resumePersonalSignup(user,data);assert.match(existing,/bizId=existing/);assert.equal(requests.length,2);assert.equal(writes[0].activeBusiness,'existing');
  assert.equal(await w.resumePersonalSignup(user,{setupHandoff:{sellerType:'business'}}),null);
  savedProfiles=[];fail=true;await assert.rejects(w.resumePersonalSignup(user,data),/Please retry/);
  dom.window.close();
 }
 // Verify in a separate email browser, then resume the existing browser session.
 for(const event of ['focus','visibilitychange','manual']) {
  const dom=new JSDOM(html,{url:'https://example.invalid',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
  const calls=[];let remoteVerified=false,offline=false;
  Object.defineProperty(w.document,'visibilityState',{value:'visible'});
  w.setInterval=()=>17;w.clearInterval=()=>calls.push('stop');
  const user={uid:'seller',emailVerified:false,reload:async()=>{calls.push('reload');if(offline)throw Error('offline');user.emailVerified=remoteVerified;},getIdToken:async force=>{assert.equal(force,true);calls.push('token');}};
  Object.assign(w,{auth:{currentUser:user},afterAuth:async current=>{assert.equal(current,user);calls.push('continue');}});
  w.eval(authCode.slice(authCode.indexOf('let verificationTimer'),authCode.indexOf('function showVerifyView(email)')));
  w.document.getElementById('auth-card-wrap').classList.add('verify-mode');
  await w.checkEmailVerification(true);assert(!calls.includes('continue'));assert.match(w.document.getElementById('verify-status').textContent,/Not verified yet/);
  offline=true;await w.checkEmailVerification(true);assert.match(w.document.getElementById('verify-status').textContent,/Could not check/);offline=false;
  remoteVerified=true;
  if(event==='manual')await w.checkEmailVerification(true);
  else { (event==='focus'?w:w.document).dispatchEvent(new w.Event(event));await tick(); }
  assert.equal(calls.filter(x=>x==='continue').length,1);assert(calls.indexOf('token')<calls.indexOf('continue'));assert(calls.includes('stop'));
  w.document.getElementById('auth-card-wrap').classList.remove('verify-mode');await w.checkEmailVerification();assert.equal(calls.filter(x=>x==='continue').length,1);
  dom.window.close();
 }
 // Opening verification in the same browser must use afterAuth, preserving the
 // Personal handoff instead of forcing the old new=1 onboarding destination.
 for(const signedIn of [false,true]) {
  const dom=new JSDOM(html,{url:'https://example.invalid/?mode=verifyEmail&oobCode=fixture',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window,calls=[];
  const user={emailVerified:true,reload:async()=>calls.push('reload'),getIdToken:async()=>calls.push('token')};
  Object.assign(w,{auth:{currentUser:signedIn?user:null,authStateReady:async()=>calls.push('ready')},applyActionCode:async()=>calls.push('verify'),afterAuth:async()=>calls.push('continue')});
  w.eval(authCode.slice(authCode.indexOf('(async function checkVerifyEmailLink()'),authCode.indexOf('window.showNormalLogin')));
  await tick();assert(calls.includes('verify'));assert.equal(calls.includes('continue'),signedIn);
  assert(!w.location.search.includes('new=1'));dom.window.close();
 }
 console.log('PASS signup submission: Personal native button click, verification transition, blocked browser storage, visible validation, existing-account sign-in, network failure, double-submit guard and checkbox styles. No real accounts or emails.');
})().catch(e=>{console.error(e);process.exitCode=1});
