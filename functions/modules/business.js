/**
 * BlastyBiz — Business and account management
 * createBusiness, deleteBusiness, deleteAccount, sendVerificationEmail
 */
'use strict';

const {
  onRequest, admin, db,
  APP_BASE_URL, sendResendEmail,
  userBizRef, userBizCol,
  checkUidRateLimit, setCors, withAuth,
  getPlanConfig, purgeUserData,
} = require('../lib/shared');

// Server-owned creation; capacity counts every saved business, including setup
// drafts. The account write serializes concurrent creations and deletion.
exports.createBusiness = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const {profileData,bizId,isNew,campaignData,initialAd} = req.body || {};
  const validId = x=>typeof x==='string'&&x.length>0&&x.length<=128&&!x.includes('/');
  if (!profileData || typeof profileData!=='object' || Array.isArray(profileData) || !validId(bizId)) return res.status(400).json({error:'Business details and a stable bizId are required.'});
  if (campaignData && (!validId(campaignData.id) || typeof campaignData!=='object')) return res.status(400).json({error:'Invalid campaign.'});
  const fields = ['businessName','name','ownerName','ownerRole','category','phone','email','street','city','state','zip','address','website','hours','locationType','region','tone','ynMentionName','ynMentionRole','ynMentionAddress','ynMentionPhone','ynMentionWebsite','ynMentionEmail','story','different','awards','customer','otherInfo','businessDescription','toggles','onboarded','onboardingVersion','activeCampaign','enabledPlatforms','globalMemory','featuredPhoto','aiContext','bizInsights','platformCats','postingSchedule','platformPrefs'];
  const clean = Object.fromEntries(fields.filter(k=>profileData[k]!==undefined).map(k=>[k,profileData[k]]));
  const uid=decoded.uid,userRef=db.collection('users').doc(uid),bizRef=userBizRef(uid,bizId);
  try {
    const cfg=await getPlanConfig();
    await db.runTransaction(async tx=>{
      const user=await tx.get(userRef), owned=await tx.get(userBizCol(uid)), existing=await tx.get(bizRef);
      const campRef=campaignData ? bizRef.collection('campaigns').doc(campaignData.id) : null;
      const camp=campRef ? await tx.get(campRef) : null;
      const firstAd=initialAd ? require('../lib/ads').cleanCreative(initialAd) : null;
      if(!user.exists)throw Object.assign(Error('Account not found'),{httpStatus:404});
      const plan=user.data().plan || 'starter',cap=cfg.bizLimits[plan] ?? 1;
      if(!existing.exists && !isNew)throw Object.assign(Error('Business not found'),{httpStatus:404});
      if(!existing.exists && owned.docs.length>=cap)throw Object.assign(Error('Business limit reached for your plan.'),{httpStatus:403});
      const stamp=admin.firestore.FieldValue.serverTimestamp();
      tx.set(bizRef,{...clean,uid,...(!existing.exists?{createdAt:stamp,currentPlan:plan}:{}),updatedAt:stamp},{merge:true});
      tx.set(userRef,{onboarded:true,activeBusiness:bizId,businessIds:[...new Set([...owned.docs.map(d=>d.id),bizId])],...(clean.ownerName?{displayName:clean.ownerName}:{}),updatedAt:stamp},{merge:true});
      if(campRef && !camp.exists) {
        const keys=['id','name','story','campaignStory','audience','offer','platformsEnabled','onboardingPlatforms','category','lastUsedAt','photos','adName','price','factoids','platformHistory'];
        tx.create(campRef,{...Object.fromEntries(keys.filter(k=>campaignData[k]!==undefined&&(!firstAd||!['offer','adName','price'].includes(k))).map(k=>[k,campaignData[k]])),uid,businessId:bizId,status:'active',createdAt:stamp});
        if(firstAd)tx.create(campRef.collection('ads').doc('first'),{...firstAd,id:'first',uid,businessId:bizId,campaignId:campaignData.id,
          name:firstAd.name||'First Ad',imageRefs:[],adaptations:{},platformStatus:{},revision:1,status:'draft',events:[{eventId:'first',type:'created',fields:Object.keys(firstAd),at:new Date().toISOString()}],createdAt:stamp,updatedAt:stamp});
      }
    });
    return res.json({success:true,bizId});
  } catch(e) { console.error('[createBusiness]',e.message);return res.status(e.httpStatus||500).json({error:e.httpStatus?e.message:'Business could not be saved. Please retry.'}); }
}));

