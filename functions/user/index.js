'use strict';
const crypto = require('crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');

const { db, admin, userBizRef, userBizCol, userBizDraftsRef, userBizJobsRef, userBizPostsRef, userBizConnsRef } = require('../lib/db');
const { setCors, withAuth } = require('../lib/auth');
const { sendResendEmail }   = require('../lib/email');
const { makeUnsubSig, _unsubSecret } = require('../lib/unsub');
const { getPlanConfig }     = require('../lib/plans');
const { getSquare }         = require('../lib/square');
const { APP_BASE_URL }      = require('../lib/config');

// ══════════════════════════════════════════
// createBusiness — server-enforced plan limits + atomic write
// POST /createBusiness
// ══════════════════════════════════════════
exports.createBusiness = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const uid = decoded.uid;
  const { profileData, isNew } = req.body || {};
  if (!profileData || typeof profileData !== 'object') return res.status(400).json({ error: 'Missing profileData' });

  const planCfg = await getPlanConfig();
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const plan = userData.plan || 'starter';
    const cap  = planCfg.bizLimits[plan] ?? 1;

    let dedupedBizId = null;
    if (isNew && profileData.businessName && profileData.address) {
      const existingSnap = await userBizCol(uid)
        .where('businessName', '==', profileData.businessName)
        .where('address', '==', profileData.address)
        .limit(1).get();
      if (!existingSnap.empty) dedupedBizId = existingSnap.docs[0].id;
    }
    const treatAsNew = isNew && !dedupedBizId;
    if (treatAsNew) {
      const bizSnap = await userBizCol(uid).where('onboarded', '==', true).get();
      if (bizSnap.size >= cap) {
        return res.status(403).json({ error: 'Business limit reached', plan, cap, used: bizSnap.size });
      }
    }
    const bizRef = treatAsNew
      ? userBizCol(uid).doc()
      : userBizRef(uid, dedupedBizId || userData.activeBusiness || uid);
    const { updatedAt: _d1, createdAt: _d2, ...cleanData } = profileData;
    const batch = db.batch();
    batch.set(bizRef, {
      ...cleanData, uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.collection('users').doc(uid), {
      onboarded: true,
      activeBusiness: bizRef.id,
      businessIds: admin.firestore.FieldValue.arrayUnion(bizRef.id),
    }, { merge: true });
    await batch.commit();
    return res.json({ success: true, bizId: bizRef.id });
  } catch(e) {
    console.error('[createBusiness]', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
}));

// ══════════════════════════════════════════
// deleteBusiness — recursive server-side deletion
// POST /deleteBusiness
// ══════════════════════════════════════════
exports.deleteBusiness = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const uid   = decoded.uid;
  const { bizId } = req.body || {};
  if (!bizId) return res.status(400).json({ error: 'Missing bizId' });
  try {
    const bizRef  = db.collection('users').doc(uid).collection('businesses').doc(bizId);
    const bizSnap = await bizRef.get();
    if (!bizSnap.exists) return res.status(404).json({ error: 'Business not found' });
    await db.recursiveDelete(bizRef);
    return res.json({ success: true });
  } catch(e) {
    console.error('[deleteBusiness]', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
}));

