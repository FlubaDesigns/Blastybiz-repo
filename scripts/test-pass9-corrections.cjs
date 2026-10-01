'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {database}=require('./lib/test-firestore.cjs');
const {migrate,migrateHeldJobs}=require('./migrate-platform-config.cjs');
const read=p=>fs.readFileSync(p,'utf8'),cut=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
let checks=0;const ok=(v,m)=>{assert(v,m);checks++;};
async function photos(){
 const source=read('public/BlastyBiz.html');
 for(const plan of ['starter','pro','agency'])for(const scope of ['global','campaign']){
  const messages=[],uploads=[];
  const c={window:{_bbUserPlan:plan,activeBizId:'b',_bbPhotoItems:[],_bbUploadPhoto:async file=>{uploads.push(file);c.window._bbPhotoItems.push({done:true});}},photoScope:scope,activeCampaignId:'c',checkAdaptBtn(){},showToast:x=>messages.push(x)};
  vm.createContext(c);vm.runInContext(cut(source,'function photoCap()','function updatePhotoCapLabel()')+cut(source,'var _photoReservations','window.renderAllPhotos = function()'),c);
  const first=c.handleImages({target:{files:Array.from({length:21},(_,i)=>i),value:'selected'}});
  const second=c.handleImages({target:{files:[22],value:'selected'}});
  await Promise.all([first,second]);
  ok(uploads.length===20,plan+' '+scope+': caps batch and overlapping picker at 20');
  ok(messages.includes('You have reached the 20 photo limit. Remove one to add more.'),'clear capacity message');
  c.window._bbPhotoItems.pop();await c.handleImages({target:{files:[23]}});ok(uploads.length===21,'removing a photo frees one slot');
 }
 const input={files:[1,2,3],value:'gallery-reference'},processed=[];
 const c={window:{activeBizId:'b',_bbPhotoItems:[],_bbUploadPhoto:async file=>{await Promise.resolve();assert.equal(input.value,'gallery-reference','picker stays intact until all selected photos are read');processed.push(file);}},photoScope:'campaign',activeCampaignId:'c',checkAdaptBtn(){},showToast(){}};
 vm.createContext(c);vm.runInContext(cut(source,'function photoCap()','function updatePhotoCapLabel()')+cut(source,'var _photoReservations','window.renderAllPhotos = function()'),c);
 const batch=c.handleImages({target:input});await c.handleImages({target:input});await batch;
 ok(processed.length===3&&input.value===''&&!input.disabled&&!input._bbReadingPhotos,'one batch, all references preserved, picker cleared and enabled afterward');
}
async function migration(){
 const base='users/u/businesses/b/publishJobs/',seed={'config/platforms':{facebook:{proOnly:true}}};
 for(let i=0;i<205;i++)seed[base+'j'+String(i).padStart(3,'0')]={planGated:true,status:'pending',payload:{adaptedContent:'Saved '+i},attempts:2};
 seed[base+'done']={planGated:true,status:'success'};seed[base+'failed']={planGated:true,status:'failed'};seed[base+'normal']={planGated:false,status:'pending'};
 const state=database(seed),before=JSON.stringify(state.all());let r=await migrate(state.db);
 ok(r.jobs.length===205&&JSON.stringify(state.all())===before,'dry run spans pages with zero writes');
 r=await migrate(state.db,true);ok(r.jobs.filter(j=>j.applied).length===205,'apply converts all pages');
 const row=state.get(base+'j000');ok(row.status==='manual_required'&&!row.planGated&&row.customerLabel==='Action needed'&&row.customerVisibleMessage==='Your content is ready — copy it below.','held job becomes copy-ready');
 ok(row.payload.adaptedContent==='Saved 0'&&row.attempts===2,'payload and attempt history preserved');
 for(const id of ['done','failed','normal'])ok(JSON.stringify(state.get(base+id))===JSON.stringify(seed[base+id]),'unrelated '+id+' unchanged');
 ok((await migrate(state.db,true)).jobs.length===0,'re-run is idempotent');
 const fail=database({[base+'one']:{planGated:true,status:'pending'}});fail.failNext();await assert.rejects(migrateHeldJobs(fail.db,true));ok(fail.get(base+'one').planGated,'failed transaction leaves held job unchanged');
 const race=database({[base+'race']:{planGated:true,status:'pending'}}),transaction=race.db.runTransaction.bind(race.db);
 race.db.runTransaction=async fn=>{await race.db.doc(base+'race').update({status:'success'});return transaction(fn);};
 ok(!(await migrateHeldJobs(race.db,true))[0].applied&&race.get(base+'race').status==='success','transaction recheck preserves a concurrently completed job');
}
async function email(){
 const source=read('functions/modules/publishing.js');
 for(const [plan,limit] of [['pro',7],['agency',22]]){
  const state=database({'users/u':{email:'fixture@example.com',plan}}),sent=[];
  const c={exports:{},onDocumentCreated:(_,f)=>f,db:state.db,getPlanConfig:async()=>({bizLimits:{pro:7,agency:22}}),sendResendEmail:async x=>sent.push(x),APP_BASE_URL:'https://example.com',console};
  vm.runInNewContext(source.slice(source.indexOf('exports.businessCreatedTrigger =')),c);
  await c.exports.businessCreatedTrigger({params:{uid:'u',bizId:'b'},data:{data:()=>({businessName:'Fixture'})}});
  ok(sent[0].html.includes('up to '+limit+' businesses'),plan+' email uses edited config capacity');
 }
}
async function prompt(){
 const A=require('../functions/lib/platforms');
 ok(A.records.length===15&&A.records.every(p=>typeof p.suitability==='string'&&p.suitability.length>20),'all 15 records have shared suitability');
 ok(A.byId.angi.suitability.includes('ONLY for home services')&&A.byId.linkedin.suitability.includes('no for purely hyperlocal'),'restores reviewed homeowner and B2B rules');
 ok(A.records.every(p=>!/copy-paste|no API|auto-post/i.test(p.suitability)),'suitability contains no delivery claims');
 const s=read('functions/modules/ai.js'),c={PLATFORM_DOCS:A.PLATFORM_DOCS,platformAuthority:A,adminDocs:{},_mergeAdminPlatformDoc:x=>x};
 vm.createContext(c);vm.runInContext(cut(s,'  const platformFacts =','  const prompt =')+'globalThis.result=platformFacts;',c);
 ok(c.result.includes('Suitability: '+A.byId.angi.suitability)&&c.result.includes('Suitability: '+A.byId.linkedin.suitability),'actual suggestion prompt includes source guidance');
 ok(!read('public/BlastyBiz-AI.html').includes('are Pro and Agency features'),'help copy reflects shared access');
}
(async()=>{await photos();await migration();await email();await prompt();console.log('PASS: '+checks+' Pass 09 correction assertions.');})().catch(e=>{console.error(e);process.exitCode=1;});
