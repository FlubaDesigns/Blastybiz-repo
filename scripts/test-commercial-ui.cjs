'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const read=name=>fs.readFileSync('public/'+name,'utf8');
module.exports=async function(){
  const setup=read('BlastyBiz-CreateBiz.html'),recover=setup.slice(setup.indexOf("const setupDraftKey="),setup.indexOf('// ── Platform grid'));
  const create=(uid='u',raw=null)=>{
    const dom=new JSDOM(setup,{url:'https://example.invalid/BlastyBiz-CreateBiz?new=1',runScripts:'outside-only'}),w=dom.window;
    w._cbReady=true;w._cbBlasty={idx:7};
    if(raw)w.localStorage.setItem('bb_setup_draft',raw);
    w.eval(`let currentUser={uid:${JSON.stringify(uid)}},editBizId=null,newBizRef=null,newCampId=null,existingCampaignId=null;const db={},urlP=new URLSearchParams(location.search);const collection=()=>({});const doc=(...args)=>({id:args.length===1?'stable_business':args.at(-1)});function cbConfigureForm(){};`+recover);
    return {dom,w};
  };
  let {dom,w}=create();
  w.document.getElementById('f-bizName').value='Saved phone typing';
  w.document.getElementById('pref-phone').checked=false;
  // Guided mode moves controls out of cb-form; recovery still reads the actual input.
  w.document.body.append(w.document.getElementById('f-bizName'));
  w.document.getElementById('f-bizName').dispatchEvent(new w.Event('input',{bubbles:true}));
  const raw=w.localStorage.getItem('bb_setup_draft');assert(raw);
  const firstId=JSON.parse(raw).businessId;w.keepSetupDraft();assert.equal(JSON.parse(w.localStorage.getItem('bb_setup_draft')).businessId,firstId);
  dom.window.close();({dom,w}=create('u',raw));w.restoreSetupDraft();
  assert.equal(w.document.getElementById('f-bizName').value,'Saved phone typing');assert.equal(w.document.getElementById('pref-phone').checked,false);assert.equal(w._cbResumeStep,7);assert.equal(w._cbGuideRequested,true);
  dom.window.close();({dom,w}=create('other',raw));w.restoreSetupDraft();assert.notEqual(w.document.getElementById('f-bizName').value,'Saved phone typing');dom.window.close();
  ({dom,w}=create('u',JSON.stringify({...JSON.parse(raw),at:Date.now()-8*86400000})));w.restoreSetupDraft();assert.equal(w.localStorage.getItem('bb_setup_draft'),null);dom.window.close();
  ({dom,w}=create('u',raw));w.restoreSetupDraft();w.eval(read('session.js'));w._bbClearStorage();w.dispatchEvent(new w.Event('beforeunload'));w.keepSetupDraft();assert.equal(w.localStorage.getItem('bb_setup_draft'),null);dom.window.close();
  dom=new JSDOM('<div id="history-list"></div><div id="stat-total-posts"></div><div id="stat-platforms-hit"></div><div id="stat-this-month"></div><span data-price="proMonthly"></span>',{url:'https://example.invalid',runScripts:'outside-only'});w=dom.window;
  w.BBPlatforms={records:[{id:'facebook',name:'Facebook'},{id:'craigslist',name:'Craigslist'}]};w.eval(read('lifecycle-status.js'));
  const now=new Date(),old=new Date(now);old.setFullYear(old.getFullYear()-1);
  const rows=w.BBLifecycleStatus.historyRows([{id:'one',packet:{adName:'Real blast'}}],[
    {jobId:'1',draftId:'one',platform:'facebook',status:'success',publishedAt:now.toISOString()},
    {jobId:'2',draftId:'one',platform:'craigslist',status:'manual_required',createdAt:now.toISOString()},
    {jobId:'3',draftId:'two',platform:'facebook',status:'failed',createdAt:now.toISOString()},
    {jobId:'4',draftId:'old',platform:'facebook',status:'success',publishedAt:old.toISOString()}
  ]);
  assert.equal(rows.length,3);assert.equal(rows.find(r=>r.key==='one').posted,1);assert.match(rows.find(r=>r.key==='one').summary,/Action Needed/);assert.equal(rows.find(r=>r.key==='two').posted,0);
  w.testRows=rows;w.escHtml=String;w.activeBizId='b';w.timeAgo=()=>'';
  const main=read('BlastyBiz.html');w.eval('let history=window.testRows;'+main.slice(main.indexOf('function renderHistory()'),main.indexOf('async function loadHistoryDraft')));w.renderHistory();
  assert.equal(w.document.getElementById('stat-total-posts').textContent,'2');assert.equal(w.document.getElementById('stat-this-month').textContent,'1');
  assert.match(w.document.getElementById('history-list').textContent,/Failed/);
  w.fetch=async()=>({ok:true,json:async()=>({fields:{proMonthly:{integerValue:'27'}}})});w.eval(read('pricing.js'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setImmediate(r));assert.equal(w.document.querySelector('[data-price]').textContent,'$27');
  dom.window.close();
  console.log('PASS commercial UI: setup reload/identity/expiry/sign-out, canonical history outcomes/year counts, configurable public pricing.');
};
if(require.main===module)module.exports().catch(e=>{console.error(e);process.exitCode=1;});
