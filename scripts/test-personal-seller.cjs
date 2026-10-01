'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const {createRequire}=require('node:module');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||'jsdom');
const read=p=>fs.readFileSync(p,'utf8');
const scripts=html=>[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!m[1].includes('src=')&&!m[1].includes('importmap'));
(async()=>{
 const login=read('public/BlastyBiz-Login.html');
 let dom=new JSDOM(login,{runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window;
 w.clearErr=()=>{};w.eval(read('public/business-form.js'));w.eval(scripts(login).find(m=>m[2].includes('function bbSignupSellerType'))[2]);
 for(const type of ['personal','business','personal']){
  w.document.getElementById('su-sellerType').value=type;w.bbSignupSellerType();
  assert.equal(w.document.getElementById('su-business').closest('.field').hidden,type==='personal');
  assert.equal(w.document.getElementById('su-role').required,type==='business');
  const values={sellerType:type,ownerName:'David',email:'d@example.com',phone:'9413751504'};
  assert.equal(w.BBSetup.validate(values).length,type==='personal'?0:2);
  assert.equal(w.BBSetup.collect('signup').sellerType,type);
 }dom.window.close();
 const setup=read('public/BlastyBiz-CreateBiz.html');
 dom=new JSDOM(setup,{url:'https://example.invalid/setup',runScripts:'outside-only',virtualConsole:new VirtualConsole()});w=dom.window;
 for(const file of ['business-form.js','blasty-registry.js','blasty-events.js','blasty-guidance.js','website-utils.js'])w.eval(read('public/'+file));
 w.eval(scripts(setup).find(m=>!m[1].includes('module'))[2]);
 w.document.getElementById('f-sellerType').value='personal';w.cbConfigureForm();
 assert(w.document.getElementById('f-role').closest('.cb-field').hidden);
 assert(w.document.getElementById('f-website').closest('.cb-field').hidden);
 assert(w.document.getElementById('cbs-story').hidden);
 assert(w.document.getElementById('f-category').closest('.cb-field').hidden);
 assert(w.document.getElementById('f-category').disabled);
 assert.match(w.document.getElementById('f-about').closest('.cb-field').textContent,/condition/);
 assert(!w.document.getElementById('f-city').disabled);
 assert(!w.document.getElementById('f-about').required);assert(!w.document.getElementById('f-offer').required);
 assert(w.document.getElementById('f-campName').required);
 assert.match(w.document.getElementById('f-about').closest('.cb-field').textContent,/optional/);
 w.document.getElementById('f-sellerType').value='business';w.cbConfigureForm();
 assert(!w.document.getElementById('f-category').closest('.cb-field').hidden);
 assert(!w.document.getElementById('f-category').disabled);
 w._bbProfileGlobal={sellerType:'personal'};const itemInput=w.document.createElement('input');itemInput.id='new-campaign-input';itemInput.value='GEM electric vehicle';w.document.body.appendChild(itemInput);w.ccCol={};
 let steps=w.BBBlasty.campaignSteps(w.ccCol);assert.match(steps[0].msg(),/condition/);assert.equal(steps[0].field(),'offer');
 w._bbProfileGlobal={sellerType:'business'};steps=w.BBBlasty.campaignSteps(w.ccCol);assert.match(steps[0].msg(),/offer or message/);
 dom.window.close();
 // Execute the real dashboard profile functions: a later edit must retain type.
 const app=read('public/BlastyBiz.html');dom=new JSDOM(app,{runScripts:'outside-only',virtualConsole:new VirtualConsole()});w=dom.window;
 Object.assign(w,{profile:{sellerType:'personal',name:'David',ownerName:'David'},profileLocationType:'physical',locationType:'physical',renderPlatformCats(){},updateCopyPreview(){},setProfileLocationType(){}});
 w.eval(app.slice(app.indexOf('function saveProfile() {'),app.indexOf('function setYN(field, val)')));
 w.loadProfile();assert.equal(w.document.querySelector('label[for="profile-name"]').textContent,'Seller name');assert(w.document.getElementById('profile-hours').hidden);
 w.document.getElementById('profile-phone').value='9413751504';w.saveProfile();assert.equal(w.profile.sellerType,'personal');assert.equal(w._bbProfileGlobal.sellerType,'personal');assert.equal(w.profile.ownerRole,'');assert.equal(w.profile.hours,'');
 w.profile={sellerType:'business',name:'Company'};w.loadProfile();assert(!w.document.getElementById('profile-hours').hidden);assert.equal(w.document.querySelector('label[for="profile-name"]').textContent,'Business Name');dom.window.close();
 // Personal identity uses Your Name only, including cache reload and blank company names.
 dom=new JSDOM(app,{url:'https://example.invalid',runScripts:'outside-only',virtualConsole:new VirtualConsole()});w=dom.window;
 Object.assign(w,{showTab(){},profile:{},profileLocationType:'physical',locationType:'physical',renderPlatformCats(){},updateCopyPreview(){},setProfileLocationType(){}});
 w.eval(app.slice(app.indexOf('function saveProfile() {'),app.indexOf('function setYN(field, val)')));
 w.eval(app.slice(app.indexOf('window._bbSetProfile = function(p) {'),app.indexOf('// _saveInsightToFirestore and _saveGlobalFactoidsToFirestore')));
 w._bbSetProfile({sellerType:'personal',ownerName:'Fixture Seller',name:'',locationType:'physical'});
 assert.equal(w.document.getElementById('profile-owner-name').value,'Fixture Seller');
 assert(w.document.getElementById('profile-name').hidden);
 assert(w.document.body.classList.contains('personal-seller'));
 assert.equal(w.getComputedStyle(w.document.getElementById('tab-profile')).display,'none');
 assert.equal(w.getComputedStyle(w.document.getElementById('tab-story')).display,'none');
 assert(w.document.querySelector('label[for="profile-name"]').hidden);
 assert(w.document.getElementById('biz-name-missing-banner').classList.contains('hidden'));
 assert.equal(JSON.parse(w.localStorage.getItem('bb_profile')).sellerType,'personal');
 w.document.getElementById('profile-owner-name').value='Updated Seller';w.saveProfile();
 assert.equal(w.profile.name,'Updated Seller');assert.equal(w.profile.ownerName,'Updated Seller');
 w._bbSetProfile(w.profile);w.profile=JSON.parse(w.localStorage.getItem('bb_profile'));w.loadProfile();
 assert.equal(w.profile.sellerType,'personal');assert.equal(w.profile.name,'Updated Seller');
 w.document.getElementById('profile-owner-name').value='';w.saveProfile();
 assert(w.document.getElementById('biz-name-missing-banner').classList.contains('hidden'));
 w._bbSetProfile({sellerType:'business',name:''});
 assert(!w.document.getElementById('profile-name').hidden);
 assert(!w.document.getElementById('biz-name-missing-banner').classList.contains('hidden'));
 dom.window.close();
 // Review reuses the existing campaign upload screen, including mobile navigation.
 dom=new JSDOM(app,{runScripts:'outside-only',virtualConsole:new VirtualConsole()});w=dom.window;
 let slide,scope,scrolled=false;
 w.createWizGoTo=n=>slide=n;w.setPhotoScope=v=>scope=v;
 w.document.getElementById('campaign-photos').scrollIntoView=()=>{scrolled=true;};
 w.eval(app.slice(app.indexOf('function openCampaignPhotos() {'),app.indexOf('async function createWizNext(')));
 w.openCampaignPhotos();assert.equal(slide,1);assert.equal(scope,'campaign');assert(scrolled);
 assert(w.document.querySelector('#create-slide-5 button[onclick="openCampaignPhotos()"]'));
 assert(w.document.querySelector('#campaign-photos input[type="file"]').multiple);
 dom.window.close();
 // Run the production selection resolver against owned-profile reads and writes.
 const selectSource=app.slice(app.indexOf('async function loadWorkspaceSelection('),app.indexOf('auth.authStateReady().then(() => {'));
 const writes=[];let records=[];let readFailure=false;
 const selection={db:{},collection:(...v)=>v,doc:(...v)=>v,getDocs:async()=>{if(readFailure)throw Error('Offline');return {docs:records.map(r=>({id:r.id,data:()=>r}))};},setDoc:async(...v)=>writes.push(v)};
 vm.runInNewContext(selectSource,selection);
 records=[{id:'personal',sellerType:'personal',ownerName:'Fixture Seller'},{id:'company',sellerType:'business'}];
 let resolved=await selection.loadWorkspaceSelection({uid:'u'},{activeBusiness:'personal'},null);
 assert.equal(resolved.active.sellerType,'personal');assert.equal(writes.length,0);
 resolved=await selection.loadWorkspaceSelection({uid:'u'},{activeBusiness:'missing'},null);
 assert.equal(resolved.active.id,'personal');assert.equal(writes.at(-1)[1].activeBusiness,'personal');
 resolved=await selection.loadWorkspaceSelection({uid:'u'},{activeBusiness:'personal'},'company');
 assert.equal(resolved.active.id,'company');assert.equal(writes.length,1);
 await assert.rejects(selection.loadWorkspaceSelection({uid:'u'},{activeBusiness:'personal'},'missing'),/no longer available/);
 records=[];resolved=await selection.loadWorkspaceSelection({uid:'u'},{activeBusiness:'missing',setupHandoff:{sellerType:'personal'}},null);
 assert.equal(resolved.active,null);assert.equal(writes.length,1);
 readFailure=true;await assert.rejects(selection.loadWorkspaceSelection({uid:'u'},{},null),/Offline/);
 // Exercise the actual chat closure and public Skip button through a saved listing.
 for(const prefilled of [true,false]){
  dom=new JSDOM(app,{url:'https://example.invalid',runScripts:'outside-only',virtualConsole:new VirtualConsole()});w=dom.window;
  const pending=[],saved=[];w.setTimeout=f=>{pending.push(f);return 1;};
  const flush=()=>{while(pending.length)pending.shift()();};
  Object.assign(w,{_bbProfileGlobal:{sellerType:'personal'},activeBizId:'b',campaigns:[],platforms:[],activeCampaignId:null,activeCampaignName:'',_sortCampaigns(){},_bbSaveCampaigns:async c=>saved.push(...c),fetch:()=>{throw Error('Optional skip must not require an AI call');}});
  for(const f of ['blasty-registry.js','blasty-events.js','blasty-guidance.js'])w.eval(read('public/'+f));
  const chat=scripts(app).find(m=>m[2].includes("const CC_CF ="))[2];
  w.eval(chat.slice(0,chat.indexOf('// STORY TAB'))+'\n})();');
  w.document.getElementById('new-campaign-input').value=prefilled?'GEM electric vehicle':'';
  w.openCampaignChat();flush();
  if(!prefilled){assert.equal(w.document.getElementById('camp-skip-btn').style.display,'none');w.campSkip();assert.equal(saved.length,0);w.document.getElementById('camp-chat-input').value='GEM electric vehicle';w.campSend();flush();}
  for(let i=0;i<4;i++){assert.equal(w.document.getElementById('camp-skip-btn').style.display,'inline');w.campSkip();flush();}
  assert.match(w.document.getElementById('cc-messages').textContent,/Anything else/);
  w.campSkip();await new Promise(r=>setImmediate(r));
  assert.equal(saved.length,1);assert.equal(saved[0].name,'GEM electric vehicle');assert.equal(saved[0].offer,'');assert.equal(saved[0].price,'');assert.equal(saved[0].campaignMemory,'GEM electric vehicle');dom.window.close();
 }
 // Call real AI handlers with a captured model boundary. No model or live writes.
 const file=path.resolve('functions/modules/ai.js'),req=createRequire(file);let captured=[];
 let storedType='personal';
 const ref={collection:()=>ref,doc:()=>ref,get:async()=>({exists:true,data:()=>({sellerType:storedType})}),onSnapshot:cb=>cb({exists:false})};
 const shared={db:ref,PLATFORM_DOCS:{},buildPlatformBlock:()=>'',onRequest:(_,f)=>f,withAuth:f=>f,reserveAiAction:async()=>{},trackAiUsage:async()=>{},callAI:async(prompt,options)=>{captured.push({prompt,options});return {text:'{"done":false,"message":"What condition is it in?","questions":[]}',usage:{},model:'fixture'};}};
 const c={exports:{},require:p=>p==='../lib/shared'?shared:req(p),console,Date,process:{env:{}},setTimeout,clearTimeout};vm.runInNewContext(read(file),c);
 const res=()=>({status(){return this},json(v){this.body=v;return this}});
 for(const type of ['personal','business']){
  await c.exports.chatCampaign({method:'POST',body:{conversationHistory:[],businessProfile:{sellerType:type,name:'David'},collectedData:{campaignName:'GEM vehicle'}}},res(),{uid:'u'});
  assert.match(captured.at(-1).options.system,type==='personal'?/pickup, delivery or shipping/:/in-store experience/);
  if(type==='personal'){assert.match(captured.at(-1).options.system,/Do not ask for these missing details again or block completion/);assert.match(captured.at(-1).options.system,/A business category is not needed for a personal sale/);}
  await c.exports.generateEnrichmentQuestions({body:{sellerType:type,businessName:'David',itemDetails:'GEM vehicle',existingInsights:[]}},res(),{uid:'u'});
  assert.match(captured.at(-1).prompt,type==='personal'?/private individual/:/local business marketing AI/);
  if(type==='personal')assert.match(captured.at(-1).prompt,/A business category is not needed for a personal sale/);
 }
 for(const type of ['personal','business']){
  storedType=type;const result=res();
  await c.exports.adaptListing({body:{listing:{businessId:'b',sellerType:type==='personal'?'business':'personal',name:'David',adContext:'Used GEM vehicle; needs batteries',hours:'9 to 5',aiContext:{story:'Old business story'}},platforms:[],tone:'friendly'}},result,{uid:'u'});
  assert.match(captured.at(-1).prompt,type==='personal'?/private individual/:/local business marketing expert/);
  if(type==='personal'){assert(!captured.at(-1).prompt.includes('Old business story'));assert(!captured.at(-1).prompt.includes('9 to 5'));assert.match(captured.at(-1).prompt,/needs batteries/);}
 }
 console.log('PASS personal seller: actual signup/setup/profile DOM, later campaign questions, profile edits and both AI interview branches.');
})().catch(e=>{console.error(e);process.exitCode=1});
