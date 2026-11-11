'use strict';
// Called by the existing endpoint check only for a descriptor-selected release.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),PROJECT='blastybiz-9523e';
function selected(release){return release?.target==='blastybiz'&&release.action==='deploy-providers'&&release.functions?.includes('suggestCategory');}
function validate(release,env,sha){
 assert(selected(release));assert.equal(release.retireLegacy,false);assert.equal(release.repairBackend,false);
 assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_REF,'refs/heads/main');assert(env.GOOGLE_APPLICATION_CREDENTIALS);
 assert.match(release.commit,/^[a-f0-9]{40}$/);assert.equal(release.commit,sha);
}
async function run(){
 const descriptor=path.resolve(ROOT,'../deployment/blastybiz-release.json');
 if(!fs.existsSync(descriptor))return;
 const release=JSON.parse(fs.readFileSync(descriptor,'utf8'));if(!selected(release))return;
 validate(release,process.env,execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim());
 const admin=require('../functions/node_modules/firebase-admin');
 const app=admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:PROJECT},'category-acceptance');
 const db=app.firestore(),auth=app.auth(),uid='category_check_'+randomUUID().replaceAll('-','');
 const user=db.doc('users/'+uid),allowance=user.collection('private').doc('aiAllowance');
 let created=false,stage='configuration';
 try{
  const settings=(await db.doc('config/aiSettings').get()).data();assert(settings?.fastModel,'reviewed AI model must be configured');
  const plans=(await db.doc('config/plans').get()).data();
  const cap=plans?.aiLimits?.starter??require('../functions/lib/lifecycle-policy').aiLimits.starter;assert(cap>0&&Number.isFinite(cap));
  const apiKey=fs.readFileSync(path.join(ROOT,'public/firebase-init-v2.js'),'utf8').match(/apiKey:\s*"([^"]+)"/)?.[1];assert(apiKey);
  const email=uid+'@example.invalid',password=randomUUID()+randomUUID();
  await auth.createUser({uid,email,password,emailVerified:true});created=true;
  // No business or email field: no customer records, publishing, payment or mail.
  await user.set({plan:'starter',onboarded:true,acceptanceFixture:true,createdAt:admin.firestore.FieldValue.serverTimestamp()});
  stage='fixture authentication';
  const login=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),signal:AbortSignal.timeout(30000)});
  assert.equal(login.status,200,'fixture sign-in');const session=await login.json();assert.equal(session.localId,uid);assert(session.idToken);
  const endpoint='https://us-central1-'+PROJECT+'.cloudfunctions.net/suggestCategory';
  const call=(body,token=session.idToken,method='POST')=>fetch(endpoint,{method,headers:{Origin:'https://blastybiz.com','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});
  stage='authentication and validation';
  assert.equal((await call({},'', 'OPTIONS')).status,204);
  assert.equal((await call({},'')).status,401);assert.equal((await call({},'invalid-fixture-token')).status,401);
  assert.equal((await call({})).status,400);assert.equal((await call(null)).status,400);
  assert.equal((await allowance.get()).exists,false,'rejected requests consume no allowance');
  stage='authenticated category generation';
  const result=await call({bizName:'Category Acceptance Bakery',story:'A neighborhood bakery making bread and pastries.',campaignAbout:'PRIVATE_CAMPAIGN_SENTINEL'});
  assert.equal(result.status,200,'live category response');const body=await result.json();
  assert.equal(typeof body.globalMemory,'string');assert(body.globalMemory.trim().length>20);assert(!body.globalMemory.includes('PRIVATE_CAMPAIGN_SENTINEL'));
  assert(require('../functions/lib/platform-cats').ALL_CATEGORIES.includes(body.category),'category must match the existing category source');
  const used=(await allowance.get()).data();assert.equal(used.aiActionsUsed,1,'one existing private allowance reservation');
  const usage=()=>db.collection('aiUsageLogs').where('uid','==',uid).get();
  const logs=await usage();assert.equal(logs.size,2,'both provider calls attributed to fixture');
  for(const log of logs.docs){const data=log.data();assert.equal(data.fn,'suggestCategory');assert.equal(data.model,settings.fastModel);assert.equal(data.purpose,'category_suggest');assert.equal(data.failureType,null);assert(data.inputTokens>0);}
  stage='existing allowance enforcement';
  await allowance.update({aiActionsUsed:cap});assert.equal((await call({bizName:'Category Acceptance Bakery'})).status,429);
  assert.equal((await usage()).size,2,'exhausted allowance prevents provider calls');
  assert.equal((await user.collection('businesses').get()).size,0);
  console.log('PASS LIVE category '+JSON.stringify({commit:release.commit,category:body.category,model:settings.fastModel,providerCalls:logs.size,allowanceReservations:1,unsigned:401,invalidToken:401,invalidBody:400,exhaustedAllowance:429,customerWrites:false}));
 }catch(error){throw Error('Category acceptance '+stage+': '+error.message);}
 finally{
  try{
   await db.recursiveDelete(user);
   for(const name of ['activityLogs','aiUsageLogs']){const rows=await db.collection(name).where('uid','==',uid).get();for(const row of rows.docs)await row.ref.delete();}
   await db.doc('setupNudges/'+uid).delete();if(created)await auth.deleteUser(uid);
   assert.equal((await user.get()).exists,false);console.log('Category acceptance fixture cleaned; no customer content changed.');
  }finally{await app.delete();}
 }
}
module.exports={run,selected,validate};
