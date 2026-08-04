/**
 * BlastyBiz — Business and account management
 * createBusiness, deleteBusiness, deleteAccount, sendVerificationEmail
 */
'use strict';

const {
  onRequest, admin, db,
  APP_BASE_URL, sendResendEmail, getSquare,
  userBizRef, userBizCol, userBizDraftsRef, userBizJobsRef, userBizPostsRef, userBizConnsRef,
  checkUidRateLimit, setCors, withAuth,
  getPlanConfig,
} = require('../lib/shared');

exports.createBusiness = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const uid = decoded.uid;
  const { profileData, isNew } = req.body || {};
  if (!profileData || typeof profileData !== 'object') {
    return res.status(400).json({ error: 'Missing profileData' });
  }
  const planCfg = await getPlanConfig();
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const plan = userData.plan || 'starter';
    const cap = planCfg.bizLimits[plan] ?? 1;
    let dedupedBizId = null;
    if (isNew && profileData.businessName && profileData.address) {
      const existingSnap = await userBizCol(uid)
        .where('businessName', '==', profileData.businessName)
        .where('address', '==', profileData.address)
        .limit(1)
        .get();
      if (!existingSnap.empty) {
        dedupedBizId = existingSnap.docs[0].id;
      }
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
      ...cleanData,
      uid,
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

exports.deleteBusiness = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const uid = decoded.uid;
  const { bizId } = req.body || {};
  if (!bizId) return res.status(400).json({ error: 'Missing bizId' });
  try {
    const bizRef = db.collection('users').doc(uid).collection('businesses').doc(bizId);
    const bizSnap = await bizRef.get();
    if (!bizSnap.exists) return res.status(404).json({ error: 'Business not found' });
    await db.recursiveDelete(bizRef);
    return res.json({ success: true });
  } catch(e) {
    console.error('[deleteBusiness]', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
}));

exports.deleteAccount = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_ACCESS_TOKEN'] }, async (req, res) => {
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
    const subSnap = await db.collection('subscriptions').doc(uid).get();
    if (subSnap.exists) {
      const { squareSubscriptionId } = subSnap.data();
      if (squareSubscriptionId) {
        try { await getSquare().subscriptions.cancel({ subscriptionId: squareSubscriptionId }); } catch (_) {}
      }
    }

    const [bizSnap, activitySnap] =
      await Promise.all([
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
      [draftsSnap, jobsSnap, connsSnap, pendingSnap, libSnap,
       bizFactsSnap, bizImagesSnap]
        .forEach(snap => snap.docs.forEach(d => bizSubRefs.push(d.ref)));

      // Enumerate private/tokens subcollections under each platformConnection.
      // Firestore does NOT cascade-delete subcollections when a parent doc is deleted,
      // so these must be collected explicitly or live OAuth tokens orphan after erasure.
      for (const connDoc of connsSnap.docs) {
        const privSnap = await connDoc.ref.collection('private').get();
        privSnap.docs.forEach(d => bizSubRefs.push(d.ref));
      }

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
        [cFacts, cImages, cDocs, cCopy, cAds]
          .forEach(snap => snap.docs.forEach(d => bizSubRefs.push(d.ref)));
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
        storageDeletes.push(
          storageBucket.deleteFiles({ prefix: `businesses/${bizDoc.id}/` })
        );
      }
      await Promise.allSettled(storageDeletes);
    } catch(e) {
      console.error('[deleteAccount] Storage cleanup failed:', e.message);
    }

    await admin.auth().deleteUser(uid);

    res.json({ success: true });
  } catch (e) {
    console.error('deleteAccount error:', e);
    res.status(500).json({ error: 'Delete failed: ' + e.message });
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
