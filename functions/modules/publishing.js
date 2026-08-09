/**
 * BlastyBiz — Publishing endpoints and Firestore triggers
 * uploadImage, approvePendingPost, approveDraft,
 * postToBing, postToAppleMaps, dispatchPublishJob,
 * jobFailedTrigger, jobCompletedTrigger,
 * userCreatedTrigger, businessCreatedTrigger,
 * importGooglePhotos, onGoogleImportQueued,
 * draftAction
 */
'use strict';

const {
  onRequest, onDocumentUpdated, onDocumentCreated, admin, db, axios,
  APP_BASE_URL, sendResendEmail,
  userBizRef, userBizCol, userBizDraftsRef, userBizJobsRef, userBizPostsRef, userBizConnsRef,
  _getConnTokens, _setConnTokens,
  withAuth,
  makeActionSig, _actionSecret, computeNextRunAt,
  PLATFORM_CAPABILITY_MAP,
} = require('../lib/shared');

const crypto = require('crypto');

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

async function _publishGoogleJob(job, conn, pathUserId, pathBizId) {
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
      // 2.8: use path-derived uid/bizId, never trust doc-data fields for path construction
      const gConnRef = userBizConnsRef(pathUserId, pathBizId).doc('google');
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
  // 3.6: make public (photos are posted to public social platforms anyway) — no expiry risk
  await file.makePublic();
  const url = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
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

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  const { draftId, businessId, platforms: legacyPlatforms, platformKeys } = req.body;

  if (!businessId || typeof businessId !== 'string') {
    return res.status(400).json({ error: 'Missing required field: businessId' });
  }
  if (businessId.includes('/')) {
    return res.status(400).json({ error: 'Invalid businessId: must not contain "/"' });
  }
  if (!draftId || typeof draftId !== 'string') {
    return res.status(400).json({ error: 'Missing required field: draftId' });
  }
  if (draftId.includes('/')) {
    return res.status(400).json({ error: 'Invalid draftId: must not contain "/"' });
  }

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

  const draftRef = userBizDraftsRef(uid, businessId).doc(draftId);

  // Claiming the draft and creating its jobs happen in ONE transaction. Checking
  // status first and committing a batch afterwards is not enough: two requests
  // that arrive together both read the draft as unapproved and both commit, so
  // the blast goes out twice.
  const ALREADY = 'already_approved';
  const NOTHING = 'nothing_to_publish';

  let publishedCount = 0;
  try {
    publishedCount = await db.runTransaction(async (tx) => {
      const snap = await tx.get(draftRef);
      if (!snap.exists || snap.data().uid !== uid) throw new Error('forbidden');

      const draftData = snap.data();
      if (draftData.status === 'approved') throw new Error(ALREADY);

      const draftAdaptations = draftData.adaptations || {};
      const platformStatus   = draftData.platformStatus || {};
      const hasStatusMap     = Object.keys(platformStatus).length > 0;

      // The DRAFT decides what may publish — never the request body. A caller can ask
      // for a subset, but asking for a platform that was excluded, never generated, or
      // simply invented must not create a job (an empty-content job would otherwise be
      // dispatched for the auto-posting platforms).
      const eligible = Object.keys(draftAdaptations).filter(pid => {
        const content = draftAdaptations[pid];
        if (typeof content !== 'string' || !content.trim()) return false;
        return hasStatusMap ? platformStatus[pid] === 'approved' : true;
      });

      const publishIds = [...new Set(
        platformIds.length ? platformIds.filter(pid => eligible.includes(pid)) : eligible
      )];
      if (publishIds.length === 0) throw new Error(NOTHING);

      // Photos are read from the draft, never from the request body — the client only tells us
      // which platforms to publish. Cap at 10 (the most permissive platform limit) and keep only
      // https URLs so a malformed draft can't feed a publisher junk.
      const draftImages = draftData.imagesByPlatform || {};
      const imagesFor = (pid) => (Array.isArray(draftImages[pid]) ? draftImages[pid] : [])
        .filter(u => typeof u === 'string' && /^https:\/\//.test(u))
        .slice(0, 10);

      tx.update(draftRef, {
        status: 'approved', approvedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      publishIds.forEach(pid => buildJob(tx, pid, draftAdaptations, imagesFor));
      return publishIds.length;
    });
  } catch (e) {
    if (e.message === ALREADY) return res.status(409).json({ error: 'This blast has already been sent.' });
    if (e.message === NOTHING) {
      return res.status(400).json({
        error: 'Nothing to publish — no approved platform on this draft has generated copy.'
      });
    }
    if (e.message === 'forbidden') {
      return res.status(403).json({ error: 'Forbidden: draft does not belong to you' });
    }
    throw e;
  }

  res.json({ success: true, plan: userPlan, published: publishedCount });

  function buildJob(tx, pid, draftAdaptations, imagesFor) {
    const cap = PLATFORM_CAPABILITY_MAP[pid] || { name: pid, capabilityLevel: 'manual_assisted', manualInstructions: '' };
    const adaptedContent = draftAdaptations[pid] || '';
    const jobRef = userBizJobsRef(uid, businessId).doc();
    const isNativelyManual = ['manual_assisted', 'unsupported'].includes(cap.capabilityLevel);
    const isManual = isNativelyManual || isStarter;
    const starterBlocked = isStarter && !isNativelyManual;
    tx.set(jobRef, {
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
      adminError: '', payload: { adaptedContent, imageUrls: imagesFor(pid) },
      apiResponse: {}, customerNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
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
          status: 'needs_connection',
          adminError: `No connected ${job.platform} account for business ${_pathBizId}`,
          customerLabel: 'Not connected yet',
          customerVisibleMessage: `Your ${job.platform} account isn't connected yet. Connect it to publish this post automatically.`,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
      }

      const tokens = await _getConnTokens(connSnap.ref);
      const conn = { ...connSnap.data(), ...tokens };
      let result;

      switch (job.platform) {
        case 'google':    result = await _publishGoogleJob(job, conn, _pathUserId, _pathBizId);    break;
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

// ── Google Business Profile photo import ──────────────────────────────────

/**
 * Shared import logic — called from both onGoogleImportQueued trigger and
 * the importGooglePhotos onRequest endpoint (manual re-import).
 *
 * Fetches up to 20 photos from the GBP media API, validates magic bytes,
 * deduplicates by SHA-256 content hash, uploads to Storage, writes to the
 * business images subcollection, and tracks progress in importJobs/{uid}_google.
 */
async function _runGooglePhotoImport(uid, bizId) {
  const jobRef = db.collection('importJobs').doc(uid + '_google');

  try {
    const connRef = userBizConnsRef(uid, bizId).doc('google');
    const connSnap = await connRef.get();
    if (!connSnap.exists || connSnap.data().status !== 'connected') {
      await jobRef.set({ status: 'skipped', reason: 'not_connected', uid, bizId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return;
    }
    const conn = connSnap.data();
    const tokens = await _getConnTokens(connRef);
    if (!tokens?.accessToken) {
      await jobRef.set({ status: 'skipped', reason: 'no_token', uid, bizId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    const { accountId, locationId } = conn;
    if (!accountId || !locationId) {
      await jobRef.set({ status: 'skipped', reason: 'no_location', uid, bizId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    await jobRef.set({
      uid, bizId, status: 'running', total: 0, done: 0,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Fetch GBP media list
    let mediaItems = [];
    try {
      const resp = await axios.get(
        `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/media`,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` }, timeout: 15000 }
      );
      mediaItems = resp.data.mediaItems || [];
    } catch(e) {
      if (e.response?.status === 429) {
        await jobRef.update({ status: 'quota_exceeded', error: 'GBP quota exceeded',
          updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        return;
      }
      console.warn('[importGooglePhotos] media list fetch failed:', e.message);
      await jobRef.update({ status: 'failed', error: e.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    const toImport = mediaItems
      .filter(item => !item.mediaFormat || item.mediaFormat === 'PHOTO')
      .slice(0, 20);

    await jobRef.update({ total: toImport.length, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    if (!toImport.length) {
      await jobRef.update({ status: 'done', done: 0,
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:   admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    // Pre-fetch existing content hashes to deduplicate
    const existingSnap = await userBizRef(uid, bizId).collection('images')
      .where('source', '==', 'google_import').get();
    const existingHashes = new Set(
      existingSnap.docs.map(d => d.data().contentHash).filter(Boolean)
    );

    const bucket = admin.storage().bucket();
    const MAX_BYTES = 5 * 1024 * 1024;
    let done = 0;

    for (const item of toImport) {
      const googleUrl = item.googleUrl || item.sourceUrl;
      if (!googleUrl) { done++; await jobRef.update({ done }); continue; }

      try {
        const photoResp = await axios.get(googleUrl, {
          responseType: 'arraybuffer',
          timeout: 20000,
          maxContentLength: MAX_BYTES + 1024,
        });
        const raw = Buffer.from(photoResp.data);

        // 5 MB cap
        if (raw.length > MAX_BYTES) { done++; await jobRef.update({ done }); continue; }

        // Magic-byte validation (JPEG / PNG / WEBP)
        const isJpeg = raw[0] === 0xFF && raw[1] === 0xD8;
        const isPng  = raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4E && raw[3] === 0x47;
        const isWebp = raw.slice(0,4).toString('binary') === 'RIFF' &&
                       raw.slice(8,12).toString('binary') === 'WEBP';
        if (!isJpeg && !isPng && !isWebp) { done++; await jobRef.update({ done }); continue; }

        // SHA-256 content-hash dedup
        const contentHash = crypto.createHash('sha256').update(raw).digest('hex');
        if (existingHashes.has(contentHash)) { done++; await jobRef.update({ done }); continue; }
        existingHashes.add(contentHash);

        const mimeType  = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp';
        const ext       = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
        const storePath = `photos/${uid}/global/${Date.now()}_gbp_${done}.${ext}`;

        const file = bucket.file(storePath);
        await file.save(raw, { contentType: mimeType });
        await file.makePublic();
        const url = `https://storage.googleapis.com/${bucket.name}/${storePath}`;

        await userBizRef(uid, bizId).collection('images').add({
          uid, bizId, url, contentHash, source: 'google_import', mimeType,
          originalGoogleUrl: googleUrl,
          mediaFormat:  item.mediaFormat || 'PHOTO',
          createTime:   item.createTime  || null,
          createdAt:    admin.firestore.FieldValue.serverTimestamp(),
        });

      } catch(e) {
        if (e.response?.status === 429) {
          await jobRef.update({ status: 'partial', done,
            error: 'GBP quota limit hit during download',
            updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          return;
        }
        console.warn(`[importGooglePhotos] item ${done} skipped:`, e.message);
      }

      done++;
      await jobRef.update({ done, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }

    await jobRef.update({
      status: 'done', done, total: toImport.length,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
    });

  } catch(e) {
    console.error('[importGooglePhotos] unexpected error:', e.message);
    await jobRef.update({ status: 'failed', error: e.message,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
  }
}

/**
 * onRequest — authenticated manual re-import (e.g. from a "Re-import Photos" button).
 * Responds immediately; import runs in background.
 */
exports.importGooglePhotos = onRequest(
  { invoker: 'public', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], timeoutSeconds: 120, region: 'us-central1' },
  withAuth(async (req, res, decoded) => {
    const uid   = decoded.uid;
    const bizId = req.body?.bizId;
    if (!bizId) return res.status(400).json({ error: 'bizId required' });
    const bizSnap = await userBizRef(uid, bizId).get();
    if (!bizSnap.exists) return res.status(403).json({ error: 'Business not found' });
    // Fire-and-forget — respond immediately so the client isn't blocked
    _runGooglePhotoImport(uid, bizId).catch(e =>
      console.error('[importGooglePhotos] bg error:', e.message)
    );
    res.json({ ok: true, queued: true });
  })
);

/**
 * Firestore trigger — runs when googleOAuthCallback writes importJobs/{uid}_google
 * with status 'queued'. Calls the shared import helper.
 */
exports.onGoogleImportQueued = onDocumentCreated(
  { document: 'importJobs/{docId}', region: 'us-central1' },
  async (event) => {
    const data = event.data?.data?.();
    if (!data || data.status !== 'queued') return;
    const { uid, bizId } = data;
    if (!uid || !bizId) return;
    await _runGooglePhotoImport(uid, bizId);
  }
);

// ── draftAction — email approval-queue action handler ─────────────────────────
// Unauthenticated endpoint; HMAC signature is the auth.
// ?uid=&biz=&draft=&action=approve|skip|change|pause&sig=&cycle=

function _actionHtmlPage(icon, title, body, dashUrl) {
  const cta = dashUrl ? `<p style="margin:24px 0 0"><a href="${dashUrl}" style="color:#00C853;font-weight:700;text-decoration:none">Back to Dashboard →</a></p>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — BlastyBiz</title>
<style>body{font-family:Arial,sans-serif;background:#0d1a0d;color:#f0f0f0;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#1a2e1a;border-radius:16px;padding:40px 36px;max-width:480px;width:100%;text-align:center;box-shadow:0 4px 32px rgba(0,0,0,.4)}
.icon{font-size:48px;margin-bottom:16px}.title{font-size:22px;font-weight:800;margin:0 0 12px;color:#fff}
.body{font-size:15px;color:#ccc;line-height:1.65;margin:0}</style></head>
<body><div class="card"><div class="icon">${icon}</div><h1 class="title">${title}</h1><p class="body">${body}</p>${cta}</div></body></html>`;
}

exports.draftAction = onRequest(
  { invoker: 'public', region: 'us-central1',
    secrets: ['ACTION_SIGNING_KEY', 'UNSUB_SIGNING_KEY', 'RESEND_API_KEY'] },
  async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const { uid, biz: bizId, draft: draftId, action, sig, cycle } = req.query;
    const dashUrl = APP_BASE_URL + '/BlastyBiz.html';

    if (!uid || !draftId || !action || !sig || !cycle) {
      return res.status(400).send(_actionHtmlPage('❌', 'Missing parameters',
        'This action link is incomplete. Check your email for the correct link.'));
    }
    if (!['approve', 'skip', 'change', 'pause'].includes(action)) {
      return res.status(400).send(_actionHtmlPage('❌', 'Unknown action',
        'This link contains an unrecognised action type.'));
    }

    // ── Verify HMAC signature ────────────────────────────────────────────────
    const key = _actionSecret();
    if (!key) return res.status(500).send(_actionHtmlPage('⚙️', 'Configuration error',
      'Please contact support@blastybiz.com.'));

    // cycle is included in the signature so it cannot be tampered with
    const expected = makeActionSig(uid, draftId, action, cycle, key);
    let sigValid = false;
    try {
      sigValid = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch(_) { /* invalid hex — sigValid stays false */ }
    if (!sigValid) {
      return res.status(400).send(_actionHtmlPage('🔒', 'Invalid link',
        'This action link is not valid or has been tampered with. Links in your original preview email are correct.'));
    }

    // ── Check link age (14 days) ─────────────────────────────────────────────
    const cycleTs = parseInt(cycle, 10);
    if (!cycleTs || Date.now() - cycleTs > 14 * 24 * 60 * 60 * 1000) {
      return res.status(400).send(_actionHtmlPage('⏱', 'Link expired',
        'This link has expired — preview links are valid for 14 days. Your next scheduled preview will arrive soon.', dashUrl));
    }

    // ── "change" — just redirect (no Firestore write needed) ────────────────
    if (action === 'change') {
      const target = `${APP_BASE_URL}/BlastyBiz.html${draftId ? '?edit=1' : ''}`;
      return res.redirect(302, target);
    }

    // ── Single-use record check (approve / skip / pause) ────────────────────
    const actionKey = `${uid}_${draftId}_${cycle}`;
    const actionRef  = db.collection('draftActions').doc(actionKey);

    let actionSnap;
    try { actionSnap = await actionRef.get(); } catch(e) {
      return res.status(500).send(_actionHtmlPage('⚙️', 'Error', 'Could not verify link. Please try again.'));
    }
    if (actionSnap.exists) {
      const prev = actionSnap.data().action || 'this';
      return res.send(_actionHtmlPage('✓', 'Already done',
        `You already used the <strong>${prev}</strong> action from this email. Check your dashboard to see the current post status.`, dashUrl));
    }

    // ── Resolve draft path ───────────────────────────────────────────────────
    // We trust uid (it's in the sig). biz is provided in the URL for direct lookup;
    // fall back to collectionGroup scan if omitted.
    let draftRef;
    if (bizId) {
      draftRef = db.collection('users').doc(uid).collection('businesses')
        .doc(bizId).collection('listingDrafts').doc(draftId);
    } else {
      try {
        const q = await db.collectionGroup('listingDrafts')
          .where('uid', '==', uid).limit(50).get();
        const found = q.docs.find(d => d.id === draftId);
        if (found) draftRef = found.ref;
      } catch(e) { /* non-fatal */ }
    }

    if (!draftRef) {
      return res.status(404).send(_actionHtmlPage('🔍', 'Draft not found',
        'This draft may have been deleted or moved. Head to your dashboard to manage your posts.', dashUrl));
    }

    // ── Execute action ───────────────────────────────────────────────────────
    try {
      if (action === 'pause') {
        // Resolve bizId for the pause write — prefer URL param, else parse from draftRef path
        const targetBizId = bizId || draftRef.path.split('/')[3];
        if (targetBizId) {
          await db.collection('users').doc(uid).collection('businesses').doc(targetBizId).update({
            schedulingPaused: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        await actionRef.set({ uid, draftId, action: 'pause', cycle,
          usedAt: admin.firestore.FieldValue.serverTimestamp() });
        // Track email engagement
        await db.collection('users').doc(uid).update({
          lastEmailEngagedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
        return res.send(_actionHtmlPage('⏸', 'Scheduling paused',
          'Your automated posts have been paused. Log in to BlastyBiz anytime to resume.', dashUrl));
      }

      const draftSnap = await draftRef.get();
      if (!draftSnap.exists) {
        return res.status(404).send(_actionHtmlPage('🔍', 'Draft not found',
          'This draft no longer exists.', dashUrl));
      }
      const schedule = (draftSnap.data().schedule || {});

      if (action === 'approve') {
        await draftRef.update({
          'schedule.approved': true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await actionRef.set({ uid, draftId, action: 'approve', cycle,
          usedAt: admin.firestore.FieldValue.serverTimestamp() });
        await db.collection('users').doc(uid).update({
          lastEmailEngagedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
        return res.send(_actionHtmlPage('✅', 'Post approved!',
          'Your post has been approved and will go out as scheduled. You don\'t need to do anything else.', dashUrl));
      }

      if (action === 'skip') {
        // Set skipCycle flag only — do NOT advance nextRunAt here.
        // scheduledPostingCheck sees the flag, advances nextRunAt exactly once,
        // then clears it. Advancing here too would skip two cycles.
        await draftRef.update({
          'schedule.skipCycle':     true,
          'schedule.previewSentAt': admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await actionRef.set({ uid, draftId, action: 'skip', cycle,
          usedAt: admin.firestore.FieldValue.serverTimestamp() });
        await db.collection('users').doc(uid).update({
          lastEmailEngagedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
        const nextRunAt = computeNextRunAt(schedule, new Date(schedule.nextRunAt || Date.now()));
        const nextFmt = nextRunAt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        return res.send(_actionHtmlPage('⏭', 'Post skipped',
          `This cycle has been skipped. Your next scheduled post is due <strong>${nextFmt}</strong>.`, dashUrl));
      }
    } catch(e) {
      console.error('[draftAction] error:', e.message);
      return res.status(500).send(_actionHtmlPage('⚙️', 'Something went wrong',
        'Please try again or contact support@blastybiz.com.'));
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────

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