// ══════════════════════════════════════════
// deleteAccount — cancel Square sub, wipe all Firestore data, delete Auth user
// POST /deleteAccount { idToken }
// ══════════════════════════════════════════
exports.deleteAccount = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_ACCESS_TOKEN'] }, async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });
  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }

  try {
    const subSnap = await db.collection('subscriptions').doc(uid).get();
    if (subSnap.exists) {
      const { squareSubscriptionId } = subSnap.data();
      if (squareSubscriptionId) {
        try { await getSquare().subscriptions.cancel({ subscriptionId: squareSubscriptionId }); } catch(_) {}
      }
    }

    const [bizSnap, activitySnap] = await Promise.all([
      userBizCol(uid).get(),
      db.collection('activityLogs').where('uid', '==', uid).get(),
    ]);

    const bizSubRefs = [];
    for (const bizDoc of bizSnap.docs) {
      const bizId = bizDoc.id;
      const [draftsSnap, jobsSnap, connsSnap, pendingSnap, libSnap,
             bizFactsSnap, bizImagesSnap] = await Promise.all([
        userBizDraftsRef(uid, bizId).get(),
        userBizJobsRef(uid, bizId).get(),
        userBizConnsRef(uid, bizId).get(),
        userBizPostsRef(uid, bizId).get(),
        userBizRef(uid, bizId).collection('documents').get(),
        userBizRef(uid, bizId).collection('facts').get(),
        userBizRef(uid, bizId).collection('images').get(),
      ]);
      [draftsSnap, jobsSnap, connsSnap, pendingSnap, libSnap, bizFactsSnap, bizImagesSnap]
        .forEach(snap => snap.docs.forEach(d => bizSubRefs.push(d.ref)));

      const campSnap = await userBizRef(uid, bizId).collection('campaigns').get();
      for (const campDoc of campSnap.docs) {
        const campId = campDoc.id;
        const [cFacts, cImages, cDocs, cCopy, cAds] = await Promise.all([
          userBizRef(uid, bizId).collection('campaigns').doc(campId).collection('facts').get(),
          userBizRef(uid, bizId).collection('campaigns').doc(campId).collection('images').get(),
          userBizRef(uid, bizId).collection('campaigns').doc(campId).collection('documents').get(),
          userBizRef(uid, bizId).collection('campaigns').doc(campId).collection('copy').get(),
          userBizRef(uid, bizId).collection('campaigns').doc(campId).collection('advertising').get(),
        ]);
        [cFacts, cImages, cDocs, cCopy, cAds].forEach(snap => snap.docs.forEach(d => bizSubRefs.push(d.ref)));
        bizSubRefs.push(campDoc.ref);
      }
    }

    const allRefs = [
      db.collection('users').doc(uid),
      db.collection('subscriptions').doc(uid),
      ...bizSnap.docs.map(d => d.ref),
      ...bizSubRefs,
      ...activitySnap.docs.map(d => d.ref),
    ];

    const CHUNK = 450;
    for (let i = 0; i < allRefs.length; i += CHUNK) {
      const batch = db.batch();
      allRefs.slice(i, i + CHUNK).forEach(ref => batch.delete(ref));
      await batch.commit();
    }

    try {
      const storageBucket = admin.storage().bucket();
      const storageDeletes = [
        storageBucket.deleteFiles({ prefix: `users/${uid}/images/` }),
        storageBucket.deleteFiles({ prefix: `photos/${uid}/` }),
      ];
      for (const bizDoc of bizSnap.docs) {
        storageDeletes.push(storageBucket.deleteFiles({ prefix: `businesses/${bizDoc.id}/` }));
      }
      await Promise.allSettled(storageDeletes);
    } catch(e) { console.error('[deleteAccount] Storage cleanup failed:', e.message); }

    await admin.auth().deleteUser(uid);
    res.json({ success: true });
  } catch(e) {
    console.error('deleteAccount error:', e);
    res.status(500).json({ error: 'Delete failed: ' + e.message });
  }
});

// ══════════════════════════════════════════
// userCreatedTrigger — schedule setup nudge
// ══════════════════════════════════════════
exports.userCreatedTrigger = onDocumentCreated(
  { document: 'users/{uid}', region: 'us-central1' },
  async (event) => {
    const uid      = event.params.uid;
    const userData = event.data.data();
    try {
      await db.collection('setupNudges').doc(uid).set({
        uid, email: userData.email || null,
        sendAfter: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch(e) { console.error('[userCreatedTrigger] setupNudges write failed:', e.message); }
  }
);

// ══════════════════════════════════════════
// businessCreatedTrigger — welcome email + admin alert
// ══════════════════════════════════════════
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
      name:         ownerName || 'there',
      businessName,
      dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
      upgradeUrl:   APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
      appUrl:       APP_BASE_URL,
    };
    function applyTags(str) { return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || ''); }

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
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 20px"><strong>${mergeData.businessName}</strong> is live on BlastyBiz Agency. Manage unlimited client businesses, blast to every platform, and schedule posts automatically.</p>
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
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 20px"><strong>${mergeData.businessName}</strong> is set up on BlastyBiz Pro. Full API publishing, auto-scheduled posts, and unlimited blasts.</p>
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
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Go to Dashboard &#8594;</a>
    <div style="margin-top:20px"><a href="${mergeData.upgradeUrl}" style="font-size:13px;color:#00873a;font-weight:700;text-decoration:none">Upgrade to Pro &#8594;</a></div>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
    }

    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', templateType).where('active', '==', true).limit(1).get();
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

// ══════════════════════════════════════════
// unsubscribeEmail
// GET /unsubscribeEmail?uid=...&sig=...
// ══════════════════════════════════════════
exports.unsubscribeEmail = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] }, async (req, res) => {
  const uid = req.query.uid;
  const sig = req.query.sig;
  if (!uid || !sig) return res.status(400).send('<p>Missing unsubscribe parameters.</p>');
  const signingKey = _unsubSecret();
  if (!signingKey) return res.status(500).send('<p>Configuration error.</p>');
  const expected = makeUnsubSig(uid, signingKey);
  let sigValid = false;
  try { sigValid = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); } catch(e) { /* invalid hex */ }
  if (!sigValid) return res.status(400).send('<p>Invalid unsubscribe link. Please contact support.</p>');
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return res.status(404).send('<p>Account not found.</p>');
    await db.collection('users').doc(uid).update({ emailUnsubscribed: true });
    return res.status(200).send('<p>You have been unsubscribed. You will no longer receive marketing emails from BlastyBiz.</p>');
  } catch(e) {
    console.error('[unsubscribeEmail] error:', e.message);
    return res.status(500).send('<p>Something went wrong. Please try again or contact support.</p>');
  }
});

