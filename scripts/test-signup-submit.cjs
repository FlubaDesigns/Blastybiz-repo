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
 for(const blockedStorage of [false,true]){
  const e=env({blockedStorage});assert(e.form.noValidate);e.click();await tick();
  assert.equal(e.calls.filter(c=>c==='auth').length,1);assert.equal(e.calls.find(c=>c.setupHandoff)?.setupHandoff.sellerType,'personal');assert(e.calls.includes('verify:seller@example.invalid'));e.dom.window.close();
 }
 let e=env();e.w.document.getElementById('su-password2').value='different';e.click();await tick();assert.equal(e.calls.length,0);assert.match(e.status().textContent,/match/);assert.equal(e.w.document.activeElement.id,'su-password2');e.dom.window.close();
 e=env();e.w.document.getElementById('su-phone').value='';e.click();await tick();assert.equal(e.calls.length,0);assert.match(e.status().textContent,/phone/);assert.equal(e.w.document.activeElement.id,'su-phone');e.dom.window.close();
 e=env({error:{code:'auth/email-already-in-use'}});e.click();await tick();assert.match(e.status().textContent,/already has an account/);const link=e.status().querySelector('button');assert(link);link.click();assert(e.w.document.getElementById('form-signin').classList.contains('active'));assert.equal(e.w.document.getElementById('si-email').value,'seller@example.invalid');e.dom.window.close();
 e=env({error:{code:'auth/network-request-failed'}});e.click();await tick();assert.match(e.status().textContent,/Connection failed/);assert(!e.w.document.getElementById('btn-signup').disabled);assert.equal(e.w.document.getElementById('su-name').value,'Fixture Seller');e.dom.window.close();
 let release;const wait=new Promise(r=>release=r);e=env({wait});e.click();await e.w.handleSignUp();assert.equal(e.calls.filter(c=>c==='auth').length,1);release();await tick();e.dom.window.close();
 e=env();const style=e.w.document.createElement('style');style.textContent=fs.readFileSync('public/global-style.css','utf8');e.w.document.head.appendChild(style);const css=e.w.getComputedStyle(e.w.document.getElementById('su-terms'));assert.equal(css.width,'22px');assert.equal(css.minWidth,'22px');assert.equal(css.padding,'0px');e.dom.window.close();
 console.log('PASS signup submission: Personal native button click, verification transition, blocked browser storage, visible validation, existing-account sign-in, network failure, double-submit guard and checkbox styles. No real accounts or emails.');
})().catch(e=>{console.error(e);process.exitCode=1});
