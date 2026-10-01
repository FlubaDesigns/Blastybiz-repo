// Boot the actual preview page and click its action. Provider calls stay mocked.
'use strict';
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('public/BlastyBiz-Listing-Preview.html','utf8');
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const main=scripts.find(m=>m[2].includes('var PLATFORM_META'))[2];
const bootstrap=scripts.find(m=>m[1].includes('module')&&m[2].includes('auth.authStateReady'))[2].replace(/^import .*;\s*$/gm,'');
let checks=0;const ok=(value,message)=>{assert(value,message);checks++;};
const tick=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
function setup({failLoad=false}={}){
 const dom=new JSDOM(html,{url:'https://blastybiz.com/BlastyBiz-Listing-Preview.html?bizId=b&draftId=d',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
 const w=dom.window;let boot,calls=[],reject=true,revision=1;
 const data={adId:'a',adName:'Saved blast',campaignId:'c',campaignName:'GEM',revision:1,name:'David',adaptations:{facebook:'Saved Facebook copy',yelp:'Saved Yelp copy'},platformStatus:{facebook:'approved',yelp:'approved'},imagesByPlatform:{facebook:['https://example.com/car.jpg'],yelp:['https://example.com/car.jpg']}};
 Object.assign(w,{auth:{authStateReady:()=>Promise.resolve()},db:{},onAuthStateChanged:(auth,callback)=>{boot=callback({uid:'u',getIdToken:async()=> 'fixture'});},doc:(db,...parts)=>parts.join('/'),getDoc:async path=>{if(failLoad)throw Error('Connection lost');return {exists:()=>true,data:()=>path==='users/u'?{activeBusiness:'b'}:{...data,revision}};},BBBlasty:{fire(){}},fetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});await tick();return {ok:!reject,status:reject?503:200,json:async()=>reject?{error:'Connection unavailable'}:{}};}});
 for(const file of ['escape-utils.js','platforms-authority.js','business-form.js','schedule-utils.js','lifecycle-ui.js'])w.eval(fs.readFileSync('public/'+file,'utf8'));
 w.eval(main);w.eval(bootstrap);
 return {dom,w,calls,boot:async()=>{await tick();await boot;},allow:()=>{reject=false;},stale:()=>{revision=2;}};
}
(async()=>{
 const f=setup();const {w}=f,button=w.document.getElementById('publish-btn');
 ok(button.disabled,'button stays disabled while its action is loading');await f.boot();
 ok(w.document.querySelector('.pub-post-text').textContent==='Saved Facebook copy','real preview rail initializes and displays saved copy');
 ok(w.document.getElementById('v1-publish-schedule').textContent.includes('Send Now'),'boot reaches scheduling setup after rendering');
 ok(typeof w._firestoreApprove==='function'&&!button.disabled&&button.textContent.includes('Blast It!'),'Blast It becomes ready with a connected handler');
 const scheduled=w.document.querySelector('[value="schedule"]');scheduled.checked=true;scheduled.dispatchEvent(new w.Event('change',{bubbles:true}));ok(button.textContent==='Schedule Blast','schedule retains a clear action');
 const now=w.document.querySelector('[value="now"]');now.checked=true;now.dispatchEvent(new w.Event('change',{bubbles:true}));ok(button.textContent.includes('Blast It!'),'returning to Send Now restores Blast It');
 const one=w.publishBlast(),two=w.publishBlast();await Promise.all([one,two]);
 ok(f.calls.length===1&&f.calls[0].url.endsWith('/approveDraft'),'rapid taps use one existing approval request');
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].body)),{draftId:'d',businessId:'b',platformKeys:['facebook','yelp']});checks++;
 ok(!button.disabled&&w.document.getElementById('pub-warn').textContent.includes('Connection unavailable'),'backend failure is visible and retry remains available');
 f.allow();await w.publishBlast();ok(f.calls.length===2&&button.textContent.includes('Published'),'retry reaches the publishing-status handoff');
 f.stale();await w.publishBlast();ok(f.calls.length===2&&w.document.getElementById('pub-warn').textContent.includes('updated'),'stale draft cannot submit a changed blast');
 w._firestoreApprove=undefined;await w.publishBlast();ok(w.document.getElementById('pub-warn').textContent.includes('not finished loading'),'unavailable action is reported instead of silently doing nothing');
 f.dom.window.close();
 const broken=setup({failLoad:true});await broken.boot();const retry=broken.w.document.getElementById('publish-btn');
 ok(retry.textContent==='Reload blast'&&!retry.disabled&&broken.w.document.getElementById('pub-warn').textContent.includes('Connection lost'),'startup failure gives a visible explanation and reload control');broken.dom.window.close();
 console.log('PASS: '+checks+' complete preview startup and Blast button assertions.');
})().catch(e=>{console.error(e);process.exitCode=1;});
