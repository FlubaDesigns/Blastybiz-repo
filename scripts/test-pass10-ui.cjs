// DOM integration; install jsdom@26 in a temporary directory and set JSDOM_PATH.
'use strict';
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const fs=require('node:fs'),assert=require('node:assert/strict');
const {database,admin}=require('./lib/test-firestore.cjs');
const {createAdService,freezePacket}=require('../functions/lib/ads');
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
ok(w.BBAds.active.imageRefs[0]?.id==='photo','existing campaign photos start selected automatically');
w.document.getElementById('biz-ad-name').value='July';w.document.getElementById('biz-offer').value='Summer offer';
w.document.querySelector('#thumb-grid .thumb-select').click();await settled();
ok(w.BBAds.active.imageRefs.length===0&&!!state.get(camp+'/images/photo'),'tap excludes the photo without deleting the upload');
await w.BBAds.open();ok(w.BBAds.active.imageRefs.length===0,'reopening retains an explicitly empty photo selection');
w.document.querySelector('#thumb-grid .thumb-select').click();await settled();
ok(w.document.querySelector('#thumb-grid .thumb-select[aria-pressed="true"]'),'one Photos grid displays selected state');ok(w.BBAds.active.imageRefs[0].id==='photo','photo tap selects and saves canonical Ad image');
w.platforms[0].adaptedContent='Approved copy';w.platforms[0]._reviewStatus='approved';loseNext=true;w.BBAds.markDirty();await new Promise(r=>setTimeout(r,750));await settled();ok(!w.document.getElementById('ad-save-retry').hidden&&w.document.getElementById('ad-message').textContent.includes('Lost response'),'failed save leaves retry feedback');await click('save');
let ad=w.BBAds.active;ok(ad.revision===5&&ad.imageRefs[0].id==='photo'&&ad.name==='July','retry saves exactly one revision with copy and image');
await w.BBAds.open();ok(w.BBAds.active.id===ad.id&&w.document.getElementById('biz-ad-name').value==='July','reopening selects the saved Ad without a View button');ok(!w.document.getElementById('ad-picker'),'one saved Ad needs no picker');
ok(!w.document.querySelector('[data-action=run]')&&!w.document.querySelector('[data-action=derive]')&&w.document.getElementById('ad-save-retry').hidden,'three unnecessary buttons removed; retry appears only on failure');
await w.BBAds.choosePhoto({id:'photo',scope:'campaign'});ok(w.BBAds.active.imageRefs.length===0&&!!state.get(camp+'/images/photo'),'remove is scoped to Ad');
w.document.getElementById('ad-context').value='Saved automatically';w.document.getElementById('ad-context').dispatchEvent(new w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,750));await settled();
await w.BBAds.open();ok(w.document.getElementById('ad-context').value==='Saved automatically','typing persists without a Save details button');
// Committed field edits must save even when mobile input supplies change only.
const cta=w.document.getElementById('ad-cta');
cta.value='Call David at 941-375-1504';cta.dispatchEvent(new w.Event('change',{bubbles:true}));
await settled();await w.BBAds.open();
ok(w.document.getElementById('ad-cta').value==='Call David at 941-375-1504','committed CTA survives reopening without another edit');
const typedCta=w.document.getElementById('ad-cta');
typedCta.value='Text David';typedCta.dispatchEvent(new w.Event('input',{bubbles:true}));
ok(w.document.getElementById('ad-message').textContent==='Saving…','typing replaces stale Saved status immediately');
typedCta.dispatchEvent(new w.FocusEvent('focusout',{bubbles:true}));await settled();
ok(state.get(camp+'/ads/'+ad.id).cta==='Text David','leaving CTA flushes the debounce before navigation');
await w.BBAds.open();ok(w.document.getElementById('ad-cta').value==='Text David','typed CTA reopens from canonical Ad');
const emptyCta=w.document.getElementById('ad-cta');emptyCta.value='';emptyCta.dispatchEvent(new w.Event('change',{bubbles:true}));await settled();await w.BBAds.open();
ok(w.document.getElementById('ad-cta').value===''&&state.get(camp+'/ads/'+ad.id).cta==='','optional CTA can be cleared and remains blank');
// Personal pickup facts use the same Ad persistence and prepared packet.
ok(w.document.getElementById('ad-location-fields').hidden,'business keeps its existing location controls');
w._bbProfileGlobal={sellerType:'personal'};await w.BBAds.open();
ok(!w.document.getElementById('ad-location-fields').hidden,'personal ZIP and area are visible');
for(const [id,value] of [['ad-zip','01234'],['ad-area','Downtown pickup']]){
 const input=w.document.getElementById(id);ok(!input.required,'pickup field is optional');input.value=value;input.dispatchEvent(new w.Event('change',{bubbles:true}));await settled();
}
await w.BBAds.open();
ok(w.document.getElementById('ad-zip').value==='01234'&&w.document.getElementById('ad-area').value==='Downtown pickup','ZIP leading zero and area survive reopening');
w.platforms[0].adaptedContent='Pickup Downtown, 01234';w.platforms[0]._reviewStatus='approved';await w.BBAds.save();
const ready=await w.BBAds.api('prepare',{adId:ad.id,blastId:'pickup-test',expectedRevision:w.BBAds.active.revision});
ok(ready.packet.pickupZip==='01234'&&ready.packet.pickupArea==='Downtown pickup','prepared Blast preserves the saved pickup facts');
for(const id of ['ad-zip','ad-area']){const input=w.document.getElementById(id);input.value='';input.dispatchEvent(new w.Event('change',{bubbles:true}));await settled();}
await w.BBAds.open();
ok(w.BBAds.active.pickupZip===''&&w.BBAds.active.pickupArea==='','cleared pickup fields remain blank');
ok(w.BBAds.active.platformStatus.facebook==='needs-review','changing pickup facts requires copy review');
w.history.replaceState({},'','?adId='+ad.id);await w.BBAds.open();ok(w.BBAds.active.id===ad.id,'existing direct links still open the specified Ad');
// Business photos import through the same campaign repository and Ad save path.
w._bbLoadGlobalImages=async()=>[{id:'business-photo',url:'https://example.com/business.jpg'}];
w._bbLoadCampaignImages=async()=>Object.entries(state.all()).filter(([p])=>p.startsWith(camp+'/images/')).map(([p,v])=>({id:p.split('/').at(-1),...v}));
let imports=0;w._bbSaveCampaignImage=async(cid,data)=>{imports++;await state.db.doc(camp+'/images/imported').set(data);return 'imported';};
await w.BBAds.choosePhoto({id:'business-photo',scope:'global'});ok(w.BBAds.active.imageRefs.some(i=>i.id==='imported')&&scope==='campaign','business photo imports and selects in the same Photos workflow');
await w.BBAds.choosePhoto({id:'business-photo',scope:'global'});ok(imports===1&&w.BBAds.active.imageRefs.some(i=>i.id==='imported'),'reusing business photo does not duplicate or deselect it');
// New uploads join this Ad automatically; previously excluded photos stay excluded.
await state.db.doc(camp+'/images/new-photo').set({url:'https://example.com/new.jpg'});
await w.BBAds.open();ok(w.BBAds.active.imageRefs.some(i=>i.id==='new-photo')&&!w.BBAds.active.imageRefs.some(i=>i.id==='photo'),'new campaign photos join without reselecting excluded ones');
await w.BBAds.choosePhoto({id:'new-photo',scope:'campaign'},true);
ok(w.BBAds.active.imageRefs.some(i=>i.id==='new-photo'),'upload completion is idempotent and never toggles a selected photo off');
await w.BBAds.api('create',{adId:'second',requestId:'second',creative:{name:'Second blast',platforms:['facebook']}});
w.history.replaceState({},'','?adId=second');await w.BBAds.open();
ok(w.BBAds.active.imageRefs.some(i=>i.id==='photo'),'another blast starts with all campaign images');
w.history.replaceState({},'','?adId='+ad.id);await w.BBAds.open();
ok(!w.BBAds.active.imageRefs.some(i=>i.id==='photo'),'returning to the first blast keeps its separate exclusion');
w.campaigns=[{id:'c',photos:['https://example.com/older.jpg']}];let legacyImports=0;
w._bbSaveCampaignImage=async(cid,data)=>{legacyImports++;await state.db.doc(camp+'/images/legacy').set(data);return 'legacy';};
await w.BBAds.open();await w.BBAds.open();
ok(legacyImports===1&&w.BBAds.active.imageRefs.some(i=>i.id==='legacy'),'older uploaded campaign photos are included once through the same image repository');
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
// Review shows exactly the images in the publishing packet, before approval.
run('platforms-authority.js');
const reviewHost=w.document.createElement('div');reviewHost.id='step5-review-container';w.document.body.appendChild(reviewHost);
const reviewAd={id:'photo-review',campaignId:'c',platforms:['google','facebook','instagram','fbmarket','yelp'],imageRefs:Array.from({length:12},(_,i)=>({id:'i'+i,url:'https://example.com/'+i+'.jpg',alt:'Item view '+(i+1)}))};
reviewAd.adaptations=Object.fromEntries(reviewAd.platforms.map(p=>[p,'Saved copy']));reviewAd.platformStatus=Object.fromEntries(reviewAd.platforms.map(p=>[p,'approved']));
w.BBAds={active:reviewAd};
w.platforms=reviewAd.platforms.map(id=>({id,name:id,type:['google','facebook','instagram'].includes(id)?'api':'manual',adaptedContent:'Saved copy'}));
Object.assign(w,{_step5PlatIdx:0,getStep5Platforms:()=>w.platforms,updateStep5UI(){},_bbIsGenerating:()=>false,PLATFORM_URL_HINTS:{}});
w.eval(html.slice(html.indexOf('function renderPlatformPhotoStrip('),html.indexOf('async function copyImageToClipboard(')));
w.eval(html.slice(html.indexOf('function renderStep5Review()'),html.indexOf('function updateStep5UI()')));
w.renderStep5Review();
const packet=freezePacket(reviewAd,{name:'Photos'});
for(const id of reviewAd.platforms){
 const photos=w.document.getElementById('qp-photos-'+id),button=w.document.getElementById('step5-lgtm-'+id);
 const actual=[...photos.querySelectorAll('img')].map(img=>img.src);
 assert.deepEqual(actual,packet.imagesByPlatform[id]);checks++;
 ok(!!(photos.compareDocumentPosition(button)&w.Node.DOCUMENT_POSITION_FOLLOWING),'photos precede Looks Good for '+id);
 ok(photos.style.display==='block'&&actual.length>0,'selected photos are visible for '+id);
}
ok(packet.imagesByPlatform.instagram.length===1&&packet.imagesByPlatform.facebook.length===10,'preview respects current publisher image counts');
ok(w.document.getElementById('qp-photos-instagram').textContent.includes('first 1 of your 12'),'review explains when only some selected photos are included');
reviewAd.imageRefs=[];w.renderStep5Review();
for(const id of reviewAd.platforms){const photos=w.document.getElementById('qp-photos-'+id);ok(photos.style.display==='block'&&!photos.querySelector('img')&&photos.textContent.includes('No photos selected'),'empty image selection is explicit for '+id);}
console.log('PASS: '+checks+' Pass 10 DOM integration assertions.');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});

