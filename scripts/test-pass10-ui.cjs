// DOM integration; install jsdom@26 in a temporary directory and set JSDOM_PATH.
'use strict';
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const fs=require('node:fs'),assert=require('node:assert/strict');
const {database,admin}=require('./lib/test-firestore.cjs');
const {createAdService}=require('../functions/lib/ads');
const base='users/u/businesses/b',camp=base+'/campaigns/c';
const state=database({[base]:{name:'Business'},[camp]:{name:'Summer',platformsEnabled:['facebook']},[camp+'/images/photo']:{url:'https://example.com/photo.jpg',alt:'Photo'}});
const service=createAdService(state.db,admin);
const dom=new JSDOM('<!doctype html><html><head></head><body><main id="campaign-content"></main><input id="biz-ad-name"><textarea id="biz-offer"></textarea><input id="biz-price"><div id="mascot"></div></body></html>',{url:'https://example.com/BlastyBiz.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;let checks=0,loseNext=false;
const ok=(v,m)=>{assert(v,m);checks++;};
Object.assign(w,{activeBizId:'b',activeCampaignId:'c',activeCampaignName:'Summer',ynState:{},platforms:[{id:'facebook',enabled:true}],_bbGetToken:async()=> 'test',_bbLoadGlobalImages:async()=>[],_bbLoadCampaignImages:async()=>[{id:'photo',...state.get(camp+'/images/photo')}],confirm:()=>true,matchMedia:()=>({matches:false,addEventListener(){},addListener(){}})});
w.fetch=async(url,options)=>{try{const body=JSON.parse(options.body),result=await service('u',body);if(loseNext){loseNext=false;throw Error('Lost response');}return {ok:true,json:async()=>result};}catch(e){return {ok:false,json:async()=>({error:e.message})};}};
const run=file=>w.eval(fs.readFileSync('public/'+file,'utf8'));
async function settled(){for(let i=0;i<50;i++){await new Promise(r=>setImmediate(r));if(!w.BBAds.busy)return;}throw Error('UI remained busy');}
async function click(action,id){const node=w.document.querySelector(`[data-action="${action}"]${id?'[data-id="'+id+'"]':''}`);assert(node,'Button '+action);node.click();await settled();}
(async()=>{
const html=fs.readFileSync('public/BlastyBiz.html','utf8');
w.eval(html.slice(html.indexOf('const AI_REQUEST_TIMEOUT_MS ='),html.indexOf('function _bbSetGenerating(')));
const picker=w.document.createElement('input');picker.id='img-input';picker.type='file';w.document.body.appendChild(picker);let picked=false,scope;picker.click=()=>{picked=true;};w.setPhotoScope=v=>{scope=v;};
const grid=w.document.createElement('div');grid.innerHTML='<div id="thumb-grid"></div><div id="photo-upload-area"></div>';w.document.body.appendChild(grid);
Object.assign(w,{photoScope:'campaign',_bbPhotoItems:[{id:'photo',url:'https://example.com/photo.jpg',localUrl:'https://example.com/photo.jpg',scope:'campaign',done:true}],restoreFeaturedPhotoSelection(){},photoCap:()=>20,updatePhotoCapLabel(){},checkAdaptBtn(){},escHtml:s=>String(s).replace(/</g,'&lt;')});
w.eval(html.slice(html.indexOf('window.renderAllPhotos = function()'),html.indexOf('// IN-FLIGHT GENERATION TRACKING')));
w.refreshPhotoGridForScope=()=>w.renderAllPhotos();
run('business-form.js');run('ad-workspace.js');await w.BBAds.open();ok(!w.document.querySelector('[data-action=migration]')&&!w.document.querySelector('[data-action=view]')&&!w.document.querySelector('[data-action=new]')&&!w.document.getElementById('ad-list')&&!w.document.querySelector('#ad-workspace select'),'entire record-list section is absent with no replacement panel');ok(!w.BBAds.active&&state.writes.length===0,'opening an empty campaign creates no Ad');
await w.BBAds.api('create',{adId:'first',requestId:'first',creative:{name:'July',offer:'Summer offer'}});await w.BBAds.open();ok(w.BBAds.active.name==='July'&&w.BBAds.active.offer==='Summer offer','original save/load path retains entered answers');
ok(!w.document.querySelector('.ad-images')&&!w.document.querySelector('[data-action=upload]'),'duplicate image panel and uploader are absent');
w.document.getElementById('biz-ad-name').value='July';w.document.getElementById('biz-offer').value='Summer offer';w.document.querySelector('#thumb-grid .thumb-wrap').click();await settled();ok(w.document.querySelector('#thumb-grid .thumb-selected-badge'),'one Photos grid displays selected state');ok(w.BBAds.active.imageRefs[0].id==='photo','photo tap selects and saves canonical Ad image');
w.platforms[0].adaptedContent='Approved copy';w.platforms[0]._reviewStatus='approved';loseNext=true;w.BBAds.markDirty();await new Promise(r=>setTimeout(r,750));await settled();ok(!w.document.getElementById('ad-save-retry').hidden&&w.document.getElementById('ad-message').textContent.includes('Lost response'),'failed save leaves retry feedback');await click('save');
let ad=w.BBAds.active;ok(ad.revision===3&&ad.imageRefs[0].id==='photo'&&ad.name==='July','retry saves exactly one revision with copy and image');
await w.BBAds.open();ok(w.BBAds.active.id===ad.id&&w.document.getElementById('biz-ad-name').value==='July','reopening selects the saved Ad without a View button');ok(!w.document.getElementById('ad-picker'),'one saved Ad needs no picker');
ok(!w.document.querySelector('[data-action=run]')&&!w.document.querySelector('[data-action=derive]')&&w.document.getElementById('ad-save-retry').hidden,'three unnecessary buttons removed; retry appears only on failure');
await w.BBAds.choosePhoto({id:'photo',scope:'campaign'});ok(w.BBAds.active.imageRefs.length===0&&!!state.get(camp+'/images/photo'),'remove is scoped to Ad');
w.document.getElementById('ad-context').value='Saved automatically';w.document.getElementById('ad-context').dispatchEvent(new w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,750));await settled();
await w.BBAds.open();ok(w.document.getElementById('ad-context').value==='Saved automatically','typing persists without a Save details button');
w.history.replaceState({},'','?adId='+ad.id);await w.BBAds.open();ok(w.BBAds.active.id===ad.id,'existing direct links still open the specified Ad');
// Business photos import through the same campaign repository and Ad save path.
w._bbLoadGlobalImages=async()=>[{id:'business-photo',url:'https://example.com/business.jpg'}];
w._bbLoadCampaignImages=async()=>Object.entries(state.all()).filter(([p])=>p.startsWith(camp+'/images/')).map(([p,v])=>({id:p.split('/').at(-1),...v}));
let imports=0;w._bbSaveCampaignImage=async(cid,data)=>{imports++;await state.db.doc(camp+'/images/imported').set(data);return 'imported';};
await w.BBAds.choosePhoto({id:'business-photo',scope:'global'});ok(w.BBAds.active.imageRefs.some(i=>i.id==='imported')&&scope==='campaign','business photo imports and selects in the same Photos workflow');
await w.BBAds.choosePhoto({id:'business-photo',scope:'global'});ok(imports===1&&w.BBAds.active.imageRefs.some(i=>i.id==='imported'),'reusing business photo does not duplicate or deselect it');
// Changed form values after a failed override must get a fresh request identity.
const prepared=[];w.fetch=async(url,options)=>{const body=JSON.parse(options.body);prepared.push(body);return {ok:false,json:async()=>({error:'Simulated offline'})};};
w.platforms[0].adaptedContent='First override';await w.BBAds.prepareCurrent();await w.BBAds.prepareCurrent();
ok(prepared[0].blastId===prepared[1].blastId,'unchanged lost-response retry retains Blast identity');
w.platforms[0].adaptedContent='Edited override';await w.BBAds.prepareCurrent();
ok(prepared[2].blastId!==prepared[1].blastId&&prepared[2].creative.adaptations.facebook==='Edited override','changed override retries with fresh identity and current values');
// Each independent gesture must animate real SVG nodes without changing mood.
run('mascot.js');const mascot=w.PBMascot.create(w.document.getElementById('mascot'),{draggable:false});let animations=[];
w.Element.prototype.animate=function(frames){animations.push({node:this,frames});return {cancel(){}};};
const actions=['openHandLeft','openHandRight','openHandsBoth','pointLeft','pointRight','winkLeft','winkRight','thumbUpLeft','thumbUpRight','thumbUpBoth','eyePop','flameBoost','conePop','coneSpin','nod','reassureHand'];
for(const action of actions){animations=[];const classes=mascot.root.className;mascot[action]();ok(animations.length>0&&mascot.root.className===classes,action+' targets SVG without full-body mood');}
w.matchMedia=()=>({matches:true});animations=[];mascot.coneSpin();ok(animations.length===0,'reduced motion disables gesture animations');
console.log('PASS: '+checks+' Pass 10 DOM integration assertions.');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});

