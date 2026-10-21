'use strict';
// Exercise production editor functions, narrow Firestore writers and AI handlers.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const html=fs.readFileSync('public/BlastyBiz.html','utf8');
const controller=html.slice(html.indexOf('// ── Campaign memory:'),html.indexOf('function _showCreateCampMemorySaved'));
const status=html.slice(html.indexOf('function _showCreateCampMemorySaved'),html.indexOf('\n}',html.indexOf('function _showCreateCampMemorySaved'))+2);
const writers=html.slice(html.indexOf('window._bbSaveCampaignMemory ='),html.indexOf('// ── Global business facts'));
const response=()=>({status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
(async()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://blastybiz.com/BlastyBiz',virtualConsole:new VirtualConsole()});
 const w=dom.window,writes=[],toasts=[],timers=new Map();let timerId=0;
 w.setTimeout=fn=>{timers.set(++timerId,fn);return timerId;};w.clearTimeout=id=>timers.delete(id);
 w.activeBizId='qrgear';w.currentUser={uid:'owner'};w.profile={name:'QR Gear',globalMemory:'Established identity'};
 w.activeCampaignId='businesses';w.campaigns=[{id:'businesses',name:'Website retailers',campaignMemory:'Sell on your website'},{id:'creators',name:'Creator earnings',campaignMemory:'Earn 25% from your ideas'}];
 w.renderFactoidQuickLook=()=>{};w.showToast=t=>toasts.push(t);
 w._bbSaveCampaignMemory=async(c,text,target)=>writes.push({c,text,target});
 w.eval(controller+status);w.initTeachAIAccordion();
 assert.equal(w.document.getElementById('tai-memory-text').value,'Sell on your website');
 assert.match(w.document.getElementById('tai-memory-working').textContent,/Website retailers/);
 const field=w.document.getElementById('tai-memory-text');field.value='Business-specific offer';w.debounceAIMemorySave();
 assert.equal(w.profile.globalMemory,'Established identity');
 assert.equal(w.document.getElementById('create-camp-memory-text').value,'Business-specific offer');
 // Even if navigation races a delayed callback, its original target is retained.
 w.activeCampaignId='creators';w.syncCampaignMemoryEditors();await w.flushCampaignMemoryEdits();
 assert.equal(writes[0].c,'businesses');assert.equal(writes[0].target.businessId,'qrgear');
 assert.equal(field.value,'Earn 25% from your ideas');assert.equal(w.campaigns[1].campaignMemory,'Earn 25% from your ideas');
 // Clearing a brief is a real empty write, never a fallback to another campaign.
 field.value='';await w.saveAIMemoryNow();assert.equal(writes.at(-1).text,'');assert.equal(w.campaigns[1].campaignMemory,'');
 // Failed saves remain retryable and cannot claim success.
 w._bbSaveCampaignMemory=async()=>{throw Error('offline');};field.value='Keep this';w.debounceAIMemorySave();
 await assert.rejects(w.flushCampaignMemoryEdits(),/offline/);assert.match(w.document.getElementById('tai-save-status').textContent,/retry/);assert.equal(field.value,'Keep this');
 w._bbSaveCampaignMemory=async(c,text,target)=>writes.push({c,text,target});await w.saveAIMemoryNow();assert.equal(writes.at(-1).text,'Keep this');
 // Three rapid edits cannot let an older in-flight write overwrite the last edit.
 const gate=deferred(),ordered=[];let calls=0;
 w._bbSaveCampaignMemory=async(c,text)=>{if(++calls===1)await gate.promise;ordered.push(text);};
 field.value='first';w.debounceAIMemorySave();const saving=w.flushCampaignMemoryEdits();await Promise.resolve();
 field.value='second';w.debounceAIMemorySave();field.value='last';w.debounceAIMemorySave();const last=w.flushCampaignMemoryEdits();gate.resolve();await saving;await last;
 assert.deepEqual(ordered,['first','last']);assert.equal(w.campaigns[1].campaignMemory,'last');
 // No campaign means no memory write.
 w.activeCampaignId=null;w.syncCampaignMemoryEditors();assert(field.disabled);await w.saveAIMemoryNow();assert.match(toasts.at(-1),/Choose a campaign/);
 // Sharing opens a review; neither opening nor canceling writes business memory.
 w.activeCampaignId='creators';w.syncCampaignMemoryEditors();const dialog=w.document.getElementById('business-memory-dialog');
 dialog.showModal=()=>dialog.open=true;dialog.close=()=>dialog.open=false;
 let shared=[];w._bbAppendBusinessMemory=async(f,t)=>{shared.push({f,t});return 'Established identity\n'+f;};
 field.value='Campaign offer only';field.setSelectionRange(0,0);w.openBusinessMemoryReview('tai-memory-text');assert(dialog.open);assert.equal(shared.length,0);assert.equal(w.document.getElementById('business-memory-fact').value,'');
 await w.confirmBusinessMemoryReview();assert.equal(shared.length,0);assert.match(w.document.getElementById('business-memory-error').textContent,/Enter the fact/);
 const fact=w.document.getElementById('business-memory-fact');fact.value='We print custom QR merchandise';
 w.activeBizId='other';await w.confirmBusinessMemoryReview();assert.equal(shared.length,0);w.activeBizId='qrgear';
 await w.confirmBusinessMemoryReview();assert.equal(shared[0].f,'We print custom QR merchandise');assert.match(w.profile.globalMemory,/Established identity\nWe print/);assert.equal(field.value,'Campaign offer only');
 // Real writer functions: exact target, field-only campaign update, append transaction.
 const database={'users/owner/businesses/qrgear':{globalMemory:'Original company facts'},'users/owner/businesses/qrgear/campaigns/creators':{campaignMemory:'Old',name:'Creator',unrelated:'preserve'}};
 const c={window:{},db:{},currentUser:{uid:'owner'},activeBizId:'qrgear',doc:(_, ...parts)=>parts.join('/'),
  updateDoc:async(ref,data)=>{Object.assign(database[ref],data);},
  runTransaction:async(_,fn)=>fn({get:async ref=>({exists:()=>!!database[ref],data:()=>database[ref]}),update:(ref,data)=>Object.assign(database[ref],data)})};
 vm.runInNewContext(writers,c);const target={uid:'owner',businessId:'qrgear'};
 await c.window._bbSaveCampaignMemory('creators','25% offer',target);assert.equal(database['users/owner/businesses/qrgear'].globalMemory,'Original company facts');assert.equal(database['users/owner/businesses/qrgear/campaigns/creators'].unrelated,'preserve');
 assert.equal(await c.window._bbAppendBusinessMemory('New approved fact',target),'Original company facts\nNew approved fact');
 assert.equal(await c.window._bbAppendBusinessMemory('New approved fact',target),'Original company facts\nNew approved fact');
 c.currentUser.uid='different';await assert.rejects(c.window._bbSaveCampaignMemory('creators','wrong owner',target));
 // The separate Memory page reads canonical campaigns and retains save/score scope.
 const memoryPage=fs.readFileSync('public/BlastyBiz-Memory.html','utf8');
 const memoryDom=new JSDOM(memoryPage,{runScripts:'outside-only',url:'https://blastybiz.com/BlastyBiz-Memory?camp=creators',virtualConsole:new VirtualConsole()});
 const m=memoryDom.window,paths=[];m.currentUser={uid:'owner',getIdToken:async()=>'fixture'};m.activeBizId='qrgear';m.activeCampId=null;m.campaigns=[];m.facts=[];
 m.eval(memoryPage.match(/let memScope\s*=.*;/)[0].replace('let ', 'var '));assert.equal(m.eval('memScope'),'campaign');
 m.db={};m.doc=(_, ...p)=>p.join('/');m.collection=m.doc;m.getDoc=async()=>({exists:()=>true,data:()=>({activeCampaign:'businesses'})});
 m.getDocs=async()=>({docs:[{id:'creators',data:()=>({name:'Creators'})},{id:'old',data:()=>({name:'Archived',status:'archived'})}]});
 m.eval(memoryPage.slice(memoryPage.indexOf('async function loadCampaigns()'),memoryPage.indexOf('window._memDelete =')));await m.loadCampaigns();
 assert.equal(m.activeCampId,'creators');assert.equal(m.document.getElementById('mem-camp-select').options.length,2);
 m.CF='https://fixture.invalid';m.toast=()=>{};m.renderFacts=()=>{};m.serverTimestamp=()=>123;m.fetch=async()=>({ok:true,json:async()=>({score:8})});
 const factGate=deferred();m.addDoc=async(path)=>{paths.push(path);await factGate.promise;return {id:'fact'};};m.updateDoc=async path=>paths.push(path);
 m.document.getElementById('mem-add-text').value='Campaign-only fact';m.eval(memoryPage.slice(memoryPage.indexOf('window.addMemFact ='),memoryPage.indexOf('onAuthStateChanged(auth,')));
 const factSave=m.addMemFact();m.activeCampId='different';m.activeBizId='other';m.eval("memScope='global'");factGate.resolve();await factSave;
 assert(paths.every(p=>p.startsWith('users/owner/businesses/qrgear/campaigns/creators/facts')));
 m.confirm=()=>false;m.document.getElementById('mem-add-text').value='Review me';await m.addMemFact();assert.equal(paths.length,2,'cancelled company-wide fact has no write');
 memoryDom.window.close();
 dom.window.close();
 // Prompt capture exercises actual production endpoints without provider calls.
 const ai=fs.readFileSync('functions/modules/ai.js','utf8'),prompts=[];
 const common={exports:{},require:require('node:module').createRequire(require('node:path').resolve('functions/modules/ai.js')),onRequest:(_,fn)=>fn,withAuth:fn=>fn,console,bbLog(){},reserveAiAction:async()=>{},AI_DEFAULTS:{},
  loggedAI:async(uid,fn,body,prompt,options)=>{prompts.push({fn,prompt,options});return {text:JSON.stringify(fn==='chatCampaign'?{done:true,campaignMemory:'Creator-only details'}:{adaptations:{facebook:'Fixture'}})};},
  _getAdminPlatformDocs:async()=>({}),PLATFORM_DOCS:{},platformAuthority:{byId:{}},buildPlatformBlock:()=>'',db:{},admin:{}};
 vm.runInNewContext(ai.slice(ai.indexOf('exports.adaptListing ='),ai.indexOf('exports.resolveCategories =')),common);
 const res=response();await common.exports.adaptListing({body:{listing:{globalMemory:'Company facts',campaignMemory:'Creator campaign, 25% of profit',campaignContext:'People seeking income'},platforms:[],tone:'friendly'}},res,{uid:'owner'});
 assert(res.body?.adaptations);assert.match(prompts[0].prompt,/selected campaign controls its audience, offer, and message/i);assert.match(prompts[0].prompt,/Do not carry an old promotion/);assert.match(prompts[0].prompt,/Creator campaign, 25%/);
 vm.runInNewContext(ai.slice(ai.indexOf('exports.chatCampaign ='),ai.indexOf('exports.scoreFact =')),common);
 await common.exports.chatCampaign({method:'POST',body:{conversationHistory:[{role:'user',content:'For creators'}],businessProfile:{globalMemory:'Company identity'},collectedData:{campaignName:'Creators'}}},response(),{uid:'owner'});
 assert.match(prompts.at(-1).options.system,/do not rewrite, expand, or return business-wide memory/);
 // Category briefing must not even receive campaign values as company context.
 const cat={exports:{},require:common.require,onRequest:(_,fn)=>fn,setCors(){},crypto:require('node:crypto'),checkUidRateLimit:async()=>true,readFlubaProviderKey:async()=>'fixture-key',trackAiUsage:async()=>{},bbLog(){},classifyAiError:()=>'',aiRequestContext:()=>({}),
  fetch:async(url,opts)=>{const text=JSON.parse(opts.body).contents[0].parts[0].text;prompts.push({prompt:text});return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'Retail'}]}}]})};}};
 vm.runInNewContext(ai.slice(ai.indexOf('exports.suggestCategory ='),ai.indexOf('// ── previewAds')),cat);
 await cat.exports.suggestCategory({method:'POST',headers:{},ip:'fixture',body:{bizName:'QR Gear',story:'Custom merchandise',campaignName:'PRIVATE_CAMPAIGN',campaignAbout:'PRIVATE_ABOUT',campaignAudience:'PRIVATE_AUDIENCE',offer:'PRIVATE_OFFER'}},response());
 const brief=prompts.at(-2).prompt;assert.match(brief,/Exclude campaign-specific offers/);assert(!brief.includes('PRIVATE_'));
 console.log('PASS campaign memory: default scope, campaign/business/owner isolation, empty saves, failures/retry, ordered autosaves, explicit sharing, exact Firestore writes and AI prompt boundaries.');
})().catch(e=>{console.error(e);process.exitCode=1;});