// ══════════════════════════════════════════
// sendVerificationEmail — custom Resend email verification
// ══════════════════════════════════════════
exports.sendVerificationEmail = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');

  const { idToken, email } = req.body || {};
  if (!idToken || !email) return res.status(400).json({ error: 'idToken and email required' });

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
    if (decoded.email_verified) return res.json({ ok: true, alreadyVerified: true });
  } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }

  // Generate a one-time verification link via Admin SDK (bypasses Firebase default email)
  let verificationLink;
  try {
    verificationLink = await admin.auth().generateEmailVerificationLink(email, {
      url: APP_BASE_URL + '/BlastyBiz-Onboarding.html',
      handleCodeInApp: false,
    });
  } catch(e) {
    console.error('[sendVerificationEmail] generateEmailVerificationLink failed:', e.message);
    return res.status(500).json({ error: 'Could not generate verification link' });
  }

  try {
    await sendResendEmail({
      to: email,
      subject: 'Verify your BlastyBiz email',
      html: `<div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;padding:32px 24px;background:#ffffff;border-radius:12px">
  <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;margin-bottom:24px;border:0" />
  <h2 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Verify your email address</h2>
  <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">Click the button below to verify your email and continue setting up your BlastyBiz account. This link expires in 24 hours.</p>
  <a href="${verificationLink}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Verify Email &#8594;</a>
  <p style="font-size:12px;color:#999;margin-top:24px">If you didn't create a BlastyBiz account, you can safely ignore this email.</p>
</div>`,
    });
    return res.json({ ok: true });
  } catch(e) {
    console.error('[sendVerificationEmail] send failed:', e.message);
    return res.status(500).json({ error: 'Email send failed' });
  }
});

// ══════════════════════════════════════════
// contactForm — public endpoint, no auth required
// POST /contactForm
// ══════════════════════════════════════════
exports.contactForm = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, withAuth(async (req, res) => {
  const ALLOWED_TO = new Set(['support@blastybiz.com', 'info@blastybiz.com', 'sales@blastybiz.com', 'billing@blastybiz.com']);
  const { to, name, email, message } = req.body || {};
  if (!ALLOWED_TO.has(to)) return res.status(400).json({ error: 'Invalid recipient' });
  if (!name?.trim() || !email?.trim() || !message?.trim()) return res.status(400).json({ error: 'Missing fields' });
  if (name.trim().length > 200) return res.status(400).json({ error: 'Name too long' });
  if (email.trim().length > 200) return res.status(400).json({ error: 'Email too long' });
  if (message.trim().length > 3000) return res.status(400).json({ error: 'Message too long (3000 chars max)' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: 'Invalid email address' });

  try {
    const ip    = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    const ipKey = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const rlRef = db.collection('contactRateLimit').doc(ipKey);
    const rlSnap = await rlRef.get();
    const now    = Date.now();
    const windowMs = 60 * 60 * 1000;
    if (rlSnap.exists) {
      const { count, windowStart } = rlSnap.data();
      if (now - windowStart < windowMs) {
        if (count >= 5) return res.status(429).json({ error: 'Too many messages. Please try again in an hour.' });
        await rlRef.update({ count: admin.firestore.FieldValue.increment(1) });
      } else {
        await rlRef.set({ count: 1, windowStart: now, expiresAt: admin.firestore.Timestamp.fromMillis(now + windowMs) });
      }
    } else {
      await rlRef.set({ count: 1, windowStart: now, expiresAt: admin.firestore.Timestamp.fromMillis(now + windowMs) });
    }
  } catch(e) { /* rate-limit check non-fatal */ }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 'placeholder') return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  const safeName    = escHtml(name.trim());
  const safeEmail   = escHtml(email.trim());
  const safeMessage = escHtml(message.trim()).replace(/\n/g, '<br>');
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'BlastyBiz <info@blastybiz.com>', to: [to],
        reply_to: email.trim(),
        subject: `New message from ${safeName}`,
        html: `<p><strong>Name:</strong> ${safeName}<br><strong>Email:</strong> ${safeEmail}</p><p><strong>Message:</strong><br>${safeMessage}</p>`,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || 'Resend error' });
    return res.json({ success: true, id: data.id });
  } catch(e) { return res.status(500).json({ error: e.message }); }
}, { public: true }));
