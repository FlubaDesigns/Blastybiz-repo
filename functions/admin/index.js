'use strict';
const axios = require('axios');
const { onRequest } = require('firebase-functions/v2/https');

const { db, admin, userBizRef, userBizCol, userBizConnsRef, userBizJobsRef } = require('../lib/db');
const { withAuth, requireAdmin, setCors, BOOTSTRAP_ADMIN_EMAILS }            = require('../lib/auth');
const { sendResendEmail }   = require('../lib/email');
const { makeUnsubSig, _unsubSecret } = require('../lib/unsub');
const { fetchAndCacheYelpCategories } = require('../lib/yelp');
const { _publishGoogleJob, _publishFacebookJob, _publishInstagramJob } = require('../lib/publishers');
const { APP_BASE_URL }      = require('../lib/config');
const { getSquare }         = require('../lib/square');
const { getPlanConfig }     = require('../lib/plans');

// Step labels keyed by 0-based index, matching STEPS array in BlastyBiz-Onboard2.html
const ONBOARDING_STEP_LABELS = [
  'Your name', 'Business name', 'Your title', 'Business email', 'Phone number',
  'Location type', 'Street address', 'City', 'State', 'ZIP code', 'Website',
  'Story or blast?', 'Business story', 'What makes you different', 'Awards & press',
  'Ideal customer', 'Anything else?', 'Campaign name', 'Campaign about',
  'Campaign audience', 'Special offer', 'Platforms', 'AI category',
];

// ══════════════════════════════════════════
// adminListPublishJobs
// ══════════════════════════════════════════
exports.adminListPublishJobs = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { status, limit: lim = '100' } = req.query;
  const cap = Math.min(Number(lim) || 100, 500);
  let snap;
  if (status) {
    snap = await db.collectionGroup('publishJobs').where('status', '==', status).limit(cap).get();
  } else {
    snap = await db.collectionGroup('publishJobs').orderBy('createdAt', 'desc').limit(cap).get();
  }
  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  jobs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  res.json({ jobs });
}, { admin: true }));

// ══════════════════════════════════════════
// adminListFailedJobs
// ══════════════════════════════════════════
exports.adminListFailedJobs = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const snap = await db.collectionGroup('publishJobs')
    .where('status', 'in', ['failed', 'manual_required', 'manual_followup']).limit(100).get();
  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  jobs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  res.json({ jobs });
}, { admin: true }));

