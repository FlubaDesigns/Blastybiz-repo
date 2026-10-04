'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
const read=p=>fs.readFileSync(p,'utf8'),cut=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
const returnCode=read('public/auth-return.js').replace(/^export /gm,'');
const parse={URLSearchParams};vm.runInNewContext(returnCode,parse);
const login=read('public/BlastyBiz-Login.html'),connected=read('public/BlastyBiz-Connected.html');
async function returnTests(){
 const destinations=[['/BlastyBiz.html','bizId=b&ownerUid=u&cid=c&adId=a&tab=create&step=5'],['/BlastyBiz-Listing-Preview.html','bizId=b&ownerUid=u&draftId=d'],['/BlastyBiz-Connect.html','bizId=b&ownerUid=u'],['/BlastyBiz','bizId=b&ownerUid=u&tab=schedule&scheduleCampaign=c&scheduleAd=a&scheduledBlastId=d'],['/BlastyBiz-Publishing-Status','bizId=b&draftId=d&ownerUid=u'],['/BlastyBiz-Connected.html','bizId=b&ownerUid=u&connected=facebook&selection=nonce']];
 for(const [pathname,search]of destinations){
  const saved=new Map(),c={...parse,URLSearchParams,window:{location:{pathname,search}},sessionStorage:{setItem:(k,v)=>saved.set(k,v)}};
  vm.runInNewContext(cut(read('public/auth-guard.js'),'function rememberDraftDestination','// Safety valve'),c);c.rememberDraftDestination();
  ok(saved.has('bb_draft_return'),'guard stores '+pathname);
  const notes=[],d={...parse,URLSearchParams,localStorage:{removeItem(){}},sessionStorage:{getItem:k=>saved.get(k),removeItem:k=>saved.delete(k)},window:{location:{href:''},showToast:m=>notes.push(m)},showLoginForm(){},db:{},doc:(...parts)=>parts,getDoc:async()=>({exists:()=>true})};
  vm.runInNewContext(cut(login,'async function afterAuth','function showLoginForm'),d);
  await d.afterAuth({uid:'other'});ok(!d.window.location.href&&saved.size===1&&notes.length===1,'wrong account retains return and shows actionable message');
  await d.afterAuth({uid:'u'});const url=new URL(d.window.location.href,'https://example.com');ok(url.searchParams.get('bizId')==='b'&&!saved.size,'correct account returns to initiating business');
  for(const key of ['cid','adId','tab','step','draftId','scheduleCampaign','scheduleAd','scheduledBlastId','selection'])if(new URLSearchParams(search).has(key))ok(url.searchParams.get(key)===new URLSearchParams(search).get(key),'retains '+key);
 }
 for(const [p,q]of [['//evil.invalid','bizId=b&draftId=d'],['/BlastyBiz.html','bizId=../b&draftId=d'],['/BlastyBiz.html','bizId=b&tab=schedule&scheduleCampaign=c'],['/BlastyBiz-Connected.html','bizId=b&connected=constructor']])ok(!parse.parseAuthReturn(p,q),'unsafe or incomplete return rejected');
}
function intentTests(){
 const choiceCode=cut(login.slice(login.indexOf('    // Once auth card is ready')), "    var wrap = document.getElementById('auth-card-wrap');","\n  }\n\n  // Expose a hook");
 for(const [query,stale,expected] of [['?intent=signin','forms','signin'],['?start=forms',null,'signup'],['?start=guided','forms','signup'],['','forms',null]]){
  const dom=new JSDOM(login,{url:'https://example.com/BlastyBiz-Login.html'+query,runScripts:'outside-only'}),w=dom.window;
  if(stale)w.localStorage.setItem('bb_start_choice',stale);
  let observer,selected;w.MutationObserver=class{constructor(cb){observer=cb;}observe(){}disconnect(){}};
  w.removeTabPrompt=()=>{};w.tabsRow=w.document.querySelector('.auth-tabs');w._suFields=[];w._fieldEls=[];w.showGuide=()=>{};w.switchTab=tab=>selected=tab;
  w.eval(choiceCode);w.document.getElementById('auth-card-wrap').classList.add('ready');observer([],{disconnect(){}});
  ok(selected===expected||(!selected&&expected===null),'signup/sign-in intent '+query);
  ok(w.tabsRow?.style.display!=='none','sign-in tab stays reachable');
  ok(query.includes('start=')?!!w.localStorage.getItem('bb_start_choice'):!w.localStorage.getItem('bb_start_choice'),'stale intent lifecycle '+query);
  dom.window.close();
 }
 ok(read('public/BlastyBiz-Start.html').includes('BlastyBiz-Login.html?intent=signin'),'Start sign-in declares explicit returning intent');
}
function readinessTests(){
 const dom=new JSDOM('',{url:'https://example.com',runScripts:'outside-only'}),w=dom.window;
 w.eval(read('public/platforms-authority.js'));w.eval(read('public/platforms-config.js').replace(/^import .*;$/gm,'').replace(/^export /gm,''));w.eval(returnCode);
 const saved={status:'connected',pageId:'p',igUserId:'i',accountId:'a',locationId:'l',expiresAt:new Date(Date.now()+3600000).toISOString()};
 ok(w.deliveryReadiness('facebook',null).state==='connection','missing saved connection asks for connection');
 ok(w.deliveryReadiness('facebook',undefined).state==='checking','unloaded connection is never claimed ready');
 ok(w.deliveryReadiness('facebook',saved).state==='ready','saved destination and future grant ready');
 ok(w.deliveryReadiness('facebook',{...saved,expiresAt:'2000-01-01'}).state==='connection','expired Meta grant asks for connection');
 ok(w.deliveryReadiness('google',{...saved,expiresAt:'2000-01-01'},{business:{locationType:'physical'}}).state==='ready','Google refreshable access expiry does not force reconnection');
 ok(w.deliveryReadiness('instagram',saved,{images:[]}).state==='photo','Instagram exposes missing required photo');
 ok(w.deliveryReadiness('instagram',saved,{images:[{url:'https://example.com/a.jpg'}]}).state==='ready','Instagram with saved destination and photo is ready');
 ok(w.deliveryReadiness('craigslist',null).state==='manual','manual destination stays explicitly manual');
 ok(w.deliveryReadiness('google',saved,{business:{locationType:'online'}}).state==='unavailable','online-only business remains ineligible for Google');
 w.rememberConnectionReturn('/BlastyBiz.html','?bizId=b&cid=c&adId=a&tab=create&step=5','u');
 ok(w.connectionReturn('u','b').includes('step=5'),'connection detour preserves review step');
 ok(!w.connectionReturn('other','b')&&!w.connectionReturn('u','other'),'connection return stays with exact owner and business');
 dom.window.close();
}
async function connectedTests(){
 const code=[...connected.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)][0][1].replace(/^import .*;$/gm,'');
 async function page(query,{record,readFailure=false,selection=false,owner='u',cancelResponse}={}){
  const navigation=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(e.message.includes('navigation'))navigation.push(e);});
  const dom=new JSDOM('<div id="page-content"></div>',{url:'https://example.com/BlastyBiz-Connected.html?'+query,runScripts:'dangerously',virtualConsole:vc}),w=dom.window,calls=[],fires=[];
  w.eval(read('public/escape-utils.js'));w.eval(read('public/platforms-authority.js'));w.eval(read('public/platforms-config.js').replace(/^import .*;$/gm,'').replace(/^export /gm,''));w.eval(returnCode);Object.assign(w,{auth:{authStateReady:()=>Promise.resolve()},db:{},onAuthStateChanged:(_a,cb)=>cb({uid:owner,getIdToken:async()=>'fixture'}),doc:(_db,...parts)=>parts.join('/'),getDoc:async path=>{
   calls.push(path);if(readFailure)throw Error('Connection read unavailable');const data=path.endsWith('/facebook')?record:path.endsWith('/instagram')?null:{};return {exists:()=>!!data,data:()=>data};
  },BBBlasty:{fire:name=>fires.push(name)},fetch:async(url,options)=>{
   calls.push({url,options});if(options.method==='POST'&&JSON.parse(options.body).cancel&&cancelResponse)return cancelResponse();return {ok:true,json:async()=>options.method==='POST'?{businessId:'b',platform:'facebook'}:{businessId:'b',platform:'facebook',choices:[{id:'one',label:'First'},{id:'two',label:'<img onerror=alert(1)> Intended'}]}};
  }});w.eval(code);await settle();return {dom,w,calls,fires,navigation};
 }
 let e=await page('error='+encodeURIComponent('<img src=x onerror="document.body.dataset.pwned=1">'));
 ok(!e.w.document.querySelector('img[onerror]')&&!e.w.document.body.dataset.pwned,'reflected error markup cannot execute');e.dom.window.close();
 for(const q of ['constructor','__proto__']){e=await page('error='+q);ok(e.w.document.body.textContent.includes('this platform'),'unknown provider uses fixed label');e.dom.window.close();}
 for(const options of [{},{readFailure:true},{record:{status:'connected',pageId:''}},{record:{status:'connected',pageId:'p',expiresAt:'2000-01-01'}}]){
  e=await page('connected=facebook&bizId=b&ownerUid=u',options);ok(!e.fires.length&&e.w.document.body.textContent.includes('Connection not confirmed'),'missing/failed/empty/expired binding never shows success');e.dom.window.close();
 }
 e=await page('connected=facebook&bizId=b&ownerUid=u',{record:{status:'connected',pageId:'p',pageName:'Second Page',expiresAt:new Date(Date.now()+3600000).toISOString()}});
 ok(e.fires.length===1&&e.w.document.body.textContent.includes('Second Page'),'verified saved binding shows actual destination');ok(!e.calls.includes('users/u'),'success never substitutes activeBusiness');ok([...e.w.document.querySelectorAll('a')].every(a=>new URL(a.href).searchParams.get('bizId')==='b'),'success navigation preserves business context');e.dom.window.close();
 e=await page('connected=facebook&bizId=b&ownerUid=u&selection=nonce');
 const select=e.w.document.querySelector('select'),button=e.w.document.querySelector('button');ok(select.options.length===3&&button.disabled&&!e.w.document.querySelector('img'),'destination choice has no default and renders provider label as text');
 select.value='two';select.dispatchEvent(new e.w.Event('change'));button.click();await settle();ok(JSON.parse(e.calls.find(c=>c.options?.method==='POST').options.body).choiceId==='two','actual second option submits its identity');e.dom.window.close();
 let finishCancel;
 e=await page('connected=facebook&bizId=b&ownerUid=u&selection=nonce',{cancelResponse:()=>new Promise(resolve=>{finishCancel=resolve;})});
 let cancel=[...e.w.document.querySelectorAll('button')].find(b=>b.textContent==='Cancel');cancel.click();await settle();
 let request=e.calls.find(c=>c.options?.method==='POST');
 ok(JSON.parse(request.options.body).cancel===true&&JSON.parse(request.options.body).selection==='nonce','Cancel submits authenticated deletion for exact pending selection');
 ok(request.options.headers.Authorization==='Bearer fixture','Cancel carries signed-in owner token');
 ok(cancel.disabled&&e.w.document.querySelector('select').disabled&&e.w.document.querySelector('button').disabled,'Cancel locks choice controls while deletion is pending');
 ok(!e.navigation.length,'Cancel does not navigate before deletion confirmation');
 finishCancel({ok:true,json:async()=>({cancelled:true})});await settle();
 ok(e.navigation.length===1,'Cancel navigates only after server confirms cleanup');e.dom.window.close();
 for(const response of [{ok:false,json:async()=>({error:'Try again'})},{ok:true,json:async()=>({})}]){
  e=await page('connected=facebook&bizId=b&ownerUid=u&selection=nonce',{cancelResponse:async()=>response});
  cancel=[...e.w.document.querySelectorAll('button')].find(b=>b.textContent==='Cancel');cancel.click();await settle();
  ok(!e.navigation.length&&!cancel.disabled&&!e.w.document.querySelector('select').disabled,'Failed or unconfirmed deletion retains page and enables retry');
  ok(e.w.document.querySelector('button').disabled,'Failed cancellation cannot submit an unselected destination');e.dom.window.close();
 }

}
(async()=>{await returnTests();intentTests();readinessTests();await connectedTests();
 // Parse every changed page's scripts: a successful fixture must not hide a syntax error elsewhere.
 for(const file of ['public/BlastyBiz-Login.html','public/BlastyBiz-Connected.html','public/BlastyBiz-Publishing-Status.html'])for(const m of read(file).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  if(m[0].includes('type="importmap"'))continue;new vm.Script(m[1].replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm,''));checks++;
 }
 console.log(checks+' Audit 2 UI/return assertions passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