// Deletion archives the campaign and its historical records. The status is
// committed first so workers immediately stop queueing future deliveries.
exports.deleteCampaign = onRequest({ invoker:'public' },withAuth(async(req,res,decoded)=>{
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  const {bizId,campaignId}=req.body || {};
  if([bizId,campaignId].some(x=>typeof x!=='string'||!x||x.includes('/')||x.length>128))return res.status(400).json({error:'Invalid campaign.'});
  const bizRef=userBizRef(decoded.uid,bizId),campRef=bizRef.collection('campaigns').doc(campaignId);
  try {
    await db.runTransaction(async tx=>{
      const biz=await tx.get(bizRef),camp=await tx.get(campRef);
      if(!biz.exists || !camp.exists)throw Object.assign(Error('Campaign not found'),{httpStatus:404});
      tx.update(campRef,{status:'archived',archivedAt:admin.firestore.FieldValue.serverTimestamp()});
      if(biz.data().activeCampaign===campaignId)tx.update(bizRef,{activeCampaign:null});
    });
    let cursor=null;
    while(true){
      let q=bizRef.collection('listingDrafts').where('campaignId','==',campaignId).orderBy(admin.firestore.FieldPath.documentId()).limit(200);
      if(cursor)q=q.startAfter(cursor);
      const snap=await q.get();if(!snap.docs.length)break;
      const batch=db.batch();for(const d of snap.docs)batch.update(d.ref,{'schedule.enabled':false,'schedule.pauseReason':'Campaign archived.'});
      await batch.commit();cursor=snap.docs[snap.docs.length-1];if(snap.docs.length<200)break;
    }
    return res.json({success:true,archived:true});
  }catch(e){console.error('[deleteCampaign]',e.message);return res.status(e.httpStatus||500).json({error:e.httpStatus?e.message:'Campaign removal did not finish. Retry to complete it.'});}
}));

exports.deleteBusiness = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const uid = decoded.uid;
  const { bizId } = req.body || {};
  if (typeof bizId !== 'string' || !bizId.trim() || bizId.includes('/')) return res.status(400).json({ error: 'Invalid bizId' });
  try {
    const activeBusiness = await require('../lib/delete-business').deleteBusinessData(db, uid, bizId);
    return res.json({ success: true, activeBusiness });
  } catch(e) {
    console.error('[deleteBusiness]', e.message);
    return res.status(e.httpStatus || 500).json({ error: e.httpStatus ? e.message : 'Deletion did not finish. Please retry to complete cleanup.' });
  }
}));

exports.deleteAccount = onRequest({ invoker: 'public', region: 'us-central1', timeoutSeconds: 540, secrets: ['SQUARE_ACCESS_TOKEN'] }, async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    // Same walker the dormancy sweep uses, so an owner-initiated delete and an
    // automatic purge can never clean up different amounts of data.
    const result = await purgeUserData(uid);
    if (result.errors.length) throw Error('Account deletion incomplete');
    res.json({ success: true });
  } catch (e) {
    console.error('deleteAccount error:', e);
    res.status(e.httpStatus || 500).json({ error: e.message, retryable: true });
  }
});

exports.sendVerificationEmail = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Headers', 'Content-Type'); return res.status(204).send(''); }
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    if (decoded.email_verified) return res.json({ ok: true, skipped: true });

    const allowed = await checkUidRateLimit('rateLimits_verifyEmail', decoded.uid, 5, 60 * 60 * 1000);
    if (!allowed) return res.status(429).json({ error: 'Too many verification emails. Try again later.' });

    const actionCodeSettings = { url: `${APP_BASE_URL}/BlastyBiz-Login.html` };
    const link = await admin.auth().generateEmailVerificationLink(decoded.email, actionCodeSettings);

    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Verify your email address</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">Click the button below to confirm your email and activate your BlastyBiz account.</p>
    <a href="${link}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Verify Email &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:24px;line-height:1.6">Or copy and paste this link:<br/><a href="${link}" style="color:#00873a">${link}</a></p>
    <p style="font-size:12px;color:#bbb;margin-top:32px">If you didn't create a BlastyBiz account, you can safely ignore this email.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="https://blastybiz-9523e.web.app" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;

    await sendResendEmail({ to: decoded.email, subject: 'Verify your BlastyBiz email', html });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[sendVerificationEmail]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// Pass 10: the only write API for reusable Ads and prepared Blast packets.
const { createAdService } = require('../lib/ads');
const manageAd = createAdService(db, admin);
exports.manageAd = onRequest({ invoker:'public' }, withAuth(async (req,res,decoded)=>{
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});
  try { return res.json(await manageAd(decoded.uid,req.body||{})); }
  catch(e) { console.error('[manageAd]',e.message);return res.status(e.httpStatus||500).json({error:e.httpStatus?e.message:'The Ad could not be saved. Retry without leaving this page.'}); }
}));