// ══════════════════════════════════════════
// adminRetryJob
// ══════════════════════════════════════════
exports.adminRetryJob = onRequest({ invoker: 'public', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }, withAuth(async (req, res, decoded) => {
  const { jobId, uid: jobUid, businessId: jobBizId, force } = req.body;
  if (!jobId)   return res.status(400).json({ error: 'jobId required' });
  if (!jobUid || !jobBizId) return res.status(400).json({ error: 'uid and businessId required' });

  const jobRef  = userBizJobsRef(jobUid, jobBizId).doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) return res.status(404).json({ error: 'Job not found' });
  const job = { ...jobSnap.data(), id: jobId };

  const currentAttempts = job.attempts || 0;
  const maxAttempts     = job.maxAttempts || 3;
  if (currentAttempts >= maxAttempts && !force) {
    return res.status(400).json({
      error: `Job has exceeded maxAttempts (${currentAttempts}/${maxAttempts}). Pass force: true to override.`,
    });
  }
  if (force && currentAttempts >= maxAttempts) {
    try {
      await db.collection('activityLogs').add({
        type: 'admin_force_retry', adminEmail: decoded?.email || 'unknown',
        jobId, uid: jobUid, businessId: jobBizId, platform: job.platform,
        previousAttempts: currentAttempts, maxAttempts,
        forcedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch(e) { console.warn('[adminRetryJob] activity log write failed:', e.message); }
  }

  await jobRef.update({
    status: 'processing',
    attempts: admin.firestore.FieldValue.increment(1),
    adminError: '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    const { _getConnTokens } = require('../lib/db');
    const connSnap = await userBizConnsRef(job.uid, job.businessId).doc(job.platform).get();
    if (!connSnap.exists || connSnap.data().status !== 'connected') {
      await jobRef.update({ status: 'failed', adminError: `No connected ${job.platform} account for business ${job.businessId}`, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return res.status(400).json({ error: 'Platform not connected' });
    }
    const tokens = await _getConnTokens(connSnap.ref);
    const conn   = { ...connSnap.data(), ...tokens };
    let result;
    switch (job.platform) {
      case 'google':    result = await _publishGoogleJob(job, conn);    break;
      case 'facebook':  result = await _publishFacebookJob(job, conn);  break;
      case 'instagram': result = await _publishInstagramJob(job, conn); break;
      default:
        await jobRef.update({
          status: 'manual_required',
          adminError: `No automated publisher for platform: ${job.platform}`,
          customerVisibleMessage: `Your AI-written copy for ${job.platform} is ready — this platform requires manual posting.`,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return res.status(200).json({ status: 'manual_required', platform: job.platform });
    }
    await jobRef.update({
      status: 'success', apiResponse: result,
      customerLabel: 'Published', customerVisibleMessage: `Your listing is live on ${job.platform}.`,
      publishedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch(e) {
    console.error(`adminRetryJob [${jobId}] failed:`, e.message);
    await jobRef.update({
      status: 'failed', adminError: e.message,
      customerVisibleMessage: `Retry failed for ${job.platform}. Check connection tokens.`,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ══════════════════════════════════════════
// adminMarkManualFollowup
// ══════════════════════════════════════════
exports.adminMarkManualFollowup = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { jobId, uid: jobUid, businessId: jobBizId } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  if (!jobUid || !jobBizId) return res.status(400).json({ error: 'uid and businessId required' });
  await userBizJobsRef(jobUid, jobBizId).doc(jobId).update({
    status: 'manual_followup',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ success: true });
}, { admin: true }));

// ══════════════════════════════════════════
// adminListBusinesses
// ══════════════════════════════════════════
exports.adminListBusinesses = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const snap = await db.collectionGroup('businesses').orderBy('createdAt', 'desc').limit(200).get();
  res.json({ businesses: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
}, { admin: true }));

// ══════════════════════════════════════════
// adminListPlatformConnections
// ══════════════════════════════════════════
exports.adminListPlatformConnections = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const snap  = await db.collectionGroup('platformConnections').limit(200).get();
  const conns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  conns.sort((a, b) => (b.connectedAt?.toMillis?.() || 0) - (a.connectedAt?.toMillis?.() || 0));
  res.json({ connections: conns });
}, { admin: true }));

// ══════════════════════════════════════════
// adminPlatformHealth
// ══════════════════════════════════════════
exports.adminPlatformHealth = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const snap   = await db.collectionGroup('platformConnections').limit(500).get();
  const counts = { connected: 0, expired: 0, disconnected: 0, other: 0 };
  const broken = [];

  snap.docs.forEach(d => {
    const c = { id: d.id, ...d.data() };
    const s = c.status || 'unknown';
    if (s === 'connected') { counts.connected++; return; }
    if (s === 'expired' || s === 'error') counts.expired++;
    else if (s === 'disconnected') counts.disconnected++;
    else counts.other++;
    broken.push(c);
  });

  await Promise.all(broken.map(async c => {
    if (!c.businessId || !c.uid) return;
    try {
      const s = await userBizRef(c.uid, c.businessId).get();
      if (s.exists) c._businessName = s.data().businessName || c.businessId;
    } catch(e) { /* non-fatal */ }
  }));

  const now    = Date.now();
  const result = broken.map(c => {
    const expiresAt = c.expiresAt ? (c.expiresAt.toDate ? c.expiresAt.toDate() : new Date(c.expiresAt)) : null;
    const daysSinceExpired = expiresAt ? Math.floor((now - expiresAt.getTime()) / 86400000) : null;
    return {
      id: c.id, businessId: c.businessId || '',
      businessName: c._businessName || '—', uid: c.uid || '',
      platform: c.platform || 'unknown', status: c.status || 'unknown',
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      daysSinceExpired,
      connectedAt: c.connectedAt ? (c.connectedAt.toDate ? c.connectedAt.toDate().toISOString() : new Date(c.connectedAt).toISOString()) : null,
    };
  }).sort((a, b) => (b.daysSinceExpired || 0) - (a.daysSinceExpired || 0));

  res.json({ counts, broken: result });
}, { admin: true }));

// ══════════════════════════════════════════
// adminSendReconnectNudge
// ══════════════════════════════════════════
exports.adminSendReconnectNudge = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] }, withAuth(async (req, res) => {
  const { uid: nudgeUid, bizId: nudgeBizId, platform: nudgePlatform } = req.body;
  if (!nudgeUid || !nudgeBizId || !nudgePlatform) return res.status(400).json({ error: 'uid, bizId, and platform required' });

  const connSnap = await userBizConnsRef(nudgeUid, nudgeBizId).doc(nudgePlatform).get();
  if (!connSnap.exists) return res.status(404).json({ error: 'Connection not found' });
  const conn = connSnap.data();
  if (!conn.uid) return res.status(400).json({ error: 'Connection has no uid' });

  const userSnap = await db.collection('users').doc(conn.uid).get();
  if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
  const userData = userSnap.data();
  if (!userData.email)            return res.status(400).json({ error: 'User has no email' });
  if (userData.emailUnsubscribed) return res.status(400).json({ error: 'User is unsubscribed' });

  let businessName = '';
  if (conn.businessId && conn.uid) {
    try {
      const bizSnap = await userBizRef(conn.uid, conn.businessId).get();
      businessName = bizSnap.data()?.businessName || '';
    } catch(e) { /* non-fatal */ }
  }

  const ownerName       = userData.ownerName || userData.displayName || 'there';
  const platformDisplay = conn.platform === 'google' ? 'Google Business Profile'
    : (conn.platform || 'Platform').charAt(0).toUpperCase() + (conn.platform || 'Platform').slice(1);
  const connectUrl = `${APP_BASE_URL}/BlastyBiz-Connect.html`;
  const unsubUrl   = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(conn.uid)}&sig=${makeUnsubSig(conn.uid, process.env.RESEND_API_KEY)}`;
  const bizLabel   = businessName || (ownerName !== 'there' ? ownerName + "'s Business" : 'your business');

  const subject = `Action needed — your ${platformDisplay} connection expired`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Your ${platformDisplay} connection needs a quick reconnect, ${ownerName}.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">Your <strong>${platformDisplay}</strong> authorization for <strong>${bizLabel}</strong> has expired. Auto-posting to ${platformDisplay} is paused until you reconnect.</p>
    <a href="${connectUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Reconnect ${platformDisplay} &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

  await sendResendEmail({ to: userData.email, subject, html });
  await userBizConnsRef(nudgeUid, nudgeBizId).doc(nudgePlatform).update({
    lastNudgeSentAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ success: true, sentTo: userData.email });
}, { admin: true }));

// ══════════════════════════════════════════
// adminSendRecoveryEmails
// ══════════════════════════════════════════
exports.adminSendRecoveryEmails = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] }, withAuth(async (req, res) => {
  try {
    const bizSnap = await db.collectionGroup('businesses').where('subscriptionStatus', '==', 'past_due').get();
    const results = [];
    for (const bizDoc of bizSnap.docs) {
      const biz = bizDoc.data();
      const uid = biz.uid;
      if (!uid) { results.push({ bizId: bizDoc.id, sent: false, reason: 'no uid on business doc' }); continue; }
      const userSnap = await db.collection('users').doc(uid).get();
      const userData = userSnap.exists ? userSnap.data() : null;
      if (!userData || !userData.email) { results.push({ bizId: bizDoc.id, sent: false, reason: 'no user email' }); continue; }
      if (userData.emailUnsubscribed)   { results.push({ bizId: bizDoc.id, sent: false, reason: 'unsubscribed' }); continue; }

      const ownerName    = userData.ownerName || userData.displayName || 'there';
      const bizLabel     = biz.businessName || 'your business';
      const dashboardUrl = APP_BASE_URL + '/BlastyBiz-Dashboard.html#billing';
      const unsubUrl     = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, _unsubSecret())}`;

      const subject = `Payment failed for ${bizLabel} — update your card to avoid downgrade`;
      const html    = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hi ${ownerName}, your last payment for ${bizLabel} didn't go through.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">Update your payment method to keep your plan active and avoid being downgraded to Starter.</p>
    <a href="${dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Update payment method &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;
      await sendResendEmail({ to: userData.email, subject, html });
      results.push({ bizId: bizDoc.id, sent: true, to: userData.email });
    }
    res.json({ success: true, sentCount: results.filter(r => r.sent).length, results });
  } catch(e) {
    console.error('[adminSendRecoveryEmails]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
}, { admin: true }));

// ══════════════════════════════════════════
// adminGetAdminEmails / adminUpdateAdminEmails
// ══════════════════════════════════════════
exports.adminGetAdminEmails = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const snap  = await db.collection('config').doc('admins').get();
  const extra = snap.exists ? (snap.data().emails || []) : [];
  res.json({ bootstrap: BOOTSTRAP_ADMIN_EMAILS, extra });
}, { admin: true }));

