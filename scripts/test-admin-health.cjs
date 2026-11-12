const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const BBAdminHealth=require('../public/admin-health.js'),BBPlatforms=require('../public/platforms-authority.js');
const fixture={health:{facebook:{total:3,connected:2,expired:1,disconnected:0,other:0}},totalConnections:3,truncated:false};
const result=BBAdminHealth.summarize(fixture,BBPlatforms.records);
assert.equal(result.percent,67);
assert.equal(result.platforms.find(p=>p.id==='facebook').status,'Needs attention');
assert.equal(result.platforms.find(p=>p.id==='instagram').status,'No data');
assert.equal(result.platforms.find(p=>p.id==='yelp').status,'Manual');
assert.equal(BBAdminHealth.summarize({health:{},totalConnections:0},BBPlatforms.records).percent,null);
assert.throws(()=>BBAdminHealth.summarize({counts:{}},BBPlatforms.records));
assert.throws(()=>BBAdminHealth.summarize({...fixture,totalConnections:10},BBPlatforms.records));
assert(BBAdminHealth.summarize({...fixture,truncated:true},BBPlatforms.records).description.includes('Limited sample'));
// Manual and unrecognized destinations never dilute auto-post health, even if expired.
const mixed={health:{...fixture.health,yelp:{total:4,connected:1,expired:1,disconnected:1,other:1},legacy:{total:1,connected:0,expired:1,disconnected:0,other:0}},totalConnections:8};
assert.equal(BBAdminHealth.summarize(mixed,BBPlatforms.records).percent,67);
assert.equal(BBAdminHealth.summarize(mixed,BBPlatforms.records).total,3);
assert.throws(()=>BBAdminHealth.summarize({...mixed,health:{...mixed.health,yelp:{...mixed.health.yelp,total:5}}},BBPlatforms.records));
assert.throws(()=>BBAdminHealth.summarize({...mixed,health:{...mixed.health,yelp:{...mixed.health.yelp,other:-1}}},BBPlatforms.records));
const unknownSummary=BBAdminHealth.summarize({health:{google:{total:2,connected:0,expired:0,disconnected:1,other:1}},totalConnections:2},BBPlatforms.records);
assert.equal(unknownSummary.platforms.find(p=>p.id==='google').status,'Needs review');
assert.match(unknownSummary.description,/not provider uptime/);
for(const platform of BBPlatforms.records.filter(p=>p.deliveryMode==='manual').map(p=>p.id).concat('legacy')){
 for(const status of ['expired','error','disconnected','unknown']){
  const state=BBAdminHealth.connectionState({platform,status},BBPlatforms.records);
  assert.equal(state.review,false);assert.equal(state.reconnect,false);
 }
}
for(const status of ['disconnected','pending','unknown','unexpected','toString',undefined]){
 const state=BBAdminHealth.connectionState({platform:'google',status},BBPlatforms.records);
 assert.equal(state.review,true);assert.equal(state.reconnect,false);assert.notEqual(state.badge,'needs');
}
assert.equal(BBAdminHealth.connectionState({platform:'facebook',status:'error'},BBPlatforms.records).label,'Recorded error');
assert.equal(BBAdminHealth.connectionState({platform:'facebook',status:'expired'},BBPlatforms.records).reconnect,true);
for(const platform of ['facebook','instagram'])assert.equal(BBAdminHealth.connectionState({platform,status:'connected',expiresAt:'2000-01-01'},BBPlatforms.records).review,false);
const admin=fs.readFileSync(require.resolve('../public/BlastyBiz-Admin.html'),'utf8');
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:''});return nodes.get(id);};
const c={el,BBAdminHealth,BBPlatforms,CF_BASE:'https://fixture.invalid',user:{getIdToken:async()=>'fixture-token'},escHtml:s=>String(s).replaceAll('<','&lt;'),console,PRICES:{pro:29,agency:129},latestBusinesses:[{ownerUid:'a',currentPlan:'agency',subscriptionStatus:'active'},{ownerUid:'a',currentPlan:'agency',subscriptionStatus:'active'},{ownerUid:'b',currentPlan:'pro',subscriptionStatus:'trial'}]};
vm.createContext(c);
vm.runInContext(admin.slice(admin.indexOf('  function renderMrr()'),admin.indexOf("  onSnapshot(doc(db, 'settings', 'pricing')")),c);
c.renderMrr();assert.equal(el('stat-mrr').textContent,'$129','one active subscription per owner, no trials');
c.PRICES=null;c.renderMrr();assert.equal(el('stat-mrr').textContent,'Not available');
vm.runInContext(admin.slice(admin.indexOf('  async function refreshConnectionHealth()'),admin.indexOf('\n  refreshConnectionHealth();')),c);
(async()=>{
 c.fetch=async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer fixture-token');return {ok:true,json:async()=>fixture};};
 await c.refreshConnectionHealth();assert.equal(el('admin-health-score').textContent,'67%');assert(el('admin-platform-health').innerHTML.includes('Needs attention'));
 c.fetch=async()=>({ok:false});await c.refreshConnectionHealth();assert.equal(el('admin-health-score').textContent,'Not available');assert.equal(el('admin-platform-health').textContent,'Not available');
 const health=fs.readFileSync(require.resolve('../public/BlastyBiz-Admin-Platform-Health.html'),'utf8');
 const connections=[
  {platform:'facebook',status:'expired',uid:'u',businessId:'b',expiresAt:{_seconds:1700000000}},
  {platform:'instagram',status:'error',uid:'u',businessId:'b'},
  {platform:'google',status:'disconnected',uid:'other-owner',businessId:'b'},
  {platform:'google',status:'pending',uid:'u',bizId:'legacy-name'},
  {platform:'google',status:'unset',uid:'u',businessId:'denied'},
  {platform:'google',uid:'u',businessId:'missing'},
  {platform:'google',status:'unknown'},
  {platform:'facebook',status:'connected',expiresAt:'2000-01-01'},
  {platform:'instagram',status:'connected',expiresAt:'2000-01-01'},
  ...BBPlatforms.records.filter(p=>p.deliveryMode==='manual').map(p=>({platform:p.id,status:'expired',uid:'u',businessId:'manual'}))
 ];
 const original=JSON.stringify(connections),reads=[];
 const h={BBAdminHealth,BBPlatforms,CF:'https://fixture.invalid',Date,db:{},doc:(_, ...parts)=>parts.join('/'),getDoc:async path=>{
  reads.push(path);if(path.endsWith('/denied'))throw Error('Permission denied');
  return {exists:()=>!path.endsWith('/missing'),data:()=>path.includes('other-owner')?{name:'Other owner'}:path.endsWith('/legacy-name')?{bizName:'Legacy name'}:{businessName:'<Bakery & Co>'}};
 },fetch:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer fixture-token');assert.equal(options.method,undefined,'read-only load');return {ok:true,json:async()=>url.endsWith('adminPlatformHealth')?mixed:{connections}};}};
 vm.createContext(h);vm.runInContext(health.slice(health.indexOf('async function loadHealth('),health.indexOf('async function refresh(user)')),h);
 const loaded=await h.loadHealth('fixture-token');assert.equal(loaded.counts.connected,2);assert.equal(loaded.broken.length,7);assert.equal(loaded.broken[0].businessId,'b');assert.equal(loaded.broken[0].expiresAt,'2023-11-14T22:13:20.000Z');
 assert.equal(loaded.broken[0].businessName,'<Bakery & Co>');assert.equal(loaded.broken[1].businessName,'<Bakery & Co>');
 assert.equal(loaded.broken[2].businessName,'Other owner');assert.equal(loaded.broken[3].businessName,'Legacy name');
 assert(loaded.broken.slice(4).every(c=>c.businessName==='Name unavailable'));
 assert.equal(reads.filter(p=>p==='users/u/businesses/b').length,1,'one lookup per owner/business per refresh');
 assert(!reads.some(p=>p.endsWith('/manual')));assert.equal(JSON.stringify(connections),original,'no saved status/expiry changes');
 // Exercise the actual renderer and filters without invoking any email handler.
 const dom=new Map(),node=id=>{if(!dom.has(id))dom.set(id,{value:'',textContent:'',innerHTML:'',querySelectorAll:selector=>selector==='.ph-biz-name'?Array.from({length:7},()=>({textContent:''})):[]});return dom.get(id);};
 h.document={getElementById:node};h.window={};h.allBroken=loaded.broken;h.PLATFORM_META=BBPlatforms.records.map(p=>({id:p.id,label:p.name}));
 vm.runInContext(health.slice(health.indexOf('function fmtDate('),health.indexOf('function renderPlatformMeta(')),h);
 h.renderBroken();assert.equal(node('row-count').textContent,'7 rows');
 assert.equal((node('broken-tbody').innerHTML.match(/class="nudge-btn"/g)||[]).length,1,'only saved expiry offers email');
 assert(!node('broken-tbody').innerHTML.includes('<Bakery'),'business names are assigned as text');
 assert(!node('broken-tbody').innerHTML.includes('Yelp'));assert(node('broken-tbody').innerHTML.includes('Recorded error'));
 node('filter-status').value='unknown';h.renderBroken();assert.equal(node('row-count').textContent,'3 rows');assert(!node('broken-tbody').innerHTML.includes('nudge-btn'));
 node('filter-status').value='';node('filter-biz').value='other owner';h.renderBroken();assert.equal(node('row-count').textContent,'1 row');assert(node('broken-tbody').innerHTML.includes('Not connected'));
 node('filter-platform').value='instagram';h.renderBroken();assert.equal(node('row-count').textContent,'0 rows');
 h.fetch=async()=>({ok:false});await assert.rejects(()=>h.loadHealth('fixture-token'),/not available/);
 console.log('PASS admin: canonical auto-post counts, manual exclusion, saved-state distinctions, owner-scoped business names, expiry-only nudge, filters, connected Meta preservation, malformed/error/truncated data, existing dashboard/revenue contracts');
})().catch(e=>{console.error(e);process.exitCode=1;});
