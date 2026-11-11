'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const {database,admin}=require('./lib/test-firestore.cjs'),{createAdService}=require('../functions/lib/ads');
const settle=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));};
const B='users/u/businesses/b',C=B+'/campaigns/c',A=C+'/ads/a',D=B+'/listingDrafts/sent',J=B+'/publishJobs/sent_google';
function fixture(){return database({[B]:{},[C]:{name:'Campaign'},[A]:{id:'a',campaignId:'c',businessId:'b',name:'Changed Ad',revision:5,status:'ready',platforms:['google'],adaptations:{google:'Newer reusable copy'},imageRefs:[],schedule:{enabled:true}},
 [C+'/images/old']:{url:'https://blastybiz.com/img/storefront.jpg',retired:true},[C+'/images/other']:{url:'https://blastybiz.com/img/people-dashboard.jpg'},
 [D]:{status:'approved',adId:'a',campaignId:'c',packet:{adName:'Original post',offer:'Original offer',adaptations:{google:'Frozen packet copy'},imageRefs:[{id:'old',url:'https://blastybiz.com/img/storefront.jpg'}],enabledPlatforms:['google']}},
 [J]:{draftId:'sent',adId:'a',campaignId:'c',platform:'google',status:'success',payload:{adaptedContent:'Actual sent copy',imageUrls:['https://blastybiz.com/img/storefront.jpg']}}});}
