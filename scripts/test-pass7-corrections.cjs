'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const cut=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const quiet={log(){},warn(){},error(){}};
const calendar=require('../functions/lib/schedule');
let checks=0,failures=0;
const ok=(v,m)=>{assert(v,m);checks++;};
async function generation() {
  const html=read('public/BlastyBiz.html'),requests=[],writes=[],errors=[],nodes={};let next=0;
  const c={console:{...quiet,error:e=>errors.push(e.message)},crypto:require('node:crypto'),profile:{name:'Business'},ynState:{},platforms:[{id:'facebook',enabled:true}],PLATFORM_RULES:{},bizInsights:[],campaigns:[],activeCampaignId:'c',activeCampaignName:'Campaign',activeBizId:'b',currentUser:{uid:'u'},db:{},
    window:{activeBizId:'b',_bbGetToken:async()=>'token',_bbSelectedPhotoIndex:null,_bbGeneratingPlatforms:new Set()},
    document:{getElementById:id=>nodes[id]||(nodes[id]={value:id==='biz-offer'?'Spring sale':'',style:{},classList:{add(){},remove(){}}}),querySelectorAll:()=>[]},
    updateCampaignMemory(){},renderStep5Review(){},_bbSetGenerating(ids){c.window._bbGeneratingPlatforms=new Set(ids);},_startAiProgress(){},_completeAiProgress(){},savePlatforms(){},showToast(){},_getAIMemory:()=>({}),
    serverTimestamp:()=>1,increment:n=>n,collection:()=>({}),doc:(_, ...p)=>({id:p.length?p.at(-1):'draft'+(++next)}),setDoc:async(ref,data)=>writes.push({ref,data}),updateDoc:async(ref,data)=>writes.push({ref,data}),
    _bbFetchWithTimeout:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({adaptations:{facebook:'Generated copy'}})}},
    retryGeneratedDraftSave:async()=>c.window._afterAdaptation(c.platforms)
  };
  vm.runInNewContext(cut(html,'window._bbPrepareGenerationDraft =',"document.addEventListener('bb:savePlatforms'"),c);
  vm.runInNewContext(cut(html,'async function runAdaptation()','// ══════════════════════════════════════════\n// CLEAR & START OVER'),c);
  await c.runAdaptation();
  ok(requests.length===1,'first generation must reach adaptListing; observed: '+errors.join('; '));
  ok(requests[0].draftId==='draft1'&&writes[0].ref.id==='draft1'&&writes[0].data.adaptations.facebook==='Generated copy','request and saved draft share identity and generated copy');
  await c.runAdaptation();
  ok(requests[1].draftId==='draft1'&&next===1,'existing draft generation reuses its identity');
}
async function schedules(worker,invalid,failPause=false) {
  const source=read('functions/modules/scheduled.js'),writes=[],sent=[];
  const future=worker==='scheduledDraftPreview';
  const schedule={enabled:true,frequency:'daily',timeSlot:'morning',nextRunAt:new Date(Date.now()+(future?3600000:-3600000)).toISOString(),approved:true};
  const docs=[invalid,null].map((bad,i)=>({id:'d'+i,data:()=>({schedule:{...schedule,...bad},adaptations:{facebook:'Copy'}}),ref:{path:'users/u/businesses/b/listingDrafts/d'+i,update:async data=>{if(i===0&&failPause)throw Error('write offline');writes.push({id:i,data});}}}));
  const query={where(){return this},limit(){return this},get:async()=>({docs})};
  const c={exports:{},console:quiet,onSchedule:(_,f)=>f,...calendar,admin:{firestore:{FieldValue:{serverTimestamp:()=>1,delete:()=>null,increment:n=>n}}},
    db:{collectionGroup:()=>query,collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({email:'owner@example.com',plan:'pro'})})})})},
    userBizRef:()=>({get:async()=>({exists:true,data:()=>({approvalCount:3})}),update:async()=>{}}),_runScheduledPost:async()=>{sent.push('post');return {}},
    sendResendEmail:async()=>sent.push('email'),makeActionSig:()=> 'signature',_actionSecret:()=> 'key',makeUnsubSig:()=> 'unsub',_unsubSecret:()=> 'key',APP_BASE_URL:'https://example.com',CF_BASE:'https://example.com'};
  const end=worker==='scheduledPostingCheck'?'// ── scheduledDraftPreview':'// ── scheduledUpgradeNudge';
  vm.runInNewContext(cut(source,'exports.'+worker+' =',end),c);await c.exports[worker]();
  ok(sent.length===1,worker+' must process valid draft only; sends='+sent.length+'; invalid='+JSON.stringify(invalid));
  if(!failPause)ok(writes.some(x=>x.id===0&&x.data['schedule.enabled']===false&&x.data['schedule.pauseReason']),worker+' pauses only invalid draft with reason');
  ok(writes.some(x=>x.id===1)&&!writes.some(x=>x.id===1&&x.data['schedule.enabled']===false),worker+' advances valid draft normally');
}
async function connections() {
  const c={axios:{post:async()=>{throw c.failure}}};
  vm.runInNewContext(cut(read('functions/modules/publishing.js'),'async function _publicationPost','async function _publishGoogleJob'),c);
  for(const code of ['ENOTFOUND','ECONNREFUSED','EAI_AGAIN','ECONNABORTED','ETIMEDOUT','ECONNRESET','EPIPE']) {
    c.failure=Object.assign(Error(code),{code});
    await assert.rejects(c._publicationPost('url',{}),e=>e.publicationUncertain===true===['ECONNABORTED','ETIMEDOUT','ECONNRESET','EPIPE'].includes(code));checks++;
  }
  for(const status of [400,408,429,500,503]) {
    c.failure=Object.assign(Error('HTTP'),{response:{status}});
    await assert.rejects(c._publicationPost('url',{}),e=>(e.publicationUncertain===true)===(status===408||status>=500));checks++;
  }
}
async function existingBusiness() {
  const helper={require,console,URL,URLSearchParams};vm.runInNewContext(read('scripts/test-setup-regressions.cjs').split('(async()=>{')[0]+'\nglobalThis.setupEnv=env;',helper);
  const biz={businessName:'Existing',ownerName:'Owner',activeCampaign:'keep',locationType:'online',website:''};
  let e=helper.setupEnv({edit:true,biz});await e.start();await e.c.cbSubmit();
  ok(e.commits.length===1,'established online business without website can save unrelated edit');
  const step=e.c.CB_GUIDE_STEPS.find(s=>s.field==='f-website');ok(!step.skipIf({'f-locationType':'online','f-hasWebsite':'no'}),'guide still asks established online owner about website');
  e=helper.setupEnv({edit:true,biz:{...biz,website:'https://example.com'}});await e.start();e.nodes['f-website'].value='';await e.c.cbSubmit();ok(!e.commits.length,'stored online website cannot be removed while required');
  e=helper.setupEnv();await e.start();e.fill();e.nodes['f-locationType'].value='online';e.nodes['f-website'].value='';e.c.cbSyncLocation();await e.c.cbSubmit();ok(!e.commits.length,'new online business still requires website');
}
async function websitePort() {
  const c={URL};vm.runInNewContext(read('public/website-utils.js'),c);
  ok(c.BBWebsite.normalize('example.com:8080')==='https://example.com:8080'&&!c.BBWebsite.error('example.com:8080',true),'bare hostname with port accepted');
  for(const bad of ['javascript:alert(1)','ftp://example.com','https://user:pass@example.com'])ok(!!c.BBWebsite.error(bad,true),'unsafe or unsupported URL rejected');
}
(async()=>{
  const cases=[['P7-1 generation',generation],['P7-2 posting',()=>schedules('scheduledPostingCheck',{timeSlot:'invalid'})],['P7-2 preview',()=>schedules('scheduledDraftPreview',{timeSlot:'invalid'})],['P7-3 connection errors',connections],['P7-4 legacy edit',existingBusiness],['P7-5 website port',websitePort]];
  for(const [label,run] of cases){try{await run();console.log('PASS '+label);}catch(e){failures++;console.error('FAIL '+label+': '+e.message);}}
  if(!failures)for(const worker of ['scheduledPostingCheck','scheduledDraftPreview']) {
    for(const invalid of [{timezone:'Invalid/Zone'},{frequency:'weekly',dayOfWeek:9},{frequency:'monthly',dayOfMonth:0}])await schedules(worker,invalid);
    await schedules(worker,{timeSlot:'invalid'},true);
  }
  console.log(`${checks} assertions passed; ${failures} correction scenarios failed.`);process.exitCode=failures?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
