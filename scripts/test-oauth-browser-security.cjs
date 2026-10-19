'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const read=p=>fs.readFileSync(p,'utf8');
const browser=read('public/oauth-browser.js'),html=read('public/BlastyBiz-Connected.html');
const code=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)][0][1].replace(/^import .*;$/gm,'');
const tick=async()=>{for(let i=0;i<6;i++)await new Promise(setImmediate);};
let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const verifier='a'.repeat(64),entry=JSON.stringify({verifier,expiresAt:Date.now()+600000});
function dom(url){return new JSDOM('<div id="page-content"></div><p id="oauth-status"></p>',{url,runScripts:'outside-only',virtualConsole:new VirtualConsole()});}
async function connected({secret=entry,hash='#selection=ticket&state=state',pending='1',cancel=false,failure=0,target=false,granted=true}={}){
 const platform=target?'facebook':'google';
 const d=dom('https://blastybiz.com/BlastyBiz-Connected.html?connected='+platform+'&bizId=b&ownerUid=u'+(target?'&authorizationRequest=engine-request':'')+'&pending='+pending+hash),w=d.window,calls=[];let finish;
 w.eval(browser);if(secret)w.sessionStorage.setItem('bb-oauth-attempt:state',secret);
 Object.assign(w,{auth:{authStateReady:async()=>{}},db:{},onAuthStateChanged:(_,cb)=>cb({uid:'u',getIdToken:async()=>'fixture'}),doc:()=>{},getDoc:async()=>{throw Error('Unexpected read of old connection');},connectionReturn:()=>null,fetch:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  if(body.action==='inspect')return {ok:true,json:async()=>({businessId:'b',platform,...(target?{authorizationRequest:'engine-request',expectedPageId:'only',pageName:'Litigant-ai'}:{}),choices:granted?[{id:'only',label:target?'Litigant-ai':'Business location'}]:[]})};
  if(failure)return {ok:false,status:failure,json:async()=>({error:'This connection request has expired or belongs to another account. Please reconnect.'})};
  return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>body.cancel?{cancelled:true}:{businessId:'b',platform:'google'}});});
 }});
 w.eval(code);await tick();return {d,w,calls,finish:()=>finish()};
}
(async()=>{
 // Real script locks repeated initiations and keeps proof entirely in sessionStorage.
 const saved=new Map(),nav=[],calls=[];let release;
 const context={window:{},crypto:webcrypto,Uint8Array,TextEncoder,URL,Date,sessionStorage:{setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k),removeItem:k=>saved.delete(k)},location:{origin:'https://blastybiz.com',assign:v=>nav.push(v)},fetch:async url=>{calls.push(url);await new Promise(r=>release=r);return {ok:true,json:async()=>({state:'state',url:'https://blastybiz.com/BlastyBiz-OAuth-Start.html?state=state'})};}};
 vm.runInNewContext(browser,context);const first=context.window.BBOAuth.begin('https://functions.example/init','fixture');await new Promise(r=>setTimeout(r,25));await context.window.BBOAuth.begin('https://functions.example/init','fixture');release();await first;
 ok(calls.length===1&&nav.length===1,'repeated connect clicks produce one initiation and navigation');
 const proof=context.window.BBOAuth.read('state');ok(/^[a-f0-9]{64}$/.test(proof)&&!nav[0].includes(proof)&&!calls[0].href.includes(proof),'random proof is stored only in originating tab, never in navigation/fetch URL');
 context.window.BBOAuth.clear('state');assert.throws(()=>context.window.BBOAuth.read('state'),/browser tab/);checks++;
 for(const secret of [null,JSON.stringify({verifier,expiresAt:0})]){
  const e=await connected({secret});ok(!e.calls.length&&e.w.document.body.textContent.includes('browser tab'),'new tab/transferred completion or expired local proof fails before inspect');e.d.window.close();
 }
 const interrupted=await connected({hash:''});ok(!interrupted.calls.length&&interrupted.w.document.body.textContent.includes('interrupted'),'lost callback fragment after login cannot display an old saved connection');interrupted.d.window.close();
 const parser={URLSearchParams};vm.runInNewContext(read('public/auth-return.js').replace(/^export /gm,''),parser);ok(parser.parseAuthReturn('/BlastyBiz-Connected.html','bizId=b&ownerUid=u&connected=google&pending=1').params.pending==='1','login return preserves pending marker');
 for(const path of ['/BlastyBiz-Connect','/BlastyBiz-Connected.html']){
  ok(parser.parseAuthReturn(path,'bizId=b&connected=facebook&authorizationRequest=engine-request').params.authorizationRequest==='engine-request','phone sign-in preserves engine request');
  ok(parser.parseAuthReturn(path,'bizId=b&connected=facebook&authorizationRequest=../bad')===null,'invalid engine request rejected by login return allowlist');
 }
 for(const granted of [false,true]){
  const e=await connected({target:true,granted}),button=e.w.document.querySelector('button'),select=e.w.document.querySelector('select'),retry=e.w.document.querySelector('a');
  if(granted)ok(!button.disabled&&button.textContent==='Connect Litigant-ai'&&select.hidden,'requested Page needs one explicit confirmation without a redundant picker');
  else {
   const restart=[...e.w.document.querySelectorAll('a')].find(a=>a.textContent==='Restart after updating permissions');
   ok(button.hidden&&select.hidden&&retry.href==='https://www.facebook.com/settings?tab=business_tools'&&retry.target==='_blank'&&retry.rel.includes('noopener'),'missing Page recovery opens actual Facebook app permissions instead of repeating OAuth');
   ok(restart&&!restart.hidden&&restart.href.includes('authorizationRequest=engine-request')&&restart.href.includes('bizId=b'),'separate restart preserves exact business and engine request after permission changes');
   ok(e.calls.length===1&&e.w.document.body.textContent.includes('Do not remove BlastyBiz'),'missing Page recovery does not initiate or revoke a connection automatically');
  }
  e.d.window.close();
 }
 const requestDOM=dom('https://blastybiz.com/BlastyBiz-Connect?bizId=b&authorizationRequest=request'),rw=requestDOM.window,starts=[];
 rw.fetch=async()=>({ok:true,json:async()=>({requestId:'request',businessId:'b',pageId:'61595449803443',pageName:'Litigant-ai',connected:false})});
 rw.BBOAuth={begin:async(...a)=>starts.push(a)};
 rw.eval(read('public/facebook-authorization.js').replace(/^export /gm,''));
 await rw.renderFacebookAuthorization({user:{getIdToken:async()=>'fixture'},businessId:'b',requestId:'request',container:rw.document.getElementById('page-content')});
 const authStyle=rw.document.createElement('style');authStyle.textContent=read('public/instagram-authorization.css');rw.document.head.append(authStyle);
 const continueButton=rw.document.querySelector('button');continueButton.click();continueButton.click();await tick();
 ok(starts.length===1&&starts[0][0].includes('authorizationRequest=request')&&rw.getComputedStyle(continueButton).width==='100%','phone action retains target and locks duplicate clicks');
 requestDOM.window.close();
 for(const cancel of [false,true]){
  const e=await connected(),select=e.w.document.querySelector('select'),button=e.w.document.querySelector('button');
  ok(select.options.length===2&&button.disabled&&e.calls.length===1,'fragment loads sole choice but still requires explicit selection');
  ok(button.textContent==='Choose a location first'&&e.w.document.getElementById('destination-help').textContent.includes('does not publish'),'disabled action explains prerequisite and connection is not publishing');
  ok(e.calls[0].selection==='ticket'&&e.calls[0].verifier===verifier&&e.calls[0].action==='inspect','inspection carries ticket and same-tab verifier in POST body');
  select.value='only';select.dispatchEvent(new e.w.Event('change'));
  ok(!button.disabled&&button.textContent==='Connect Business location','selected destination is named on enabled action');
  const target=cancel?[...e.w.document.querySelectorAll('button')].find(b=>b.textContent==='Cancel'):button;
  target.click();target.click();await tick();
  ok(e.calls.length===2&&target.disabled&&select.disabled,'confirm/cancel locks repeated clicks while pending');
  ok(e.calls[1].verifier===verifier&&(cancel?e.calls[1].cancel:e.calls[1].choiceId==='only'),'confirmed action is authenticated same-tab selection request');
  e.finish();await tick();ok(!e.w.sessionStorage.getItem('bb-oauth-attempt:state'),'successful confirm/cancel destroys local proof, making Back safe');
  e.d.window.close();
 }
 for(const failure of [403,500]){
  const e=await connected({failure}),select=e.w.document.querySelector('select'),button=e.w.document.querySelector('button');
  select.value='only';select.dispatchEvent(new e.w.Event('change'));button.click();await tick();
  const restart=e.w.document.querySelector('a');
  if(failure===403){
   ok(button.hidden&&button.disabled&&select.disabled&&!restart.hidden,'expired selection cannot be retried through a green dead-end button');
   ok(restart.href==='https://blastybiz.com/BlastyBiz-Connect.html?bizId=b','restart keeps business scope without transferring credentials');
  }else ok(!button.hidden&&!button.disabled&&!select.disabled&&restart.hidden,'transient failure retains selected destination for retry');
  e.d.window.close();
 }
 // The bridge cannot transfer a missing session secret to the callback host.
 const b=dom('https://blastybiz.com/BlastyBiz-OAuth-Start.html?state=state');b.window.eval(browser);let submitted=0;b.window.HTMLFormElement.prototype.submit=function(){submitted++;};b.window.eval(read('public/oauth-start.js'));
 ok(!submitted&&b.window.document.getElementById('oauth-status').textContent.includes('browser tab'),'transferred bridge/new tab fails before any POST');
 b.window.sessionStorage.setItem('bb-oauth-attempt:state',entry);b.window.eval(read('public/oauth-start.js'));const form=b.window.document.querySelector('form');
 ok(submitted===1&&form.method==='post'&&form.querySelector('[name=verifier]').value===verifier,'original tab bridge uses top-level POST body for verifier');
 ok(/name="referrer" content="origin"/.test(read('public/BlastyBiz-OAuth-Start.html')),'bridge retains Origin header on cross-origin POST without exposing state path');
 b.window.close();console.log(checks+' OAuth browser security assertions passed (actual scripts/DOM).');
})().catch(e=>{console.error(e);process.exitCode=1;});