function browser(html='<div id="history"></div>'){
 const dom=new JSDOM(html,{url:'https://blastybiz.com/BlastyBiz-Dashboard',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
 for(const file of ['escape-utils.js','blastybiz-menu.js','platforms-authority.js','schedule-utils.js','lifecycle-ui.js','lifecycle-status.js','dashboard-posts.js'])w.eval(fs.readFileSync('public/'+file,'utf8').split('function _revealAdminNav')[0]);return dom;
}
(async()=>{
 const m=fixture(),service=createAdService(m.db,admin),before=[m.get(A),m.get(D),m.get(J)],request={action:'derive',businessId:'b',campaignId:'c',sourceAdId:'a',sourceBlastId:'sent',adId:'new',requestId:'reuse'};
 const results=await Promise.all([service('u',request),service('u',request)]);assert.equal(results[0].ad.id,results[1].ad.id);assert.equal((await m.db.doc(C).collection('ads').get()).size,2);
 const made=m.get(C+'/ads/new');assert.equal(made.adaptations.google,'Actual sent copy');assert.equal(made.status,'draft');assert.equal(made.platformStatus.google,'needs-review');assert.equal(made.sourceAdId,'a');assert.equal(made.sourceBlastId,'sent');assert(!made.schedule);
 assert.equal(made.imageRefs.length,1);assert.notEqual(made.imageRefs[0].id,'old');assert.equal(m.get(C+'/images/'+made.imageRefs[0].id).url,made.imageRefs[0].url);assert(made.knownImageIds.includes('other'));assert(m.get(C+'/images/old').retired);
 await service('u',{action:'save',businessId:'b',campaignId:'c',adId:'new',expectedRevision:1,requestId:'edit',creative:{adaptations:{google:'Edited new draft'},imageRefs:made.imageRefs.map(i=>({id:i.id}))}});
 assert.deepEqual([m.get(A),m.get(D),m.get(J)],before,'reuse and edit preserve original Ad, frozen Blast and delivery');
 for(const [uid,patch] of [['foreign',{}],['u',{businessId:'wrong'}],['u',{campaignId:'wrong'}],['u',{sourceBlastId:'absent'}]])await assert.rejects(()=>service(uid,{...request,...patch,adId:'denied',requestId:'denied'}));
 await assert.rejects(()=>service('u',{...request,action:'create',adId:'not_derive'}),/only create/);
 const failure=fixture(),retry=createAdService(failure.db,admin);failure.failNext();await assert.rejects(()=>retry('u',request),/offline/);assert(!failure.get(C+'/ads/new'));await retry('u',request);assert.equal((await failure.db.doc(C).collection('ads').get()).size,2);
 const dom=browser(),w=dom.window;let calls=[],navigate=[],lost=true;
 w.fetch=async(_,options)=>{const body=JSON.parse(options.body);calls.push(body);const result=await service('u',body);if(lost){lost=false;throw Error('Response lost');}return {ok:true,json:async()=>result};};
 const rows=w.BBLifecycleStatus.historyRows([{...m.get(D),id:'sent'}],[{...m.get(J),jobId:'job',createdAt:'2026-11-10T12:00:00Z'}]);assert.equal(rows[0].image,'https://blastybiz.com/img/storefront.jpg');assert.equal(rows[0].posted,1);
 let current=true;const ctx={businessId:'b',userId:'u',token:async()=> 'fixture',isCurrent:()=>current,navigate:url=>navigate.push(url)};
 const host=w.document.getElementById('history');w.BBLifecycleStatus.renderHistory(host,rows,ctx);const button=[...host.querySelectorAll('button')].find(b=>b.textContent==='Use again');button.click();button.click();await settle();assert.equal(calls.length,1);assert(host.textContent.includes('Response lost'));assert(!button.disabled);
 const saved=[...Array(w.sessionStorage.length)].map((_,i)=>[w.sessionStorage.key(i),w.sessionStorage.getItem(w.sessionStorage.key(i))]);assert.equal(saved.length,1);
 // Reload retains only the pending request identity, never a content copy.
 const again=browser(),v=again.window;for(const [k,value] of saved)v.sessionStorage.setItem(k,value);v.fetch=w.fetch;
 v.BBLifecycleStatus.renderHistory(v.document.getElementById('history'),rows,ctx);[...v.document.querySelectorAll('button')].find(b=>b.textContent==='Use again').click();await settle();assert.equal(calls.length,2);assert.equal(calls[0].adId,calls[1].adId);assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(navigate.length,1);assert(navigate[0].includes('bizId=b')&&navigate[0].includes('cid=c'));assert.equal(v.sessionStorage.length,0);
 current=false;v.BBLifecycleStatus.renderHistory(v.document.getElementById('history'),rows,ctx);[...v.document.querySelectorAll('button')].find(b=>b.textContent==='Use again').click();await settle();assert.equal(calls.length,2,'stale business controls do nothing');
 current=true;w.BBLifecycleStatus.renderHistory(host,rows,{...ctx,beforeReuse:async()=>{throw Error('Current save failed');}});[...host.querySelectorAll('button')].find(b=>b.textContent==='Use again').click();await settle();assert(host.textContent.includes('Current save failed'));assert.equal(calls.length,2,'failed current save prevents creation');
 const ads=[{id:'old',campaignId:'c',status:'draft',updatedAt:'2026-01-01'}, {id:'sent',campaignId:'c',status:'ready',revision:2,updatedAt:'2026-11-10'}, {id:'scheduled',campaignId:'c',status:'ready',schedule:{enabled:true},updatedAt:'2026-11-12'}, {id:'latest',campaignId:'c',status:'draft',updatedAt:'2026-11-11',name:'Latest saved',imageRefs:[{url:'https://blastybiz.com/img/storefront.jpg'}],adaptations:{google:'Fresh saved text'}}];
 const drafts=[{campaignId:'c',adId:'sent',status:'approved',packet:{adRevision:2}}];assert.equal(w.BBReturnVisits.currentDraft(ads,drafts).id,'latest');w.BBReturnVisits.renderDraft(host,ads,drafts,'b');assert(host.textContent.includes('Fresh saved text'));assert(host.querySelector('a').href.includes('adId=latest'));
 assert.equal(w.BBLifecycleStatus.historyRows([{...m.get(D),id:'sent'}],[{...m.get(J),jobId:'job',status:'manual_required'}])[0].posted,0);
 dom.window.close();again.window.close();
 await dashboard();console.log('PASS section 5: canonical sent-content reuse, atomic single draft, identity across retry/reload, preserved source/approval/photos, owner boundaries, fresh saved-draft selection, real dashboard wiring and stale-business reads.');
})().catch(e=>{console.error(e);process.exitCode=1;});
async function dashboard(){
 const html=fs.readFileSync('public/BlastyBiz-Dashboard.html','utf8'),dom=browser(html),w=dom.window;let finish,blocked,release;const done=new Promise(r=>finish=r);let pendingWaits=0,serverReads=[];
 w.auth={authStateReady:async()=>{}};w.db={};w.onAuthStateChanged=(_,cb)=>cb({uid:'u',email:'fixture@example.invalid',getIdToken:async()=> 'fixture'}).then(finish,finish);
 w.doc=w.collection=(_, ...p)=>p.join('/');w.query=p=>p;w.orderBy=w.limit=()=>{};w.setDoc=async()=>{};w.waitForPendingWrites=async()=>{pendingWaits++;};
 const snap=data=>({exists:()=>true,data:()=>data});let accountReads=0;w.getDoc=async()=>snap({});w.getDocFromServer=async()=>++accountReads===1?{...snap({lastActiveAt:'pending',activeBusiness:'other'}),metadata:{hasPendingWrites:true}}:snap({plan:'pro',activeBusiness:'b'});
 const records=p=>p.endsWith('/businesses')?[{id:'b',name:'First business'},{id:'other',name:'Second business'}]:p.endsWith('/campaigns')?[{id:'c',name:'Campaign'}]:p.endsWith('/ads')?[{id:'a',status:'draft',name:p.includes('/other/')?'Other draft':'Saved draft',updatedAt:'2026-11-11',adaptations:{google:'Server copy'},imageRefs:[]}]:[];
 w.getDocs=async()=>({docs:[],empty:true});w.getDocsFromServer=async p=>{serverReads.push(p);if(blocked===p)await new Promise(r=>release=r);const docs=records(p).map(({id,...d})=>({id,data:()=>d}));return {docs,empty:!docs.length};};
 w.fetch=async()=>({text:async()=>'',ok:true,json:async()=>({schedules:[],legacy:[]})});
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(/src=|importmap/.test(match[1]))continue;let code=match[2];if(match[1].includes('module'))code='(function(){'+code.replace(/import\s+[\s\S]*?\sfrom\s*['"][^'"]+['"];?/g,'')+'})()';require('node:vm').runInContext(code,dom.getInternalVMContext());}
 await done;assert(w.document.getElementById('dashboard-draft').textContent.includes('Saved draft'));assert(pendingWaits>=2);assert(serverReads.some(p=>p.endsWith('/ads')));
 blocked='users/u/businesses/b/campaigns';const first=w.loadBusinessContext('b');await settle();assert(release);await w.switchBusiness('other');assert(w.document.getElementById('dashboard-draft').textContent.includes('Other draft'));release();await first;assert(!w.document.getElementById('dashboard-draft').textContent.includes('Saved draft'));assert(w.document.getElementById('dashboard-campaign-list').querySelector('a').href.includes('bizId=other'));dom.window.close();
}
