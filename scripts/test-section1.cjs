'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const capabilities=require('../functions/lib/ai-capabilities');
const read=f=>fs.readFileSync(f,'utf8'),tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const providers=await capabilities.adminCapabilities(async key=>{if(key==='GEMINI_API_KEY')return 'fixture-only';throw Error('unavailable');});
 assert.deepEqual(providers.map(p=>p.id).sort(),['anthropic','gemini']);assert.equal(providers[0].configured,true);assert.equal(providers[1].configured,false);assert(!JSON.stringify(providers).includes('fixture-only'));
 const dom=new JSDOM(read('public/BlastyBiz-Admin.html'),{runScripts:'outside-only'}),w=dom.window,el=id=>w.document.getElementById(id);w.eval(read('public/admin-ai-settings.js'));
 const active={provider:'gemini',fastModel:'saved-model-v2',smartModel:'saved-smart-v2',configured:true,providers};let fail=false,saves=[],resolve;
 const ui=w.createAdminAiSettings({request:async(name,body)=>{if(name==='adminGetAiSettings'){if(fail)throw Error('offline');return active;}saves.push(body);await new Promise(r=>resolve=r);if(fail)throw Error('Readiness failed. Existing settings were preserved.');return {ok:true};}});
 assert(el('ai-save-button').disabled);await ui.load();assert.equal(el('ai-fast-model').value,'saved-model-v2');assert.equal(el('ai-smart-model').value,'saved-smart-v2');assert(!el('ai-provider').querySelector('[value="openai"],[value="grok"]'));assert(el('ai-provider').querySelector('[value="anthropic"]').disabled);
 el('ai-save-button').click();el('ai-save-button').click();assert.equal(saves.length,1);assert(el('ai-provider').disabled);resolve();await tick();assert.equal(el('ai-save-msg').textContent,'Saved.');assert.equal(saves[0].fastModel,'saved-model-v2');
 fail=true;el('ai-save-button').click();resolve();await tick();assert.match(el('ai-save-msg').textContent,/preserved/);assert.equal(el('ai-fast-model').value,'saved-model-v2');await assert.rejects(ui.load());assert(el('ai-save-button').disabled);dom.window.close();
 // Exercise the real exported handlers with database/provider fixtures, no real keys or writes.
 let settings={provider:'gemini',fastModel:'saved-model-v2',smartModel:'saved-smart-v2'},writes=0,modelOK=false;
 const context={exports:{},console,AbortSignal,fetch:async()=>({ok:modelOK}),require:name=>{
   if(name==='../lib/ai-capabilities')return capabilities;
   if(name==='../lib/fluba-provider-keys')return {readFlubaProviderKey:async()=>'fixture-only'};
   if(name==='../lib/shared')return {onRequest:(_,fn)=>fn,withAuth:(fn,options)=>{assert.equal(options.admin,true);return fn;},AI_DEFAULTS:{provider:'gemini',fastModel:'default',smartModel:'default'},db:{collection:()=>({doc:id=>({onSnapshot:()=>{},get:async()=>({exists:true,data:()=>id==='aiSettings'?settings:{}}),set:async(data)=>{writes++;if(id==='aiSettings')settings=data;}})})},admin:{firestore:{FieldValue:{serverTimestamp:()=>0,delete:()=>0}}},resetAiSettingsCache:()=>{}};
   if(name==='crypto')return require(name);if(name==='../lib/platforms')return require('../functions/lib/platforms');return {};
 }};
 // Other endpoint wrappers use the same helper without admin-only options.
 const originalRequire=context.require;context.require=name=>{const v=originalRequire(name);if(name==='../lib/shared')v.withAuth=(fn,options)=>{fn.adminOnly=options?.admin===true;return fn;};return v;};
 vm.runInNewContext(read('functions/modules/ai.js'),context);
 for(const n of ['adminGetAiSettings','adminSetAiSettings'])assert.equal(context.exports[n].adminOnly,true);
 async function run(name,body){const res={code:200,status(n){this.code=n;return this;},json(value){this.body=value;return this;}};await context.exports[name]({body},res,{email:'fixture@example.invalid'});return res;}
 assert.equal((await run('adminGetAiSettings')).body.fastModel,'saved-model-v2');
 for(const provider of ['openai','grok'])assert.equal((await run('adminSetAiSettings',{provider,fastModel:'m',smartModel:'m'})).code,400);
 assert.equal((await run('adminSetAiSettings',{provider:'gemini',fastModel:'m',smartModel:'m'})).code,409);assert.equal(writes,0);assert.equal(settings.fastModel,'saved-model-v2');
 modelOK=true;assert.equal((await run('adminSetAiSettings',{provider:'gemini',fastModel:'m',smartModel:'m'})).code,200);assert.equal(settings.fastModel,'m');
 // Crawl controls must block both private URL forms without hiding public pages.
 const {isPublic,canonical}=require('./public-site.cjs'),robots=read('public/robots.txt');
 const rules=robots.split('\n').filter(l=>l.startsWith('Disallow: ')).map(l=>l.slice(10));
 const blocked=url=>rules.some(rule=>{const end=rule.endsWith('$');return new RegExp('^'+rule.replace(/\$$/,'').split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+(end?'$':'')).test(url);});
 for(const file of fs.readdirSync('public').filter(f=>f.endsWith('.html')&&f!=='index.html')){
   const html=read('public/'+file);for(const route of ['/'+file,'/'+file.replace('.html','')])for(const suffix of ['','?check=1'])assert.equal(blocked(route+suffix),!isPublic(file),route+suffix);
   if(isPublic(file)){assert(html.includes('href="'+canonical(file)+'"'));assert(!/name="robots" content="noindex/.test(html));assert(read('public/sitemap.xml').includes(canonical(file)));}
 }
 console.log('PASS section 1: server-supported providers, saved models, unavailable/loading/error/double-save states, admin contracts, readiness preservation, canonical and private crawl coverage.');
})().catch(e=>{console.error(e);process.exitCode=1;});
