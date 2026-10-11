'use strict';
// CI-only real Chromium regression. Every HTTPS request is intercepted. No real
// provider, account, credentials, TLS-warning bypass or external network is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const {database,admin}=require('./lib/test-firestore.cjs');
const APP='https://app.blastybiz.test',FN='https://functions.callback.test',PROVIDER='https://provider.oauth.test';
const read=p=>fs.readFileSync(p,'utf8');
const m=database({'users/owner/businesses/business':{},'users/victim/businesses/business':{}});
const exchanges=[],starts=[],callbacks=[],unexpected=[];
const axios={post:async url=>{exchanges.push(url);return {data:{access_token:'fixture-only-access',refresh_token:'fixture-only-refresh'}};},get:async url=>({data:url.endsWith('/accounts')?{accounts:[{name:'accounts/account',accountName:'Fixture account'}]}:{locations:[{name:'locations/location',title:'Fixture location'}]}})};
const shared={db:m.db,admin,axios,APP_BASE_URL:APP,ALLOWED_ORIGINS:new Set([APP]),onRequest:(...args)=>args.at(-1),onSchedule:(...args)=>args.at(-1),withAuth:fn=>async(req,res)=>{
 const uid=req.headers.authorization==='Bearer fixture-owner'?'owner':req.headers.authorization==='Bearer fixture-victim'?'victim':null;
 return uid?fn(req,res,{uid}):res.status(401).json({error:'Unauthorized'});
},checkUidRateLimit:async()=>true,userBizRef:(uid,id)=>m.db.doc(`users/${uid}/businesses/${id}`),setCors(req,res){if(req.headers.origin===APP)res.set('Access-Control-Allow-Origin',APP);res.set('Access-Control-Allow-Headers','Content-Type,Authorization');res.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');}};
// withAuth's production wrapper handles CORS and preflight before authenticated work.
const auth=shared.withAuth;shared.withAuth=fn=>async(req,res)=>{shared.setCors(req,res);if(req.method==='OPTIONS')return res.status(204).send('');return auth(fn)(req,res);};
const filename=path.resolve('functions/modules/oauth.js'),realRequire=createRequire(filename),endpoints={};
vm.runInNewContext(read(filename),{exports:endpoints,require:p=>p==='../lib/shared'?shared:realRequire(p),process:{env:{GOOGLE_CLIENT_ID:'fixture-client'}},console:{error(){},warn(){},log(){}},Date,URLSearchParams,Buffer},{filename});
let bootstrapUrl;
function response(){return {code:200,headers:{},body:'',set(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},send(body){this.body=String(body);return this;},json(body){this.headers['Content-Type']='application/json';this.body=JSON.stringify(body);return this;},redirect(...args){this.code=args.length===2?args[0]:302;this.headers.Location=args.at(-1);return this;}};}
async function serveEndpoint(route,url){
 const request=route.request(),headers=await request.allHeaders();
 const raw=request.postData()||'',body=headers['content-type']?.includes('application/json')?JSON.parse(raw||'{}'):Object.fromEntries(new URLSearchParams(raw));
 const req={method:request.method(),headers,query:Object.fromEntries(url.searchParams),body},res=response();
 if(url.pathname==='/oauthStart')starts.push(req);
 if(url.pathname==='/googleOAuthCallback')callbacks.push(req);
 const handler=endpoints[url.pathname.slice(1)];assert(handler,'Unknown fixture endpoint '+url.pathname);
 await handler(req,res);
 if(url.pathname==='/initiateGoogleOAuth'&&res.code===200&&req.method!=='OPTIONS'){
  const result=JSON.parse(res.body);bootstrapUrl=result.url;
  // Only the external provider UI is replaced. All nonce/cookie transitions,
  // initiation, callback, pending selection, and confirmation use production code.
  await m.db.doc('oauthNonces/'+result.state).update({authorizationUrl:PROVIDER+'/authorize?state='+encodeURIComponent(result.state)});
 }
 await route.fulfill({status:res.code,headers:res.headers,body:res.body});
}
function completionHtml(uid){
 const inline=[...read('public/BlastyBiz-Connected.html').matchAll(/<script type="module">([\s\S]*?)<\/script>/g)][0][1].replace(/^import .*;$/gm,'').replaceAll('https://us-central1-blastybiz-9523e.cloudfunctions.net',FN);
 const setup=`const fixtureData=${JSON.stringify(m.all())};Object.assign(window,{auth:{authStateReady:async()=>{}},db:{},onAuthStateChanged:(_,cb)=>cb({uid:${JSON.stringify(uid)},getIdToken:async()=>${JSON.stringify('fixture-'+uid)}}),doc:(_, ...p)=>p.join('/'),getDoc:async p=>({exists:()=>Object.hasOwn(fixtureData,p),data:()=>fixtureData[p]}),deliveryReadiness:(_,d)=>({state:d?.status==='connected'?'ready':'connection'}),connectionReturn:()=>null,BBBlasty:{fire:()=>{}},escHtml:s=>String(s).replace(/[<>&]/g,'')});`;
 return '<!doctype html><meta name="referrer" content="no-referrer"><div id="page-content"></div><script src="/oauth-browser.js"></script><script>'+setup+inline+'</script>';
}
async function installRoutes(context,uid){
 await context.route('**/*',async route=>{
  try {
   const url=new URL(route.request().url());
   if([APP,FN,PROVIDER].includes(url.origin)&&url.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
   if(url.origin===FN){
    if(url.pathname==='/cookie-inspection')return route.fulfill({contentType:'text/html',body:'<!doctype html><p>Cookie inspection fixture</p>'});
    return serveEndpoint(route,url);
   }
   if(url.origin===PROVIDER){
    assert.equal(url.pathname,'/authorize');
    const callback=FN+'/googleOAuthCallback?code=fixture-code&state='+encodeURIComponent(url.searchParams.get('state'));
    return route.fulfill({contentType:'text/html',body:'<!doctype html><a id="approve" href="'+callback+'">Approve fixture provider</a>'});
   }
   if(url.origin===APP){
    if(url.pathname==='/oauth-browser.js')return route.fulfill({contentType:'text/javascript',body:read('public/oauth-browser.js')});
    if(url.pathname==='/oauth-start.js')return route.fulfill({contentType:'text/javascript',body:read('public/oauth-start.js').replace('https://us-central1-blastybiz-9523e.cloudfunctions.net',FN)});
    if(url.pathname==='/BlastyBiz-OAuth-Start.html')return route.fulfill({contentType:'text/html',body:read('public/BlastyBiz-OAuth-Start.html').replace(/<link[^>]*>/g,'')});
    if(url.pathname==='/BlastyBiz-Connected.html')return route.fulfill({contentType:'text/html',body:completionHtml(uid)});
    if(url.pathname==='/start')return route.fulfill({contentType:'text/html',body:'<!doctype html><script src="/oauth-browser.js"></script><button id="connect">Connect fixture</button><script>document.getElementById("connect").onclick=()=>BBOAuth.begin('+JSON.stringify(FN+'/initiateGoogleOAuth?businessId=business')+','+JSON.stringify('fixture-'+uid)+');</script>'});
   }
   unexpected.push(url.origin+url.pathname);await route.abort('blockedbyclient');
  }catch(error){unexpected.push(error.stack);await route.abort('failed');}
 });
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try {
  const owner=await browser.newContext({serviceWorkers:'block'}),victim=await browser.newContext({serviceWorkers:'block'});
  await installRoutes(owner,'owner');await installRoutes(victim,'victim');
  const page=await owner.newPage(),other=await victim.newPage();
  await page.goto(APP+'/start');await page.click('#connect');await page.waitForURL(PROVIDER+'/**');
  assert.equal(starts.length,1);assert.equal(starts[0].headers.origin,APP,'real cross-origin top-level form retains exact Origin');
  assert.equal(starts[0].method,'POST');assert.match(starts[0].body.verifier,/^[a-f0-9]{64}$/);
  const providerUrl=page.url(),state=new URL(providerUrl).searchParams.get('state');
  const cookie=(await owner.cookies(FN)).find(c=>c.name==='__Secure-bb-oauth-'+state);
  assert(cookie,'callback cookie must actually be stored by Chromium');assert(cookie.secure&&cookie.httpOnly);assert.equal(cookie.sameSite,'Lax');assert.equal(cookie.path,'/');
  const inspector=await owner.newPage();await inspector.goto(FN+'/cookie-inspection');assert.equal(await inspector.evaluate(()=>document.cookie),'','HttpOnly callback secret is inaccessible to scripts');await inspector.close();
  await other.goto(bootstrapUrl);await other.getByRole('status').filter({hasText:'browser tab'}).waitFor();assert.equal(starts.length,1,'transferred bootstrap cannot start without original sessionStorage');
  await other.goto(providerUrl);await other.click('#approve');await other.waitForURL(FN+'/googleOAuthCallback**');
  await other.getByText('Invalid or expired OAuth state. Please try connecting again.').waitFor();
  assert.equal(exchanges.length,0,'transferred provider URL fails before token exchange');assert.equal(m.get('oauthNonces/'+state).phase,'oauth');
  assert(!callbacks[0].headers.cookie,'different context has no initiating cookie');
  await page.click('#approve');await page.waitForURL(APP+'/BlastyBiz-Connected.html**');await page.locator('#destination-choice').waitFor();
  assert.equal(exchanges.length,1);assert(callbacks[1].headers.cookie.includes(cookie.name+'='),'SameSite=Lax cookie arrives on real cross-site top-level callback GET');
  const connection='users/owner/businesses/business/platformConnections/google';
  assert(!m.get(connection),'sole destination never autoactivates');
  assert.equal(await page.getByRole('button',{name:'Connect this destination'}).isDisabled(),true);
  await page.selectOption('#destination-choice','account_location');await page.getByRole('button',{name:'Connect this destination'}).click();
  await page.waitForURL(url=>url.pathname==='/BlastyBiz-Connected.html'&&!url.hash&&!url.searchParams.has('pending'));
  assert.equal(m.get(connection).locationId,'location');assert(!m.get('users/victim/businesses/business/platformConnections/google'));
  assert.equal(await page.evaluate(state=>sessionStorage.getItem('bb-oauth-attempt:'+state),state),null,'explicit success clears same-tab proof');
  assert(!(await owner.cookies(FN)).some(c=>c.name===cookie.name),'callback clears cookie');
  assert.equal(unexpected.length,0,unexpected.join('\n'));
  console.log('PASS real Chromium HTTPS interception: bridge Origin, Secure/HttpOnly/SameSite=Lax cookie roundtrip, transferred bootstrap/provider rejection before exchange, authenticated explicit sole-destination completion.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
