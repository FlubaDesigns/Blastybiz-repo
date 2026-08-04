/**
 * BlastyBiz — Publishing endpoints and Firestore triggers
 * uploadImage, approvePendingPost, approveDraft,
 * postToBing, postToAppleMaps, dispatchPublishJob,
 * jobFailedTrigger, jobCompletedTrigger,
 * userCreatedTrigger, businessCreatedTrigger
 */
'use strict';

const {
  onRequest, onDocumentUpdated, onDocumentCreated, admin, db, axios,
  APP_BASE_URL, sendResendEmail,
  userBizRef, userBizCol, userBizDraftsRef, userBizJobsRef, userBizPostsRef, userBizConnsRef,
  _getConnTokens, _setConnTokens,
  withAuth,
} = require('../lib/shared');

// ── Internal platform publishers ─────────────────────────────────────────────

async function _googleRefreshToken(refreshToken) {
  const resp = await axios.post('https://oauth2.googleapis.com/token', null, {
    params: {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }
  });
  return resp.data.access_token;
}

async function _publishGoogleJob(job, conn) {
  const content   = job.payload?.adaptedContent || '';
  const imageUrls = job.payload?.imageUrls || [];
  async function tryPost(token) {
    return axios.post(
      `https://mybusinesspostings.googleapis.com/v1/locations/${conn.locationId}/localPosts`,
      { languageCode: 'en-US', summary: content,
        media: imageUrls.map(u => ({ mediaFormat: 'PHOTO', sourceUrl: u })) },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }
  try {
    const r = await tryPost(conn.accessToken);
    return { postId: r.data.name };
  } catch(e) {
    if (e.response?.status === 401 && conn.refreshToken) {
      const newToken = await _googleRefreshToken(conn.refreshToken);
      const gConnRef = userBizConnsRef(job.uid, job.businessId).doc('google');
      await _setConnTokens(gConnRef, { accessToken: newToken });
      await gConnRef.update({ updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      const r = await tryPost(newToken);
      return { postId: r.data.name };
    }
    throw new Error('Google API: ' + (e.response?.data?.error?.message || e.message));
  }
}

async function _publishFacebookJob(job, conn) {
  const content = job.payload?.adaptedContent || '';
  try {
    const r = await axios.post(
      `https://graph.facebook.com/v18.0/${conn.pageId}/feed`,
      { message: content, access_token: conn.accessToken }
    );
    return { postId: r.data.id };
  } catch(e) {
    throw new Error('Facebook API: ' + (e.response?.data?.error?.message || e.message));
  }
}

async function _publishInstagramJob(job, conn) {
  const content  = job.payload?.adaptedContent || '';
  const imageUrl = job.payload?.imageUrls?.[0] || '';
  if (!imageUrl) {
    return { manualFallback: true, reason: 'no_image',
             message: 'Instagram posts require an image. Copy your caption and post it manually.' };
  }
  try {
    const media = await axios.post(
      `https://graph.facebook.com/v18.0/${conn.igUserId}/media`,
      { image_url: imageUrl, caption: content, access_token: conn.accessToken }
    );
    const pub = await axios.post(
      `https://graph.facebook.com/v18.0/${conn.igUserId}/media_publish`,
      { creation_id: media.data.id, access_token: conn.accessToken }
    );
    return { postId: pub.data.id };
  } catch(e) {
    throw new Error('Instagram API: ' + (e.response?.data?.error?.message || e.message));
  }
}

// Export for use in admin.js
module.exports._publishGoogleJob   = _publishGoogleJob;
module.exports._publishFacebookJob = _publishFacebookJob;
module.exports._publishInstagramJob = _publishInstagramJob;

// ── Exports ───────────────────────────────────────────────────────────────────

exports.uploadImage = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {

  const { imageData, fileName, mimeType } = req.body;
  if (!imageData || !fileName || !mimeType) return res.status(400).json({ error: 'Missing fields' });

  const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  if (!ALLOWED_MIME.has(mimeType)) return res.status(400).json({ error: 'Invalid file type' });

  let rawBytes;
  try { rawBytes = Buffer.from(imageData, 'base64'); } catch(e) {
    return res.status(400).json({ error: 'Invalid image data' });
  }
  if (!rawBytes || rawBytes.byteLength === 0) return res.status(400).json({ error: 'Empty image' });

  const MAX_SIZE = 5 * 1024 * 1024;
  if (rawBytes.byteLength > MAX_SIZE) return res.status(400).json({ error: 'File too large (max 5MB)' });

  const isJpeg = rawBytes[0] === 0xFF && rawBytes[1] === 0xD8;
  const isPng  = rawBytes[0] === 0x89 && rawBytes[1] === 0x50 && rawBytes[2] === 0x4E && rawBytes[3] === 0x47;
  const isWebp = rawBytes.slice(0, 4).toString('binary') === 'RIFF' && rawBytes.slice(8, 12).toString('binary') === 'WEBP';
  const isGif  = rawBytes.slice(0, 6).toString('ascii').startsWith('GIF8');
  if (!isJpeg && !isPng && !isWebp && !isGif) return res.status(400).json({ error: 'File is not a valid image' });

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);

  const uid = decoded.uid;
  const bucket = admin.storage().bucket();
  const file = bucket.file(`photos/${uid}/${Date.now()}_${safeFileName}`);
  await file.save(rawBytes, { contentType: mimeType });
  const [url] = await file.getSignedUrl({ action: 'read', expires: new Date(Date.now() + 365 * 24 * 3600 * 1000) });
  res.json({ url });
}));

