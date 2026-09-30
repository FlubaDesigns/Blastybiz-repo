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
 assert.match(w.document.getElementById('f-about').closest('.cb-field').textContent,/condition/);
 assert(!w.document.getElementById('f-city').disabled);
 w._bbProfileGlobal={sellerType:'personal'};w.$cc=()=>({value:'GEM electric vehicle'});w.ccCol={};
 let steps=w.BBBlasty.campaignSteps();assert.match(steps[0].msg(),/condition/);assert.equal(steps[0].field(),'offer');
 w._bbProfileGlobal={sellerType:'business'};steps=w.BBBlasty.campaignSteps();assert.match(steps[0].msg(),/offer or message/);
 dom.window.close();
 // Execute the real dashboard profile functions: a later edit must retain type.
 const app=read('public/BlastyBiz.html');dom=new JSDOM(app,{runScripts:'outside-only',virtualConsole:new VirtualConsole()});w=dom.window;
 Object.assign(w,{profile:{sellerType:'personal',name:'David',ownerName:'David'},profileLocationType:'physical',locationType:'physical',renderPlatformCats(){},updateCopyPreview(){},setProfileLocationType(){}});
 w.eval(app.slice(app.indexOf('function saveProfile() {'),app.indexOf('function setYN(field, val)')));
 w.loadProfile();assert.equal(w.document.querySelector('label[for="profile-name"]').textContent,'Seller name');assert(w.document.getElementById('profile-hours').hidden);
 w.document.getElementById('profile-phone').value='9413751504';w.saveProfile();assert.equal(w.profile.sellerType,'personal');assert.equal(w._bbProfileGlobal.sellerType,'personal');assert.equal(w.profile.ownerRole,'');assert.equal(w.profile.hours,'');
 w.profile={sellerType:'business',name:'Company'};w.loadProfile();assert(!w.document.getElementById('profile-hours').hidden);assert.equal(w.document.querySelector('label[for="profile-name"]').textContent,'Business Name');dom.window.close();
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
  await c.exports.generateEnrichmentQuestions({body:{sellerType:type,businessName:'David',itemDetails:'GEM vehicle',existingInsights:[]}},res(),{uid:'u'});
  assert.match(captured.at(-1).prompt,type==='personal'?/private individual/:/local business marketing AI/);
 }
 for(const type of ['personal','business']){
  storedType=type;const result=res();
  await c.exports.adaptListing({body:{listing:{businessId:'b',sellerType:type==='personal'?'business':'personal',name:'David',adContext:'Used GEM vehicle; needs batteries',hours:'9 to 5',aiContext:{story:'Old business story'}},platforms:[],tone:'friendly'}},result,{uid:'u'});
  assert.match(captured.at(-1).prompt,type==='personal'?/private individual/:/local business marketing expert/);
  if(type==='personal'){assert(!captured.at(-1).prompt.includes('Old business story'));assert(!captured.at(-1).prompt.includes('9 to 5'));assert.match(captured.at(-1).prompt,/needs batteries/);}
 }
 console.log('PASS personal seller: actual signup/setup/profile DOM, later campaign questions, profile edits and both AI interview branches.');
})().catch(e=>{console.error(e);process.exitCode=1});