exports.adminUpdateAdminEmails = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { emails } = req.body || {};
  if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails must be an array' });
  const valid = emails.filter(e => typeof e === 'string' && e.includes('@'));
  await db.collection('config').doc('admins').set({ emails: valid, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  res.json({ success: true, emails: valid });
}, { admin: true }));

// ══════════════════════════════════════════
// adminListActivityLogs
// ══════════════════════════════════════════
exports.adminListActivityLogs = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { uid } = req.query;
  const col = db.collection('activityLogs');
  const q = uid
    ? col.where('uid', '==', uid).orderBy('createdAt', 'desc').limit(100)
    : col.orderBy('createdAt', 'desc').limit(100);
  const snap = await q.get();
  res.json({ logs: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
}, { admin: true }));

// ══════════════════════════════════════════
// adminOnboardingFunnel
// ══════════════════════════════════════════
exports.adminOnboardingFunnel = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const snap = await db.collection('users').where('onboarded', '==', false).limit(500).get();
  if (req.query.stepIndex !== undefined) {
    const stepIndex = parseInt(req.query.stepIndex, 10);
    if (isNaN(stepIndex)) return res.status(400).json({ error: 'Invalid stepIndex' });
    const users = [];
    snap.docs.forEach(d => {
      const data = d.data();
      const progress = data.onboardingProgress;
      if (!progress || progress.stepIndex == null) return;
      if (Number(progress.stepIndex) !== stepIndex) return;
      users.push({
        uid: d.id, email: data.email || '',
        createdAt:      data.createdAt?.toDate?.()?.toISOString()     || null,
        lastProgressAt: (progress.savedAt?.toDate?.() || progress.updatedAt?.toDate?.())?.toISOString() || null,
        nudgeCount:     data.nudgeCount || 0,
        lastNudgeAt:    data.lastNudgeAt?.toDate?.()?.toISOString()   || null,
      });
    });
    return res.json({ stepIndex, label: ONBOARDING_STEP_LABELS[stepIndex] || `Step ${stepIndex + 1}`, users });
  }
  const counts = {};
  let totalStuck = 0;
  snap.docs.forEach(d => {
    const data = d.data();
    const progress = data.onboardingProgress;
    if (!progress || progress.stepIndex == null) return;
    const idx = Number(progress.stepIndex);
    if (isNaN(idx)) return;
    counts[idx] = (counts[idx] || 0) + 1;
    totalStuck++;
  });
  const steps = Object.entries(counts)
    .map(([idx, count]) => { const i = parseInt(idx, 10); return { stepIndex: i, label: ONBOARDING_STEP_LABELS[i] || `Step ${i + 1}`, count }; })
    .sort((a, b) => b.count - a.count || a.stepIndex - b.stepIndex);
  res.json({ steps, totalStuck, totalNotOnboarded: snap.size, asOf: new Date().toISOString() });
}, { admin: true }));

