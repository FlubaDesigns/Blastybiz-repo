'use strict';
// Read-only public/admin acceptance through the existing Main identity.
// No provider generation, settings save, customer email, payment or publication.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const {isPublic,canonical,ORIGIN}=require('./public-site.cjs');
async function run({idToken,ownerUid}) {
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REF,'refs/heads/main');assert(process.env.GOOGLE_APPLICATION_CREDENTIALS);assert.match(process.env.RELEASE_SHA||'',/^[a-f0-9]{40}$/);
 const admin=require('../functions/node_modules/firebase-admin');const app=admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:'blastybiz-9523e'},'section1-readonly'),db=app.firestore();
 try {
  const before=(await db.doc('config/aiSettings').get()).data()||{};
  const adminConfig=(await db.doc('config/admins').get()).data();assert(adminConfig?.emails?.includes('info@blastybiz.com'),'Existing canonical admin configuration required; acceptance must not seed or repair access.');
  assert(idToken&&ownerUid,'The existing Authorization Engine owner handoff is required');
  const identity=await app.auth().verifyIdToken(idToken,true);
  assert.equal(identity.uid,ownerUid);assert.equal(identity.email_verified,true);
  assert(adminConfig.emails.includes(identity.email),'Existing administrator membership required');
  const base='https://us-central1-blastybiz-9523e.cloudfunctions.net/';
  for(const name of ['adminGetAiSettings','adminSetAiSettings']){const r=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN},body:'{}',signal:AbortSignal.timeout(30000)});assert.equal(r.status,401,name+' rejects unsigned requests');}
  const response=await fetch(base+'adminGetAiSettings',{headers:{Authorization:'Bearer '+idToken,Origin:ORIGIN},signal:AbortSignal.timeout(30000)});assert(response.ok,'Authenticated settings read');const data=await response.json();
  for(const key of ['provider','fastModel','smartModel']) {assert.equal(typeof data[key],'string');if(before[key])assert.equal(data[key],before[key]);}
  assert.deepEqual(data.providers.map(p=>p.id).sort(),['anthropic','gemini']);assert(data.providers.find(p=>p.id===data.provider)?.configured,'Active provider remains configured');
  for(const origin of [ORIGIN,'https://www.blastybiz.com','https://blastybiz-9523e.web.app']){
    const get=async file=>{const r=await fetch(origin+'/'+file+'?verify='+Date.now(),{signal:AbortSignal.timeout(30000)});assert(r.ok,file+' available');return r.text();};
    assert.equal(JSON.parse(await get('release.json')).commit,process.env.RELEASE_SHA);
    for(const file of ['sitemap.xml','robots.txt','admin-ai-settings.js','global-style.css','BlastyBiz-Admin.html','BlastyBiz-About.html','BlastyBiz-Privacy.html','BlastyBiz-Admin-Operate.html','BlastyBiz-Platform-google.html','BlastyBiz-Plan-Pro.html'])assert.equal(await get(file),fs.readFileSync('public/'+file,'utf8'),file+' matches Main');
    const html=await get('BlastyBiz-Admin');const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;w.eval(await get('admin-ai-settings.js'));await w.createAdminAiSettings({request:async()=>data}).load();assert.equal(w.document.getElementById('ai-fast-model').value,data.fastModel);assert.equal(w.document.getElementById('ai-smart-model').value,data.smartModel);assert(!w.document.getElementById('ai-save-button').disabled);w.close();
  }
  const urls=[...fs.readFileSync('public/sitemap.xml','utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
  for(const url of urls){const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,url+' clean canonical route');const html=await r.text();assert(html.includes('href="'+url+'"'),'Self canonical');}
  for(const file of ['BlastyBiz-Home.html','BlastyBiz-About.html','BlastyBiz-Platform-google.html']){const r=await fetch(ORIGIN+'/'+file,{redirect:'manual',signal:AbortSignal.timeout(30000)});assert([301,302,307,308].includes(r.status),file+' legacy redirect');assert.equal(new URL(r.headers.get('location'),ORIGIN).pathname,new URL(canonical(file)).pathname);}
  assert.deepEqual((await db.doc('config/aiSettings').get()).data()||{},before,'Saved provider/models unchanged');
  console.log('PASS LIVE section 1: exact Main on three hosts; all canonical public routes and legacy redirects; authenticated admin capabilities with saved models preserved; unauthenticated admin calls rejected; live controls rendered with actual settings. No configuration save, paid AI, email, payment or publishing.');
 } finally {await app.delete();}
}
module.exports={run};
if(require.main===module){console.error('Run through the existing Authorization Engine owner handoff.');process.exitCode=1;}

