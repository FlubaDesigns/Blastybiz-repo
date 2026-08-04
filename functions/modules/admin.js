/**
 * BlastyBiz — Admin endpoints
 * adminListPublishJobs, adminListFailedJobs, adminRetryJob, adminMarkManualFollowup,
 * adminListBusinesses, adminListPlatformConnections, adminPlatformHealth,
 * adminSendReconnectNudge, adminSendRecoveryEmails, adminGetAdminEmails,
 * adminUpdateAdminEmails, adminListActivityLogs, adminOnboardingFunnel,
 * adminSendOnboardingNudge, adminSubscriptionSummary, adminSetPlan,
 * adminDeleteBusiness, adminUpdatePricing (imported from payments)
 */
'use strict';

const {
  onRequest, admin, db,
  APP_BASE_URL, sendResendEmail,
  userBizRef, userBizCol, userBizJobsRef, userBizConnsRef,
  _getConnTokens,
  withAuth, verifyBearer, setCors, requireAdmin,
  bbLog, BOOTSTRAP_ADMIN_EMAILS, getAdminEmails,
  JOB_STATUS, makeUnsubSig, _unsubSecret,
  getPlanConfig,
} = require('../lib/shared');

const { _publishGoogleJob, _publishFacebookJob, _publishInstagramJob } = require('./publishing');