// ══════════════════════════════════════════
// adminSendOnboardingNudge
// ══════════════════════════════════════════
exports.adminSendOnboardingNudge = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { uid } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'uid is required' });
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
  const data = userDoc.data();
  if (!data.email) return res.status(400).json({ error: 'User has no email address on record' });
  const stepIndex = data.onboardingProgress?.stepIndex ?? null;
  const stepLabel = stepIndex != null ? (ONBOARDING_STEP_LABELS[stepIndex] || `Step ${stepIndex + 1}`) : 'your profile';
  const safeLabel = String(stepLabel).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  await sendResendEmail({
    to: data.email,
    subject: 'Your BlastyBiz setup is almost done \uD83D\uDE80',
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
      <h2 style="margin:0 0 12px;">You're almost there!</h2>
      <p style="margin:0 0 16px;line-height:1.6;color:#444;">You started setting up your BlastyBiz account but got stuck on <strong>${safeLabel}</strong>. It only takes a few minutes to finish — and once you're done, you'll have AI-powered marketing working for your business.</p>
      <a href="${APP_BASE_URL}/BlastyBiz-Onboard2.html" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Continue Setup →</a>
      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">BlastyBiz · <a href="${APP_BASE_URL}/BlastyBiz-Home.html" style="color:#9ca3af;">blastybiz.com</a></p>
    </div>`,
  });
  await db.collection('users').doc(uid).update({
    lastNudgeAt: admin.firestore.FieldValue.serverTimestamp(),
    nudgeCount:  admin.firestore.FieldValue.increment(1),
  });
  res.json({ ok: true, sentTo: data.email });
}, { admin: true }));

// ══════════════════════════════════════════
// adminSubscriptionSummary
// ══════════════════════════════════════════
exports.adminSubscriptionSummary = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const [usersSnap, subsSnap] = await Promise.all([
    db.collection('users').limit(5000).get(),
    db.collection('subscriptions').limit(5000).get(),
  ]);
  const planCounts = { starter: 0, pro: 0, agency: 0 };
  usersSnap.docs.forEach(d => {
    const data = d.data();
    const p = data.plan || 'starter';
    if (p !== 'starter' && data.planActive !== true) return;
    planCounts[p] = (planCounts[p] || 0) + 1;
  });
  const pricingSnap  = await db.collection('settings').doc('pricing').get();
  const pricingData  = pricingSnap.exists ? pricingSnap.data() : {};
  const MRR_PRICES   = { starter: 0, pro: pricingData.proMonthly || 49, agency: pricingData.agencyMonthly || 149 };
  const mrr          = Object.entries(planCounts).reduce((sum, [plan, count]) => sum + (MRR_PRICES[plan] || 0) * count, 0);
  res.json({ planCounts, mrr, totalUsers: usersSnap.size, totalSubscriptions: subsSnap.size, asOf: new Date().toISOString() });
}, { admin: true }));

// ══════════════════════════════════════════
// sendTestEmail  (admin only)
// ══════════════════════════════════════════
exports.sendTestEmail = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, withAuth(async (req, res) => {
  const { to, subject: rawSubject, html: rawHtml } = req.body;
  if (!to || !rawSubject || !rawHtml) return res.status(400).json({ error: 'to, subject, and html are required' });
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 'placeholder') return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  const SAMPLE = {
    name: 'Alex Johnson', businessName: 'Sunrise Café', planName: 'Pro',
    platform: 'Google Business', jobCount: '5', platformList: 'Google Business, Facebook, Instagram',
    dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
    upgradeUrl:   APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
    appUrl:       APP_BASE_URL,
  };
  function applyTags(str) { return str.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE[k] ?? ''); }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'BlastyBiz <info@blastybiz.com>', to: [to], subject: '[TEST] ' + applyTags(rawSubject), html: applyTags(rawHtml) }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || 'Resend error', detail: data });
    return res.json({ ok: true, id: data.id, to });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ══════════════════════════════════════════
// refreshYelpCategories  (admin only)
// ══════════════════════════════════════════
exports.refreshYelpCategories = onRequest(
  { invoker: 'public', region: 'us-central1', secrets: ['YELP_API_KEY'] },
  async (req, res) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
    try {
      const cats = await fetchAndCacheYelpCategories();
      res.json({ ok: true, count: cats.length });
    } catch(e) {
      console.error('[refreshYelpCategories]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ══════════════════════════════════════════
// adminSetPlan — override any user's plan (admin only)
// ══════════════════════════════════════════
exports.adminSetPlan = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { uid: targetUid, plan, billingPeriod = 'monthly' } = req.body || {};
  if (!targetUid || !plan) return res.status(400).json({ error: 'uid and plan required' });
  const VALID_PLANS = ['starter', 'trial', 'pro', 'agency'];
  if (!VALID_PLANS.includes(plan)) return res.status(400).json({ error: `plan must be one of: ${VALID_PLANS.join(', ')}` });
  const planActive = plan !== 'starter' && plan !== 'trial';
  await db.collection('users').doc(targetUid).update({ plan, planActive, billingPeriod, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  const bizSnaps = await userBizCol(targetUid).get();
  for (const biz of bizSnaps.docs) {
    await biz.ref.update({ currentPlan: plan, subscriptionStatus: planActive ? 'active' : 'canceled' });
  }
  res.json({ ok: true, uid: targetUid, plan, planActive });
}, { admin: true }));

// ══════════════════════════════════════════
// adminDeleteBusiness — admin force-delete any business (admin only)
// ══════════════════════════════════════════
exports.adminDeleteBusiness = onRequest({ invoker: 'public' }, withAuth(async (req, res) => {
  const { uid: targetUid, bizId } = req.body || {};
  if (!targetUid || !bizId) return res.status(400).json({ error: 'uid and bizId required' });
  const bizRef = db.collection('users').doc(targetUid).collection('businesses').doc(bizId);
  const bizSnap = await bizRef.get();
  if (!bizSnap.exists) return res.status(404).json({ error: 'Business not found' });
  await db.recursiveDelete(bizRef);
  res.json({ ok: true });
}, { admin: true }));
