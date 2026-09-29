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

// Only errors from the actual publication request can mean a post was accepted.
async function _publicationPost(url, data, config = {}) {
  try { return await axios.post(url, data, { ...config, timeout: 30000 }); }
  catch(e) {
    const status = e.response?.status;
    const mayHaveBeenSent = !e.response && ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(e.code);
    if (mayHaveBeenSent || status === 408 || status >= 500) e.publicationUncertain = true;
    throw e;
  }
}
function _publisherError(platform, e) {
  return Object.assign(new Error(platform + ' API: ' + (e.response?.data?.error?.message || e.message)), { publicationUncertain: e.publicationUncertain === true });
}

async function _publishGoogleJob(job, conn, pathUserId, pathBizId) {
  const content   = job.payload?.adaptedContent || '';
  const imageUrls = job.payload?.imageUrls || [];
  async function tryPost(token) {
    return _publicationPost(
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
    throw _publisherError('Google', e);
  }
}

async function _publishFacebookJob(job, conn) {
  const content = job.payload?.adaptedContent || '';
  try {
    const r = await _publicationPost(
      `https://graph.facebook.com/v18.0/${conn.pageId}/feed`,
      { message: content, access_token: conn.accessToken }
    );
    return { postId: r.data.id };
  } catch(e) {
    throw _publisherError('Facebook', e);
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
    const pub = await _publicationPost(
      `https://graph.facebook.com/v18.0/${conn.igUserId}/media_publish`,
      { creation_id: media.data.id, access_token: conn.accessToken }
    );
    return { postId: pub.data.id };
  } catch(e) {
    throw _publisherError('Instagram', e);
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { pendingPostId, bizId: pendingBizId, action = 'approve' } = req.body || {};
  const validId = value => typeof value === 'string' && value.trim() && !value.includes('/');
  if (!validId(pendingPostId) || !validId(pendingBizId)) return res.status(400).json({ error: 'Valid pendingPostId and bizId required' });
  if (!['approve', 'dismiss'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const fail = (status, message) => { throw Object.assign(new Error(message), { httpStatus: status }); };
  try {
    const postRef = userBizPostsRef(decoded.uid, pendingBizId).doc(pendingPostId);
    const result = await db.runTransaction(async tx => {
      const postSnap = await tx.get(postRef);
      if (!postSnap.exists) fail(404, 'Post not found');
      const post = postSnap.data();
      if (post.uid !== decoded.uid || (post.bizId && post.bizId !== pendingBizId)) fail(403, 'Forbidden');
      const targetStatus = action === 'dismiss' ? 'dismissed' : 'approved';
      if (post.status === targetStatus) return { ok: true, alreadyProcessed: true };
      if (post.status !== 'pending') fail(409, 'This post has already been processed');
      if (action === 'dismiss') {
        tx.update(postRef, { status: 'dismissed', dismissedAt: admin.firestore.FieldValue.serverTimestamp() });
        return { ok: true };
      }
      const userSnap = await tx.get(db.collection('users').doc(decoded.uid));
      if (!userSnap.exists) fail(404, 'Account not found');
      const isStarter = (userSnap.data().plan || 'starter') === 'starter';
      const { adaptations, platforms } = post;
      const imageUrls = post.imageUrls || [];
      if (!Array.isArray(imageUrls) || imageUrls.some(url => typeof url !== 'string' || !/^https:\/\//i.test(url))) fail(400, 'Post contains invalid image URLs');
      if (!Array.isArray(platforms) || platforms.length > 100) fail(400, 'Invalid platforms');
      const seen = new Set();
      const jobs = [];
      for (const p of platforms) {
        if (!p || !validId(p.id)) fail(400, 'Invalid platform');
        const type = p.type === 'api' ? 'api' : 'manual';
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const content = (adaptations || {})[p.id];
        if (!content) continue;
        if (typeof content !== 'string') fail(400, 'Invalid post content');
        const isManual = type === 'manual' || isStarter;
        // Stable per post/platform; repeated HTTP requests cannot create another job.
        const jobId = 'pending_' + crypto.createHash('sha256').update(JSON.stringify([pendingPostId, p.id])).digest('hex');
        const jobRef = userBizJobsRef(decoded.uid, pendingBizId).doc(jobId);
        jobs.push({ ref: jobRef, data: {
      jobId: jobRef.id, businessId: pendingBizId, uid: decoded.uid,
      platform: p.id, platformName: p.name || p.id,
      capabilityLevel: type === 'api' ? 'full_api' : 'manual_assisted',
      jobType: 'scheduled_approved',
      status: isManual ? 'manual_required' : 'pending',
      attempts: 0, maxAttempts: 3,
      customerLabel: isManual ? 'Action needed' : 'Waiting to publish',
      customerVisibleMessage: isManual
        ? `Your approved ${p.name || p.id} post is ready — copy it below.`
        : `Your approved ${p.name || p.id} post is waiting to publish.`,
      planGated: isStarter && type === 'api',
      payload: { adaptedContent: content, imageUrls: [...imageUrls] },
      apiResponse: {}, customerNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        } });
      }
      if (!jobs.length) fail(400, 'There is no generated content to approve');
      for (const job of jobs) tx.create(job.ref, job.data);
      tx.update(postRef, { status: 'approved', approvedAt: admin.firestore.FieldValue.serverTimestamp() });
      return { ok: true };
    });
    return res.json(result);
  } catch(e) {
    console.error('[approvePendingPost]', e.message);
    return res.status(e.httpStatus || 500).json({ error: e.httpStatus ? e.message : 'Could not save your decision. Please retry.' });
  }
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
    let job      = event.data.data();
    const jobRef = event.data.ref;
    const { userId: _pathUserId, bizId: _pathBizId } = event.params;

    if (job.status !== 'pending') return;
    if (job.planGated) return;

    try {
      job = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(jobRef);
        if (!fresh.exists || fresh.data().status !== 'pending' || fresh.data().planGated) {
          throw Object.assign(new Error('already-claimed'), { code: 'ALREADY_CLAIMED' });
        }
        tx.update(jobRef, { status: 'processing', adminRetry: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        return fresh.data();
      });
    } catch(txErr) {
      if (txErr.code === 'ALREADY_CLAIMED') return;
      throw txErr;
    }

    let providerReturned = false;
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

      providerReturned = true;
      await jobRef.update({
        status: 'success',
        apiResponse: result,
        customerLabel: 'Published',
        customerVisibleMessage: `Your listing is live on ${job.platform}.`,
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    } catch(e) {
      if (providerReturned || e.publicationUncertain) {
        // The provider accepted the post. Retrying the create event must not post it again.
        await jobRef.update({
          status: 'manual_required', publicationUncertain: true,
          adminError: e.message,
          customerVisibleMessage: 'Post may be live on the platform. Check before retrying.',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }).catch(writeError => console.error('[dispatchPublishJob] could not record publication uncertainty:', writeError.message));
        return;
      }
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
    if (after.adminRetry === true) return; // Operator retries must not resend customer failure emails.

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
      const bizSnap = await userBizRef(uid, event.params.bizId).get();
      businessName = bizSnap.data()?.businessName || '';
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
      const bizSnap = await userBizRef(uid, event.params.bizId).get();
      businessName = bizSnap.data()?.businessName || '';
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
  { invoker: 'public', region: 'us-central1', secrets: ['ACTION_SIGNING_KEY', 'UNSUB_SIGNING_KEY', 'RESEND_API_KEY'] },
  async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Referrer-Policy', 'no-referrer');
    const dashUrl = APP_BASE_URL + '/BlastyBiz.html';
    const { uid, biz: bizId, draft: draftId, action, sig, cycle } = req.query || {};
    const validId = x => typeof x === 'string' && x.length > 0 && x.length <= 128 && !x.includes('/');
    const fail = (status, message) => { throw Object.assign(new Error(message), { httpStatus: status }); };
    const errorPage = (status, message) => res.status(status).send(_actionHtmlPage('⚠️', 'Action unavailable', message, dashUrl));
    if (!['GET','POST'].includes(req.method)) return errorPage(405, 'Use the confirmation button in your preview link.');
    if (![uid,bizId,draftId].every(validId) || !['approve','skip','change','pause'].includes(action) || typeof sig !== 'string' || !/^[a-f0-9]{64}$/.test(sig) || typeof cycle !== 'string' || !/^\d{13}$/.test(cycle)) {
      return errorPage(400, 'This link is incomplete or from an older preview. Open your dashboard or use your next preview email.');
    }
    const key = _actionSecret();
    if (!key) return errorPage(503, 'Action links are temporarily unavailable. Please use your dashboard.');
    const expected = makeActionSig(uid, bizId, draftId, action, cycle, key);
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return errorPage(400, 'This link is invalid. Use the original preview email.');
    const cycleTs = Number(cycle);
    if (Math.abs(Date.now() - cycleTs) > 14 * 86400000) return errorPage(410, 'This preview has expired. Open your current schedule in the dashboard.');
    const userRef = db.collection('users').doc(uid);
    const bizRef = userRef.collection('businesses').doc(bizId);
    const draftRef = bizRef.collection('listingDrafts').doc(draftId);
    const actionRef = db.collection('draftActions').doc(crypto.createHash('sha256').update(JSON.stringify([uid,bizId,draftId,cycle])).digest('hex'));
    const validate = (draftSnap, bizSnap) => {
      if (!draftSnap.exists || !bizSnap.exists) fail(404, 'This business or draft no longer exists.');
      const draft = draftSnap.data(), schedule = draft.schedule || {};
      if (draft.uid && draft.uid !== uid) fail(403, 'This draft is not available.');
      if (draft.businessId && draft.businessId !== bizId) fail(403, 'This draft is not available.');
      if (!schedule.enabled || new Date(schedule.nextRunAt).getTime() !== cycleTs) fail(409, 'This link belongs to an older schedule. Open the current draft from your dashboard.');
      return schedule;
    };
    try {
      if (req.method === 'GET') {
        // Email scanners may fetch this page. GET never writes or consumes the action.
        const [draftSnap,bizSnap] = await Promise.all([draftRef.get(),bizRef.get()]);
        validate(draftSnap,bizSnap);
        if (action === 'change') {
          return res.redirect(302, APP_BASE_URL + '/BlastyBiz.html?' + new URLSearchParams({bizId,draftId,ownerUid:uid}));
        }
        const names = {approve:'Approve this post',skip:'Skip this occurrence',pause:'Pause this business’s schedules'};
        return res.send(_actionHtmlPage('📋', 'Confirm your choice',
          'Nothing has changed yet. Tap the button to confirm.<form method="post"><input type="hidden" name="confirm" value="1"><button type="submit" style="margin-top:20px;padding:14px 20px;font-size:16px">' + names[action] + '</button></form>', dashUrl));
      }
      if (action === 'change' || req.body?.confirm !== '1') return errorPage(400, 'Use the confirmation button to perform this action.');
      const result = await db.runTransaction(async tx => {
        const [used,draftSnap,bizSnap,userSnap] = await Promise.all([tx.get(actionRef),tx.get(draftRef),tx.get(bizRef),tx.get(userRef)]);
        if (used.exists) return 'already';
        validate(draftSnap,bizSnap);
        if (!userSnap.exists) fail(404, 'This account no longer exists.');
        if (action === 'pause') tx.update(bizRef, { schedulingPaused: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        else tx.update(draftRef, {
          ...(action === 'approve' ? {'schedule.approved':true} : {'schedule.skipCycle':true}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.create(actionRef, { uid, bizId, draftId, action, cycle, usedAt: admin.firestore.FieldValue.serverTimestamp() });
        tx.update(userRef, {lastEmailEngagedAt:admin.firestore.FieldValue.serverTimestamp()});
        return action;
      });
      const messages = { already:'A choice from this preview was already saved. Open your dashboard to see its status.', approve:'Approval saved for this scheduled occurrence.', skip:'This occurrence will be skipped.', pause:'Scheduling is paused for this business.' };
      return res.send(_actionHtmlPage('✓', 'Choice saved', messages[result], dashUrl));
    } catch(e) {
      console.error('[draftAction]', e.message);
      return errorPage(e.httpStatus || 500, e.httpStatus ? e.message : 'Your choice could not be saved. Please retry.');
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
