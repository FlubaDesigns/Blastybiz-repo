'use strict';
// Local-only Chromium smoke test for actual browser Origin behavior on the bridge's
// cross-origin top-level form POST. Never visits a real OAuth/provider endpoint.
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const secret='a'.repeat(64),profile=fs.mkdtempSync(path.join(os.tmpdir(),'bb-oauth-browser-'));
let origin,received;
const server=http.createServer((req,res)=>{
 if(req.url==='/oauthStart'){
  let data='';req.on('data',v=>data+=v);req.on('end',()=>{received={origin:req.headers.origin,body:new URLSearchParams(data),method:req.method};res.setHeader('Content-Type','text/html');res.end('<h1>Local OAuth form received</h1>');});return;
 }
 if(req.url.startsWith('/oauth-browser.js')){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync('public/oauth-browser.js'));return;}
 if(req.url.startsWith('/oauth-start.js')){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync('public/oauth-start.js','utf8').replace('https://us-central1-blastybiz-9523e.cloudfunctions.net/oauthStart','http://127.0.0.1:'+server.address().port+'/oauthStart'));return;}
 if(req.url.startsWith('/BlastyBiz-OAuth-Start.html')){
  const seed='<script>sessionStorage.setItem("bb-oauth-attempt:state",'+JSON.stringify(JSON.stringify({verifier:secret,expiresAt:Date.now()+600000}))+')</script>';
  res.setHeader('Content-Type','text/html');res.end(fs.readFileSync('public/BlastyBiz-OAuth-Start.html','utf8').replace('<script src="oauth-browser.js',seed+'<script src="oauth-browser.js'));return;
 }
 res.end('');
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://localhost:'+server.address().port;
 const child=spawn(process.env.CHROMIUM_PATH||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--metrics-recording-only','--password-store=basic','--user-data-dir='+profile,'--dump-dom',origin+'/BlastyBiz-OAuth-Start.html?state=state'],{stdio:['ignore','pipe','pipe']});
 let stderr='';child.stdout.resume();child.stderr.on('data',d=>stderr+=d);const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
 try{const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});assert.equal(code,0,stderr);assert(received,'No local form received');assert.equal(received.origin,origin);assert.equal(received.method,'POST');assert.equal(received.body.get('state'),'state');assert.equal(received.body.get('verifier'),secret);console.log('PASS Chromium: actual bridge cross-origin POST retains exact initiating Origin and sends verifier only in body.');}finally{clearTimeout(timer);}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{server.close();fs.rmSync(profile,{recursive:true,force:true});});