exports.approvePendingPost = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {

  const { pendingPostId, bizId: pendingBizId } = req.body;
  if (!pendingPostId) return res.status(400).json({ error: 'pendingPostId required' });
  if (!pendingBizId) return res.status(400).json({ error: 'bizId required' });

  const postRef = userBizPostsRef(decoded.uid, pendingBizId).doc(pendingPostId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) return res.status(404).json({ error: 'Not found' });

  const post = postSnap.data();
  if (post.uid !== decoded.uid) return res.status(403).json({ error: 'Forbidden' });
  if (post.status !== 'pending') return res.status(409).json({ error: 'Already processed' });

  const { adaptations, platforms, tone, bizId } = post;

  let plan = 'starter';
  try {
    const userSnap = await db.collection('users').doc(decoded.uid).get();
    if (userSnap.exists) plan = userSnap.data().plan || 'starter';
  } catch(e) {}
  const isStarter = plan === 'starter';

  const batch = db.batch();
  for (const p of (platforms || [])) {
    const content = (adaptations || {})[p.id];
    if (!content) continue;
    const isManual = p.type === 'manual' || isStarter;
    const jobRef = userBizJobsRef(decoded.uid, bizId).doc();
    batch.set(jobRef, {
      jobId: jobRef.id, businessId: bizId, uid: decoded.uid,
      platform: p.id, platformName: p.name || p.id,
      capabilityLevel: p.type === 'api' ? 'full_api' : 'manual_assisted',
      jobType: 'scheduled_approved',
      status: isManual ? 'manual_required' : 'pending',
      attempts: 0, maxAttempts: 3,
      customerLabel: isManual ? 'Action needed' : 'Waiting to publish',
      customerVisibleMessage: isManual
        ? `Your approved ${p.name || p.id} post is ready — copy it below.`
        : `Your approved ${p.name || p.id} post is waiting to publish.`,
      planGated: isStarter && p.type === 'api',
      payload: { adaptedContent: content },
      apiResponse: {}, customerNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  batch.update(postRef, { status: 'approved', approvedAt: admin.firestore.FieldValue.serverTimestamp() });
  await batch.commit();

  res.json({ ok: true });
}));

exports.approveDraft = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, withAuth(async (req, res, decoded) => {

  const { draftId, businessId, platforms: legacyPlatforms, platformKeys } = req.body;
  const platformIds = Array.isArray(platformKeys) && platformKeys.length > 0
    ? platformKeys
    : (Array.isArray(legacyPlatforms) ? legacyPlatforms.map(p => p.id) : []);
  const uid = decoded.uid;

  const [draftSnap, bizSnap] = await Promise.all([
    userBizDraftsRef(uid, businessId).doc(draftId).get(),
    userBizRef(uid, businessId).get()
  ]);
  if (!draftSnap.exists || draftSnap.data().uid !== uid) {
    return res.status(403).json({ error: 'Forbidden: draft does not belong to you' });
  }
  if (!bizSnap.exists) {
    return res.status(403).json({ error: 'Forbidden: business does not belong to you' });
  }

  let userPlan = 'starter';
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.exists) userPlan = userSnap.data().plan || 'starter';
  } catch(e) { console.warn('approveDraft: users read failed, defaulting to starter:', e.message); }
  const isStarter = userPlan === 'starter';

  const PLATFORM_CAPABILITY_MAP = {
    google:     { name: 'Google Business Profile', capabilityLevel: 'full_auto',       manualInstructions: '' },
    facebook:   { name: 'Facebook Page',           capabilityLevel: 'partial_auto',    manualInstructions: '' },
    instagram:  { name: 'Instagram',               capabilityLevel: 'partial_auto',    manualInstructions: '' },
    bing:       { name: 'Bing Places',             capabilityLevel: 'manual_assisted', manualInstructions: 'Go to bingplaces.com → sign in → add or edit listing → paste your text.' },
    applemaps:  { name: 'Apple Maps',              capabilityLevel: 'manual_assisted', manualInstructions: 'Go to mapsconnect.apple.com → sign in → add or edit your business → paste your text.' },
    yelp:       { name: 'Yelp',                    capabilityLevel: 'manual_assisted', manualInstructions: 'Go to biz.yelp.com → sign in → edit your business info or post an update → paste your text.' },
    nextdoor:   { name: 'Nextdoor',                capabilityLevel: 'manual_assisted', manualInstructions: 'Go to nextdoor.com → Post → For Sale & Free → paste your listing.' },
    craigslist: { name: 'Craigslist',              capabilityLevel: 'manual_assisted', manualInstructions: 'Go to craigslist.org → your city → Services → paste your listing.' },
    fbmarket:   { name: 'FB Marketplace',          capabilityLevel: 'manual_assisted', manualInstructions: 'Go to facebook.com/marketplace → Create listing → paste your text.' },
    alignable:  { name: 'Alignable',               capabilityLevel: 'manual_assisted', manualInstructions: 'Go to alignable.com → sign in → Post an Update → paste your text.' },
    thumbtack:  { name: 'Thumbtack',               capabilityLevel: 'manual_assisted', manualInstructions: 'Go to thumbtack.com/pro → sign in → edit your profile or services → paste your text.' },
    angi:       { name: 'Angi',                    capabilityLevel: 'manual_assisted', manualInstructions: 'Go to pro.angi.com → sign in → edit your business profile → paste your text.' },
    linkedin:   { name: 'LinkedIn',                capabilityLevel: 'manual_assisted', manualInstructions: 'Go to linkedin.com → sign in → create a post from your business page → paste your text.' },
    x:          { name: 'X (Twitter)',             capabilityLevel: 'manual_assisted', manualInstructions: 'Go to x.com → sign in → compose a new post → paste your text.' },
    pinterest:  { name: 'Pinterest',               capabilityLevel: 'manual_assisted', manualInstructions: 'Go to pinterest.com → sign in → create a pin → paste your text.' },
  };

  const draftAdaptations = draftSnap.data().adaptations || {};

  const batch = db.batch();

  batch.update(userBizDraftsRef(uid, businessId).doc(draftId), {
    status: 'approved', approvedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  platformIds.forEach(pid => {
    const cap = PLATFORM_CAPABILITY_MAP[pid] || { name: pid, capabilityLevel: 'manual_assisted', manualInstructions: '' };
    const adaptedContent = draftAdaptations[pid] || '';
    const jobRef = userBizJobsRef(uid, businessId).doc();
    const isNativelyManual = ['manual_assisted', 'unsupported'].includes(cap.capabilityLevel);
    const isManual = isNativelyManual || isStarter;
    const starterBlocked = isStarter && !isNativelyManual;
    batch.set(jobRef, {
      jobId: jobRef.id, businessId, uid, draftId,
      platform: pid,
      capabilityLevel: cap.capabilityLevel,
      jobType: 'publish_listing',
      status: isManual ? 'manual_required' : 'pending',
      attempts: 0, maxAttempts: 3,
      customerLabel: isManual ? 'Action needed' : 'Waiting to publish',
      customerVisibleMessage: starterBlocked
        ? `Upgrade to Pro to auto-post to ${cap.name}. Your content is ready — copy it below.`
        : isManual
          ? `Your ${cap.name} listing is ready — you need to post it manually.`
          : `Your ${cap.name} listing is waiting to publish.`,
      planGated: starterBlocked,
      manualInstructions: cap.manualInstructions,
      adminError: '', payload: { adaptedContent },
      apiResponse: {}, customerNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
  res.json({ success: true, plan: userPlan });
}));

exports.postToBing = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  const { jobId, businessId: bingBizId } = req.body;
  if (jobId && bingBizId) {
    const jobSnap = await userBizJobsRef(decoded.uid, bingBizId).doc(jobId).get();
    if (!jobSnap.exists || jobSnap.data().uid !== decoded.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await userBizJobsRef(decoded.uid, bingBizId).doc(jobId).update({
      status: 'manual_required',
      customerVisibleMessage: 'Your Bing Places listing is ready — paste it at bingplaces.com.',
      manualUrl: 'https://www.bingplaces.com',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  res.json({ status: 'manual_required', manualUrl: 'https://www.bingplaces.com' });
}));

exports.postToAppleMaps = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  const { jobId, businessId: appleBizId } = req.body;
  if (jobId && appleBizId) {
    const jobSnap = await userBizJobsRef(decoded.uid, appleBizId).doc(jobId).get();
    if (!jobSnap.exists || jobSnap.data().uid !== decoded.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await userBizJobsRef(decoded.uid, appleBizId).doc(jobId).update({
      status: 'manual_required',
      customerVisibleMessage: 'Your Apple Maps listing is ready — submit it at mapsconnect.apple.com.',
      manualUrl: 'https://mapsconnect.apple.com',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  res.json({ status: 'manual_required', manualUrl: 'https://mapsconnect.apple.com' });
}));

exports.dispatchPublishJob = onDocumentCreated(
  { document: 'users/{userId}/businesses/{bizId}/publishJobs/{jobId}', region: 'us-central1', retry: true, secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  async (event) => {
    const job    = event.data.data();
    const jobRef = event.data.ref;
    const { userId: _pathUserId, bizId: _pathBizId } = event.params;

    if (job.status !== 'pending') return;
    if (job.planGated) return;

    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(jobRef);
        if (fresh.data().status !== 'pending') {
          throw Object.assign(new Error('already-claimed'), { code: 'ALREADY_CLAIMED' });
        }
        tx.update(jobRef, { status: 'processing', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      });
    } catch(txErr) {
      if (txErr.code === 'ALREADY_CLAIMED') return;
      throw txErr;
    }

    try {
      const connSnap = await userBizConnsRef(_pathUserId, _pathBizId).doc(job.platform).get();

      if (!connSnap.exists || connSnap.data().status !== 'connected') {
        await jobRef.update({
          status: 'failed',
          adminError: `No connected ${job.platform} account for business ${_pathBizId}`,
          customerVisibleMessage: `Your ${job.platform} account isn't connected. Go to Connect Platforms to link it.`,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
      }

      const tokens = await _getConnTokens(connSnap.ref);
      const conn = { ...connSnap.data(), ...tokens };
      let result;

      switch (job.platform) {
        case 'google':    result = await _publishGoogleJob(job, conn);    break;
        case 'facebook':  result = await _publishFacebookJob(job, conn);  break;
        case 'instagram': result = await _publishInstagramJob(job, conn); break;
        default:
          await jobRef.update({
            status: 'manual_required',
            adminError: `No automated publisher for platform: ${job.platform}`,
            customerVisibleMessage: `Your AI-written copy for ${job.platform} is ready — this platform requires manual posting. Copy your text from the listing preview and paste it directly.`,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          return;
      }

      if (result?.manualFallback) {
        await jobRef.update({
          status: 'manual_required',
          customerVisibleMessage: result.message || 'Please post this manually.',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
      }

      await jobRef.update({
        status: 'success',
        apiResponse: result,
        customerLabel: 'Published',
        customerVisibleMessage: `Your listing is live on ${job.platform}.`,
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    } catch(e) {
      const MAX_RETRIES = 5;
      const freshSnap = await jobRef.get().catch(() => null);
      const retryCount = ((freshSnap?.data()?.retryCount) || 0) + 1;
      console.error(`dispatchPublishJob [${event.params.jobId}] attempt ${retryCount} failed:`, e.message);

      if (retryCount >= MAX_RETRIES) {
        await jobRef.update({
          status: 'failed',
          retryCount,
          adminError: `Permanent failure after ${MAX_RETRIES} attempts: ${e.message}`,
          customerVisibleMessage: `There was a problem posting to ${job.platform}. Our team will follow up.`,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }).catch(() => {});
        return;
      }

      await jobRef.update({
        status: 'pending',
        retryCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
      throw e;
    }
  }
);

exports.jobFailedTrigger = onDocumentUpdated(
  { document: 'users/{userId}/businesses/{bizId}/publishJobs/{jobId}', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    if (before.status === after.status || after.status !== 'failed') return;

    const uid = event.params.userId;
    if (!uid) return;
    let toEmail, ownerName, businessName;
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) return;
      const userData = userSnap.data();
      toEmail = userData.email;
      ownerName = userData.ownerName || userData.displayName || '';
    } catch(e) { console.warn('[jobFailedTrigger] users read failed:', e.message); return; }
    if (!toEmail) return;

    try {
      const bizSnap = await userBizCol(uid).limit(1).get();
      businessName = bizSnap.docs[0]?.data()?.businessName || '';
    } catch(e) { /* non-fatal */ }

    const platformRaw = (after.platform || 'your platform').replace(/_/g, ' ');
    const platformDisplay = platformRaw.replace(/\b\w/g, c => c.toUpperCase());

    const mergeData = {
      name: ownerName || 'there',
      businessName: businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
      platform: platformDisplay,
      dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
      appUrl: APP_BASE_URL,
    };
    function applyFailedTags(str) {
      return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
    }

    let subject = `Heads up, ${mergeData.name} — your ${platformDisplay} post needs attention`;
    let html = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'job-failed').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) {
        const tmpl = tmplSnap.docs[0].data();
        subject = applyFailedTags(tmpl.subject || subject);
        html = applyFailedTags(tmpl.html || '');
      }
    } catch(e) { console.error('[jobFailedTrigger] template fetch failed:', e.message); }

    if (!html) {
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Heads up, ${mergeData.name} — your ${platformDisplay} post hit a snag.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">We tried to publish <strong>${mergeData.businessName}</strong>'s content to <strong>${platformDisplay}</strong> automatically, but ran into an issue.</p>
    <div style="background:#fff3cd;border-left:4px solid #ffc107;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:13px;font-weight:700;color:#856404;margin-bottom:4px">What happened</div>
      <div style="font-size:14px;color:#6b5300">${after.customerVisibleMessage || 'Your post could not be published automatically.'}</div>
    </div>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Go to Dashboard &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Your AI-written copy is saved — nothing is lost. You can post it manually or reply to this email if you need help.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
    }

    await sendResendEmail({ to: toEmail, subject, html });
  }
);

exports.jobCompletedTrigger = onDocumentUpdated(
  { document: 'users/{userId}/businesses/{bizId}/publishJobs/{jobId}', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    if (before.status === after.status || after.status !== 'success') return;

    const uid = event.params.userId;
    if (!uid) return;
    let toEmail, ownerName, businessName;
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) return;
      const userData = userSnap.data();
      toEmail = userData.email;
      ownerName = userData.ownerName || userData.displayName || '';
    } catch(e) { console.warn('[jobCompletedTrigger] users read failed:', e.message); return; }
    if (!toEmail) return;

    try {
      const bizSnap = await userBizCol(uid).limit(1).get();
      businessName = bizSnap.docs[0]?.data()?.businessName || '';
    } catch(e) { /* non-fatal */ }

    const platformRaw = (after.platform || 'your platform').replace(/_/g, ' ');
    const platformDisplay = platformRaw.replace(/\b\w/g, c => c.toUpperCase());

    const mergeData = {
      name: ownerName || 'there',
      businessName: businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
      platform: platformDisplay,
      dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
      appUrl: APP_BASE_URL,
    };
    function applyCompletedTags(str) {
      return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
    }

    let subject = `Your listing is live on ${platformDisplay}, ${mergeData.name}! 🚀`;
    let html = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'job-completed').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) {
        const tmpl = tmplSnap.docs[0].data();
        subject = applyCompletedTags(tmpl.subject || subject);
        html = applyCompletedTags(tmpl.html || '');
      }
    } catch(e) { console.error('[jobCompletedTrigger] template fetch failed:', e.message); }

    if (!html) {
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <div style="display:inline-block;background:#e8f5e9;border-radius:100px;padding:8px 18px;font-size:13px;font-weight:700;color:#00873a;margin-bottom:20px">&#10003; Posted successfully</div>
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">${mergeData.businessName} is live on ${platformDisplay}. &#128640;</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">Hey ${mergeData.name} — BlastyBiz just published your listing to <strong>${platformDisplay}</strong>. It's out there right now, working for you.</p>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px;margin-bottom:24px">View Your Dashboard &#8594;</a>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0">Keep the momentum going — blast to another platform or schedule your next post from the dashboard.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
    }

    await sendResendEmail({ to: toEmail, subject, html });
  }
);

exports.userCreatedTrigger = onDocumentCreated(
  { document: 'users/{uid}', region: 'us-central1' },
  async (event) => {
    const uid = event.params.uid;
    const userData = event.data.data();
    try {
      await db.collection('setupNudges').doc(uid).set({
        uid,
        email: userData.email || null,
        sendAfter: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch(e) { console.error('[userCreatedTrigger] setupNudges write failed:', e.message); }
  }
);

exports.businessCreatedTrigger = onDocumentCreated(
  { document: 'users/{uid}/businesses/{bizId}', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const biz = event.data.data();
    const uid = event.params.uid;
    if (!uid) return;

    let email, ownerName, plan;
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) return;
      const userData = userSnap.data();
      email     = userData.email;
      ownerName = biz.ownerName || userData.ownerName || userData.displayName || '';
      plan      = userData.plan || 'starter';
    } catch(e) { console.warn('[businessCreatedTrigger] users read failed:', e.message); return; }
    if (!email) return;

    const businessName = biz.businessName || (ownerName ? ownerName + '\'s Business' : 'your business');
    const isPro    = plan === 'pro';
    const isAgency = plan === 'agency';

    const mergeData = {
      name: ownerName || 'there',
      businessName,
      dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
      upgradeUrl:   APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
      appUrl:       APP_BASE_URL,
    };
    function applyTags(str) {
      return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
    }

    let templateType, subject, html;

    if (isAgency) {
      templateType = 'agency-welcome';
      subject = `Welcome to BlastyBiz Agency, ${mergeData.name} — you&#39;re all set. 🚀`;
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">You&#39;re Agency, ${mergeData.name}. Full power unlocked.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 12px"><strong>${mergeData.businessName}</strong> is live on BlastyBiz Agency. You can manage unlimited client businesses, blast to every platform, and schedule posts automatically.</p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 20px">Add your first client from the dashboard and start blasting.</p>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Open Dashboard &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;

    } else if (isPro) {
      templateType = 'pro-welcome';
      subject = `Welcome to BlastyBiz Pro, ${mergeData.name} — let&#39;s get blasting. 🎯`;
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">You&#39;re Pro, ${mergeData.name}. Everything&#39;s unlocked.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 12px"><strong>${mergeData.businessName}</strong> is set up on BlastyBiz Pro. You have full API publishing, auto-scheduled posts, and unlimited blasts.</p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 20px">Head to your dashboard and fire off your first blast — it takes about 5 minutes.</p>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Go to Dashboard &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;

    } else {
      templateType = 'welcome';
      subject = `Welcome to BlastyBiz, ${mergeData.name}! 🚀`;
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">You&#39;re in, ${mergeData.name}. Let&#39;s blast.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 12px"><strong>${mergeData.businessName}</strong> is set up and ready. Fill out your profile once — BlastyBiz writes the copy for every platform automatically.</p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 20px">You&#39;re on the free Starter plan. Upgrade to Pro anytime to unlock auto-publishing and scheduled posts.</p>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Go to Dashboard &#8594;</a>
    <div style="margin-top:20px">
      <a href="${mergeData.upgradeUrl}" style="font-size:13px;color:#00873a;font-weight:700;text-decoration:none">Upgrade to Pro &#8594;</a>
    </div>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
    }

    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', templateType)
        .where('active', '==', true)
        .limit(1)
        .get();
      if (!tmplSnap.empty) {
        const tmpl = tmplSnap.docs[0].data();
        subject = applyTags(tmpl.subject || subject);
        html    = applyTags(tmpl.html    || html);
      }
    } catch(e) { console.error('[businessCreatedTrigger] template fetch failed:', e.message); }

    await sendResendEmail({ to: email, subject, html });

    try {
      await sendResendEmail({
        to: 'info@blastybiz.com',
        subject: `[BlastyBiz] New signup (${plan}): ${mergeData.name} (${email})`,
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
  <h2 style="margin:0 0 12px;font-size:18px">&#128226; New signup — onboarding complete</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#888;width:140px">Plan</td><td style="padding:6px 0;font-weight:700;color:#00873a;text-transform:uppercase">${plan}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Name</td><td style="padding:6px 0;font-weight:600">${mergeData.name}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0">${email}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Business</td><td style="padding:6px 0">${businessName}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Time</td><td style="padding:6px 0">${new Date().toUTCString()}</td></tr>
  </table>
</div>`,
      });
    } catch(e) { console.warn('[businessCreatedTrigger] admin alert failed:', e.message); }
  }
);