// ── adminListPublishJobs ──────────────────────────────────────────────────────
exports.adminListPublishJobs = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { status, limit: rawLimit, platform, uid: filterUid } = req.query;
  const limit = Math.min(parseInt(rawLimit || '50'), 500);

  try {
    let q = db.collectionGroup('publishJobs').orderBy('createdAt', 'desc').limit(limit);
    if (status)    q = q.where('status', '==', status);
    if (platform)  q = q.where('platform', '==', platform);
    if (filterUid) q = q.where('uid', '==', filterUid);
    const snap = await q.get();
    const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ jobs });
  } catch(e) {
    console.error('[adminListPublishJobs]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminListFailedJobs ───────────────────────────────────────────────────────
exports.adminListFailedJobs = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { limit: rawLimit } = req.query;
  const limit = Math.min(parseInt(rawLimit || '50'), 500);
  try {
    const snap = await db.collectionGroup('publishJobs')
      .where('status', 'in', [JOB_STATUS.FAILED, JOB_STATUS.MANUAL_REQUIRED])
      .orderBy('createdAt', 'desc').limit(limit).get();
    const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ jobs });
  } catch(e) {
    console.error('[adminListFailedJobs]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminRetryJob ─────────────────────────────────────────────────────────────
exports.adminRetryJob = onRequest({ invoker: 'public', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }, withAuth(async (req, res) => {
  const { uid, businessId, jobId } = req.body;
  if (!uid || !businessId || !jobId) return res.status(400).json({ error: 'uid, businessId, jobId required' });
  try {
    const jobRef  = userBizJobsRef(uid, businessId).doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) return res.status(404).json({ error: 'Job not found' });
    const job = jobSnap.data();

    const connSnap = await userBizConnsRef(uid, businessId).doc(job.platform).get();
    if (!connSnap.exists || connSnap.data().status !== 'connected') {
      return res.status(400).json({ error: `No connected ${job.platform} account` });
    }

    const tokens = await _getConnTokens(connSnap.ref);
    const conn = { ...connSnap.data(), ...tokens };
    let result;
    switch (job.platform) {
      case 'google':    result = await _publishGoogleJob(job, conn);    break;
      case 'facebook':  result = await _publishFacebookJob(job, conn);  break;
      case 'instagram': result = await _publishInstagramJob(job, conn); break;
      default:
        await jobRef.update({ status: 'manual_required', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        return res.json({ ok: false, manual: true });
    }

    await jobRef.update({
      status: 'success', apiResponse: result,
      customerLabel: 'Published', customerVisibleMessage: `Your listing is live on ${job.platform}.`,
      publishedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true, result });
  } catch(e) {
    console.error('[adminRetryJob]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminMarkManualFollowup ───────────────────────────────────────────────────
exports.adminMarkManualFollowup = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { uid, businessId, jobId, note } = req.body;
  if (!uid || !businessId || !jobId) return res.status(400).json({ error: 'uid, businessId, jobId required' });
  try {
    await userBizJobsRef(uid, businessId).doc(jobId).update({
      status: JOB_STATUS.MANUAL_FOLLOWUP,
      adminNote: note || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminListBusinesses ───────────────────────────────────────────────────────
exports.adminListBusinesses = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { limit: rawLimit, uid: filterUid } = req.query;
  const limit = Math.min(parseInt(rawLimit || '100'), 500);
  try {
    let snap;
    if (filterUid) {
      snap = await db.collectionGroup('businesses')
        .where('uid', '==', filterUid)
        .limit(limit).get();
    } else {
      snap = await db.collectionGroup('businesses')
        .orderBy('createdAt', 'desc').limit(limit).get();
    }
    const businesses = snap.docs.map(d => ({ id: d.id, uid: d.data().uid, ...d.data() }));
    res.json({ businesses });
  } catch(e) {
    console.error('[adminListBusinesses]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminListPlatformConnections ──────────────────────────────────────────────
exports.adminListPlatformConnections = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { status: filterStatus, platform: filterPlatform } = req.query;
  try {
    let q = db.collectionGroup('platformConnections');
    if (filterStatus)   q = q.where('status', '==', filterStatus);
    if (filterPlatform) q = q.where('platform', '==', filterPlatform);
    const snap = await q.get();
    const connections = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ connections });
  } catch(e) {
    console.error('[adminListPlatformConnections]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminPlatformHealth ───────────────────────────────────────────────────────
exports.adminPlatformHealth = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  try {
    // Limit prevents timeout/runaway cost. At ~5 000+ connections replace with
    // per-platform aggregation counters written by OAuth triggers.
    const snap = await db.collectionGroup('platformConnections').limit(5000).get();
    const summary = {};
    snap.docs.forEach(d => {
      const { platform, status } = d.data();
      if (!summary[platform]) summary[platform] = { total: 0, connected: 0, expired: 0, disconnected: 0, other: 0 };
      summary[platform].total++;
      if (status === 'connected')    summary[platform].connected++;
      else if (status === 'expired') summary[platform].expired++;
      else if (status === 'disconnected') summary[platform].disconnected++;
      else                           summary[platform].other++;
    });
    const truncated = snap.size === 5000;
    res.json({ health: summary, totalConnections: snap.size, truncated });
  } catch(e) {
    console.error('[adminPlatformHealth]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminSendReconnectNudge ───────────────────────────────────────────────────
exports.adminSendReconnectNudge = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] }, withAuth(async (req, res) => {
  const { uid: targetUid, platform: targetPlatform, businessId: targetBizId } = req.body;
  if (!targetUid || !targetPlatform || !targetBizId) {
    return res.status(400).json({ error: 'uid, platform, businessId required' });
  }
  try {
    const userSnap = await db.collection('users').doc(targetUid).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const userData = userSnap.data();
    if (!userData.email || userData.emailUnsubscribed) {
      return res.status(400).json({ error: 'User has no email or has unsubscribed' });
    }
    const ownerName = userData.ownerName || userData.displayName || '';
    let businessName = '';
    try {
      const bizSnap = await userBizRef(targetUid, targetBizId).get();
      businessName = bizSnap.data()?.businessName || '';
    } catch(e) { /* non-fatal */ }
    const platformDisplay = targetPlatform.charAt(0).toUpperCase() + targetPlatform.slice(1);
    const connectUrl = `${APP_BASE_URL}/BlastyBiz-Connect.html`;
    const unsubUrl   = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(targetUid)}&sig=${makeUnsubSig(targetUid, _unsubSecret())}`;

    const mergeData = {
      name: ownerName || 'there',
      businessName: businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
      platform: platformDisplay,
      connectUrl,
      appUrl: APP_BASE_URL,
      unsubscribeUrl: unsubUrl,
    };
    function applyNudgeTags(str) {
      return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
    }

    let subject = `Hey ${mergeData.name} — your ${platformDisplay} connection needs a quick reconnect`;
    let html = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'reconnect-nudge').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) {
        const tmpl = tmplSnap.docs[0].data();
        subject = applyNudgeTags(tmpl.subject || subject);
        html    = applyNudgeTags(tmpl.html || '');
      }
    } catch(e) { console.error('[adminSendReconnectNudge] template fetch:', e.message); }

    if (!html) {
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hey ${mergeData.name} — quick reconnect needed.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">Your <strong>${platformDisplay}</strong> connection for <strong>${mergeData.businessName}</strong> has expired. Auto-posting is paused until you reconnect — it only takes a few seconds.</p>
    <a href="${connectUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Reconnect ${platformDisplay} &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px">Your content is saved — nothing was lost.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;
    }

    await sendResendEmail({ to: userData.email, subject, html });
    res.json({ ok: true, to: userData.email });
  } catch(e) {
    console.error('[adminSendReconnectNudge]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminSendRecoveryEmails ───────────────────────────────────────────────────
exports.adminSendRecoveryEmails = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] }, withAuth(async (req, res) => {
  const { dryRun = true } = req.body;
  try {
    const snap = await db.collection('users')
      .where('onboarded', '==', false).limit(100).get();
    const toNotify = snap.docs.filter(d => d.data().email && !d.data().emailUnsubscribed);
    if (dryRun) return res.json({ dryRun: true, count: toNotify.length });

    let sent = 0;
    for (const docSnap of toNotify) {
      const userData = docSnap.data();
      const uid = docSnap.id;
      const ownerName = userData.ownerName || userData.displayName || '';
      const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, _unsubSecret())}`;

      const mergeData = {
        name: ownerName || 'there',
        appUrl: APP_BASE_URL,
        dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
        unsubscribeUrl: unsubUrl,
      };
      function applyRecoveryTags(str) {
        return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
      }

      let subject = `${mergeData.name}, your BlastyBiz setup is waiting`;
      let html = null;
      try {
        const tmplSnap = await db.collection('emailTemplates')
          .where('type', '==', 'recovery').where('active', '==', true).limit(1).get();
        if (!tmplSnap.empty) {
          const tmpl = tmplSnap.docs[0].data();
          subject = applyRecoveryTags(tmpl.subject || subject);
          html    = applyRecoveryTags(tmpl.html || '');
        }
      } catch(e) { console.error('[adminSendRecoveryEmails] template fetch:', e.message); }

      if (!html) {
        html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hey ${mergeData.name} — your BlastyBiz setup is waiting.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">You started setting up BlastyBiz but didn't finish. Your account is saved — pick up right where you left off.</p>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Finish Setup &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;
      }

      await sendResendEmail({ to: userData.email, subject, html });
      sent++;
    }
    res.json({ ok: true, sent });
  } catch(e) {
    console.error('[adminSendRecoveryEmails]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminGetAdminEmails ───────────────────────────────────────────────────────
exports.adminGetAdminEmails = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  try {
    const snap = await db.collection('config').doc('admins').get();
    const extra = snap.exists ? (snap.data().emails || []) : [];
    res.json({ bootstrap: BOOTSTRAP_ADMIN_EMAILS, extra, all: [...new Set([...BOOTSTRAP_ADMIN_EMAILS, ...extra])] });
  } catch(e) {
    console.error('[adminGetAdminEmails]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminUpdateAdminEmails ────────────────────────────────────────────────────
exports.adminUpdateAdminEmails = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });
  const clean = emails.map(e => (e||'').trim().toLowerCase()).filter(e => e.includes('@'));
  try {
    await db.collection('config').doc('admins').set({ emails: clean }, { merge: true });
    res.json({ ok: true, emails: clean });
  } catch(e) {
    console.error('[adminUpdateAdminEmails]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminListActivityLogs ─────────────────────────────────────────────────────
exports.adminListActivityLogs = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { uid: filterUid, limit: rawLimit } = req.query;
  const limit = Math.min(parseInt(rawLimit || '100'), 1000);
  try {
    let q = db.collection('activityLogs').orderBy('timestamp', 'desc').limit(limit);
    if (filterUid) q = q.where('uid', '==', filterUid);
    const snap = await q.get();
    res.json({ logs: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch(e) {
    console.error('[adminListActivityLogs]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminOnboardingFunnel ─────────────────────────────────────────────────────
const ONBOARDING_STEP_LABELS = {
  step1: 'Account Created',
  step2: 'Email Verified',
  step3: 'Business Profile Filled',
  step4: 'Platforms Selected',
  step5: 'First Blast Generated',
  step6: 'First Post Approved',
  step7: 'Platform Connected',
  step8: 'Upgraded to Pro',
};

exports.adminOnboardingFunnel = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  try {
    // Limits prevent timeout/runaway cost. At ~2 000+ users replace with
    // scheduled aggregation counters (e.g. a nightly Cloud Function writing
    // funnel snapshots to Firestore) rather than live full-table scans.
    const usersSnap  = await db.collection('users').limit(2000).get();
    const bizSnap    = await db.collectionGroup('businesses').limit(2000).get();
    const draftsSnap = await db.collectionGroup('listingDrafts').where('status', '==', 'approved').limit(2000).get();
    const jobsSnap   = await db.collectionGroup('publishJobs').limit(5000).get();
    const connsSnap  = await db.collectionGroup('platformConnections').where('status', '==', 'connected').limit(2000).get();

    const totalUsers = usersSnap.size;
    const uidsWithBiz   = new Set(bizSnap.docs.map(d => d.data().uid));
    const uidsVerified  = new Set(usersSnap.docs.filter(d => d.data().emailVerified).map(d => d.id));
    const uidsApproved  = new Set(draftsSnap.docs.map(d => d.data().uid));
    const uidsPosted    = new Set(jobsSnap.docs.filter(d => d.data().status === 'success').map(d => d.data().uid));
    const uidsConnected = new Set(connsSnap.docs.map(d => d.data().uid));
    const uidsPro       = new Set(usersSnap.docs.filter(d => ['pro','agency'].includes(d.data().plan)).map(d => d.id));
    const uidsGenerated = new Set(jobsSnap.docs.map(d => d.data().uid));

    const funnel = [
      { step: 'step1', label: ONBOARDING_STEP_LABELS.step1, count: totalUsers },
      { step: 'step2', label: ONBOARDING_STEP_LABELS.step2, count: uidsVerified.size },
      { step: 'step3', label: ONBOARDING_STEP_LABELS.step3, count: uidsWithBiz.size },
      { step: 'step5', label: ONBOARDING_STEP_LABELS.step5, count: uidsGenerated.size },
      { step: 'step6', label: ONBOARDING_STEP_LABELS.step6, count: uidsApproved.size },
      { step: 'step7', label: ONBOARDING_STEP_LABELS.step7, count: uidsConnected.size },
      { step: 'step8', label: ONBOARDING_STEP_LABELS.step8, count: uidsPro.size },
    ].map((s, i, arr) => ({
      ...s,
      pctOfPrev: i === 0 ? 100 : (arr[i-1].count > 0 ? Math.round(s.count / arr[i-1].count * 100) : 0),
      pctOfTotal: totalUsers > 0 ? Math.round(s.count / totalUsers * 100) : 0,
    }));

    res.json({ funnel, totalUsers });
  } catch(e) {
    console.error('[adminOnboardingFunnel]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminSendOnboardingNudge ──────────────────────────────────────────────────
exports.adminSendOnboardingNudge = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] }, withAuth(async (req, res) => {
  const { targetUid, templateType, nudgeContext } = req.body;
  if (!targetUid || !templateType) return res.status(400).json({ error: 'targetUid and templateType required' });

  const VALID_TYPES = ['setup-reminder', 'first-blast-nudge', 'connect-platform-nudge', 'upgrade-nudge'];
  if (!VALID_TYPES.includes(templateType)) {
    return res.status(400).json({ error: `templateType must be one of: ${VALID_TYPES.join(', ')}` });
  }

  try {
    const userSnap = await db.collection('users').doc(targetUid).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const userData = userSnap.data();
    if (!userData.email || userData.emailUnsubscribed) {
      return res.status(400).json({ error: 'User has no email or has unsubscribed' });
    }

    const ownerName = userData.ownerName || userData.displayName || '';
    let businessName = '';
    if (nudgeContext?.businessId) {
      try {
        const bizSnap = await userBizRef(targetUid, nudgeContext.businessId).get();
        businessName = bizSnap.data()?.businessName || '';
      } catch(e) { /* non-fatal */ }
    }

    const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(targetUid)}&sig=${makeUnsubSig(targetUid, _unsubSecret())}`;
    const mergeData = {
      name: ownerName || 'there',
      businessName: businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
      dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
      upgradeUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
      connectUrl: APP_BASE_URL + '/BlastyBiz-Connect.html',
      appUrl: APP_BASE_URL,
      unsubscribeUrl: unsubUrl,
    };
    function applyOnboardingTags(str) {
      return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
    }

    const FALLBACKS = {
      'setup-reminder':         { subject: `${mergeData.name}, your BlastyBiz setup is waiting`, body: 'You started setting up BlastyBiz but didn\'t finish. Pick up where you left off.', cta: 'Finish Setup', ctaUrl: mergeData.dashboardUrl },
      'first-blast-nudge':      { subject: `Time to blast, ${mergeData.name} 🔥`, body: 'Your business profile is ready — generate your first AI-written posts and push them live.', cta: 'Generate First Blast', ctaUrl: mergeData.dashboardUrl },
      'connect-platform-nudge': { subject: `Connect your first platform, ${mergeData.name} ⚡`, body: 'Connecting your Google Business Profile or Facebook Page lets BlastyBiz publish automatically.', cta: 'Connect Platforms', ctaUrl: mergeData.connectUrl },
      'upgrade-nudge':          { subject: `Unlock auto-publishing, ${mergeData.name} 🚀`, body: 'Upgrade to BlastyBiz Pro to publish to all platforms automatically — no copy-paste required.', cta: 'Upgrade to Pro', ctaUrl: mergeData.upgradeUrl },
    };
    const fb = FALLBACKS[templateType];
    let subject = fb.subject;
    let html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">${fb.body}</p>
    <a href="${fb.ctaUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">${fb.cta} &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', templateType).where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) {
        const tmpl = tmplSnap.docs[0].data();
        subject = applyOnboardingTags(tmpl.subject || subject);
        html    = applyOnboardingTags(tmpl.html || html);
      }
    } catch(e) { console.error('[adminSendOnboardingNudge] template fetch:', e.message); }

    await sendResendEmail({ to: userData.email, subject, html });
    res.json({ ok: true, to: userData.email, templateType });
  } catch(e) {
    console.error('[adminSendOnboardingNudge]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminSubscriptionSummary ──────────────────────────────────────────────────
exports.adminSubscriptionSummary = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  try {
    // Limits prevent timeout/runaway cost. At ~2 000+ users replace with
    // plan-counter aggregation (increment/decrement on plan changes).
    const [usersSnap, subsSnap] = await Promise.all([
      db.collection('users').limit(2000).get(),
      db.collection('subscriptions').limit(2000).get(),
    ]);
    const planCounts = { starter: 0, trial: 0, pro: 0, agency: 0, other: 0 };
    usersSnap.docs.forEach(d => {
      const plan = d.data().plan || 'starter';
      planCounts[plan] = (planCounts[plan] || 0) + 1;
    });
    const activeSubs = subsSnap.docs.filter(d => d.data().status === 'active').length;
    const canceledSubs = subsSnap.docs.filter(d => d.data().status === 'canceled').length;
    res.json({ planCounts, totalUsers: usersSnap.size, activeSubs, canceledSubs });
  } catch(e) {
    console.error('[adminSubscriptionSummary]', e.message);
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ── adminSetPlan ──────────────────────────────────────────────────────────────
exports.adminSetPlan = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  try { await requireAdmin(req); } catch(e) { return res.status(403).json({ error: e.message }); }

  const { uid: targetUid, plan } = req.body;
  if (!targetUid || !plan) return res.status(400).json({ error: 'uid and plan required' });
  if (!['starter', 'trial', 'pro', 'agency'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  try {
    const bizSnap = await userBizCol(targetUid).get();
    const batch   = db.batch();
    batch.set(db.collection('users').doc(targetUid), { plan, planActive: plan !== 'starter' }, { merge: true });
    bizSnap.docs.forEach(biz =>
      batch.update(biz.ref, { currentPlan: plan, subscriptionStatus: plan !== 'starter' ? 'active' : 'none' })
    );
    await batch.commit();
    console.log(`[adminSetPlan] ${targetUid} → ${plan}`);
    res.json({ ok: true, uid: targetUid, plan });
  } catch(e) {
    console.error('[adminSetPlan]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── adminDeleteBusiness ───────────────────────────────────────────────────────
exports.adminDeleteBusiness = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  try { await requireAdmin(req); } catch(e) { return res.status(403).json({ error: e.message }); }

  const { uid: targetUid, bizId } = req.body;
  if (!targetUid || !bizId) return res.status(400).json({ error: 'uid and bizId required' });
  try {
    const bizRef = userBizRef(targetUid, bizId);
    const bizSnap = await bizRef.get();
    if (!bizSnap.exists) return res.status(404).json({ error: 'Business not found' });
    await db.recursiveDelete(bizRef);
    console.log(`[adminDeleteBusiness] deleted ${bizId} for uid ${targetUid}`);
    res.json({ ok: true });
  } catch(e) {
    console.error('[adminDeleteBusiness]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── adminUpdatePlatformCategories — manual paste-in for any platform's category list ──
// Accepts { platformId, categories } where categories is an array of { alias, title, parentAliases }.
// Writes to platformCategories/{platformId}/categories/{alias}.
// For yelp, also mirrors to the top-level yelpCategories collection for backward compat.
exports.adminUpdatePlatformCategories = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try { await requireAdmin(req); } catch(e) { return res.status(403).json({ error: e.message }); }

  const { platformId, categories } = req.body || {};
  if (!platformId) return res.status(400).json({ error: 'platformId is required' });
  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'categories must be a non-empty array' });
  }

  const normalized = categories.map(c => ({
    alias:         c.alias,
    title:         c.title,
    parentAliases: c.parentAliases || c.parent_aliases || [],
  })).filter(c => c.alias && c.title);

  const CHUNK = 450;

  // Write to platformCategories/{platformId}/categories/{alias}
  for (let i = 0; i < normalized.length; i += CHUNK) {
    const batch = db.batch();
    for (const cat of normalized.slice(i, i + CHUNK)) {
      batch.set(
        db.collection('platformCategories').doc(platformId).collection('categories').doc(cat.alias),
        cat
      );
    }
    await batch.commit();
  }
  await db.collection('platformCategories').doc(platformId).set({
    platformId, count: normalized.length,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: 'manual',
  }, { merge: true });

  // Yelp backward compat: also mirror to top-level yelpCategories collection
  if (platformId === 'yelp') {
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const batch = db.batch();
      for (const cat of normalized.slice(i, i + CHUNK)) {
        batch.set(db.collection('yelpCategories').doc(cat.alias), cat);
      }
      await batch.commit();
    }
    await db.collection('config').doc('yelpCategoriesMeta').set({
      count: normalized.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: 'manual',
    }, { merge: true });
  }

  res.json({ ok: true, platformId, count: normalized.length });
}, { admin: true }));

