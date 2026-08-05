/**
 * BlastyBiz — OAuth endpoints and platform connection management
 * initiateGoogleOAuth, googleOAuthCallback, initiateFacebookOAuth, facebookOAuthCallback,
 * disconnectPlatform, checkPlatformTokenExpiry
 */
'use strict';

const {
  onRequest, onSchedule, admin, db, axios,
  APP_BASE_URL, sendResendEmail,
  userBizRef, userBizConnsRef,
  _getConnTokens, _setConnTokens,
  checkUidRateLimit, setCors, withAuth, verifyBearer,
  makeUnsubSig, _unsubSecret,
} = require('../lib/shared');

exports.initiateGoogleOAuth = onRequest({ invoker: 'public', secrets: ['GOOGLE_CLIENT_ID'] }, withAuth(async (req, res, decoded) => {
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  const uid = decoded.uid;
  const { businessId, returnTo } = req.query;
  if (!businessId) { res.status(400).json({ error: 'Missing businessId' }); return; }
  if (!(await checkUidRateLimit('oauthInitRateLimit', uid, 20, 60 * 60 * 1000))) {
    return res.status(429).json({ error: 'Too many connection attempts. Please try again in an hour.' });
  }
  const bizSnap = await userBizRef(uid, businessId).get();
  if (!bizSnap.exists) { return res.status(403).json({ error: 'Forbidden' }); }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) { res.status(503).json({ error: 'Google OAuth not configured' }); return; }
  const nonce = require('crypto').randomUUID();
  await db.collection('oauthNonces').doc(nonce).set({
    uid, businessId, returnTo: returnTo || '',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  });
  const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/googleOAuthCallback';
  const scope = 'https://www.googleapis.com/auth/business.manage';
  const url =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&access_type=offline&prompt=consent` +
    `&state=${encodeURIComponent(nonce)}`;
  res.json({ url });
}));

exports.googleOAuthCallback = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.redirect(`${APP_BASE_URL}/BlastyBiz-Connect.html?error=google`); return; }

  let businessId = '', uid = '', returnTo = '';
  try {
    const nonce = decodeURIComponent(state || '');
    const nonceRef = db.collection('oauthNonces').doc(nonce);
    const nonceSnap = await nonceRef.get();
    if (!nonceSnap.exists || nonceSnap.data().expiresAt.toDate() < new Date()) {
      return res.status(400).send('Invalid or expired OAuth state. Please try connecting again.');
    }
    ({ businessId, uid, returnTo = '' } = nonceSnap.data());
    await nonceRef.delete();
  } catch(e) {
    console.error('googleOAuthCallback nonce error:', e.message);
    return res.status(400).send('OAuth state verification failed.');
  }
  const connectedRedirect = `${APP_BASE_URL}/BlastyBiz-Connected.html?connected=google${returnTo ? '&returnTo=' + encodeURIComponent(returnTo) : ''}`;
  const errorRedirect     = `${APP_BASE_URL}/BlastyBiz-Connected.html?error=google${returnTo ? '&returnTo=' + encodeURIComponent(returnTo) : ''}`;

  try {
    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', null, {
      params: {
        code, client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://us-central1-blastybiz-9523e.cloudfunctions.net/googleOAuthCallback',
        grant_type: 'authorization_code'
      }
    });
    const { access_token, refresh_token, expires_in } = tokenResp.data;

    let accountId = '', locationId = '';
    try {
      const acctResp = await axios.get(
        'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      const account = acctResp.data.accounts?.[0];
      accountId = account?.name?.replace('accounts/', '') || '';
      if (accountId) {
        const locResp = await axios.get(
          `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations`,
          { headers: { Authorization: `Bearer ${access_token}` } }
        );
        locationId = locResp.data.locations?.[0]?.name?.split('/').pop() || '';
      }
    } catch(e) { /* accounts/locations can be resolved on first use */ }

    const googleConnRef = userBizConnsRef(uid, businessId).doc('google');
    await googleConnRef.set({
      businessId, uid, platform: 'google', status: 'connected',
      accountId, locationId,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + (expires_in || 3600) * 1000)
    }, { merge: true });
    await _setConnTokens(googleConnRef, { accessToken: access_token, refreshToken: refresh_token || '' });

    // Queue Google photos import — fire-and-forget, never await (callback must stay fast)
    db.collection('importJobs').doc(uid + '_google').set({
      status: 'queued', uid, bizId: businessId,
      queuedAt: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(e => console.warn('[googleOAuthCallback] importJobs queue failed:', e.message));

    res.redirect(connectedRedirect);
  } catch(e) {
    console.error('googleOAuthCallback error:', e.response?.data || e.message);
    res.redirect(errorRedirect);
  }
});

exports.initiateFacebookOAuth = onRequest({ invoker: 'public', secrets: ['FACEBOOK_APP_ID'] }, withAuth(async (req, res, decoded) => {
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  const uid = decoded.uid;
  const { businessId, returnTo } = req.query;
  if (!businessId) { res.status(400).json({ error: 'Missing businessId' }); return; }
  if (!(await checkUidRateLimit('oauthInitRateLimit', uid, 20, 60 * 60 * 1000))) {
    return res.status(429).json({ error: 'Too many connection attempts. Please try again in an hour.' });
  }
  const bizSnap = await userBizRef(uid, businessId).get();
  if (!bizSnap.exists) { return res.status(403).json({ error: 'Forbidden' }); }
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) { res.status(503).json({ error: 'Facebook OAuth not configured' }); return; }
  const nonce = require('crypto').randomUUID();
  await db.collection('oauthNonces').doc(nonce).set({
    uid, businessId, returnTo: returnTo || '',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  });
  const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/facebookOAuthCallback';
  const scope = 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish';
  const url =
    `https://www.facebook.com/v18.0/dialog/oauth` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(nonce)}`;
  res.json({ url });
}));

exports.facebookOAuthCallback = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.redirect(`${APP_BASE_URL}/BlastyBiz-Connect.html?error=facebook`); return; }

  let businessId = '', uid = '', returnTo = '';
  try {
    const nonce = decodeURIComponent(state || '');
    const nonceRef = db.collection('oauthNonces').doc(nonce);
    const nonceSnap = await nonceRef.get();
    if (!nonceSnap.exists || nonceSnap.data().expiresAt.toDate() < new Date()) {
      return res.status(400).send('Invalid or expired OAuth state. Please try connecting again.');
    }
    ({ businessId, uid, returnTo = '' } = nonceSnap.data());
    await nonceRef.delete();
  } catch(e) {
    console.error('facebookOAuthCallback nonce error:', e.message);
    return res.status(400).send('OAuth state verification failed.');
  }
  const fbConnectedRedirect = `${APP_BASE_URL}/BlastyBiz-Connected.html?connected=facebook${returnTo ? '&returnTo=' + encodeURIComponent(returnTo) : ''}`;
  const fbErrorRedirect     = `${APP_BASE_URL}/BlastyBiz-Connected.html?error=facebook${returnTo ? '&returnTo=' + encodeURIComponent(returnTo) : ''}`;

  try {
    const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/facebookOAuthCallback';
    const tokenResp = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: redirectUri, code
      }
    });
    const { access_token: shortLivedToken } = tokenResp.data;

    const longLivedResp = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        fb_exchange_token: shortLivedToken
      }
    });
    const longLivedToken = longLivedResp.data.access_token;
    const expiresIn = longLivedResp.data.expires_in || (60 * 24 * 3600);
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    const pagesResp = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: longLivedToken }
    });
    const pages = pagesResp.data.data || [];
    const page = pages[0];
    const pageToken = page?.access_token || longLivedToken;

    let igUserId = '';
    if (page?.id) {
      try {
        const igResp = await axios.get(`https://graph.facebook.com/v18.0/${page.id}`, {
          params: { fields: 'instagram_business_account', access_token: pageToken }
        });
        igUserId = igResp.data.instagram_business_account?.id || '';
      } catch(e) { /* no IG account linked */ }
    }

    let existingIgDoc = null;
    if (!igUserId) {
      try {
        const igSnap = await userBizConnsRef(uid, businessId).doc('instagram').get();
        if (igSnap.exists) existingIgDoc = igSnap.data();
      } catch(e) { /* ignore */ }
    }

    const fbConnRef = userBizConnsRef(uid, businessId).doc('facebook');
    const igConnRef = userBizConnsRef(uid, businessId).doc('instagram');
    const batch = db.batch();
    batch.set(fbConnRef, {
      businessId, uid, platform: 'facebook', status: 'connected',
      pageId: page?.id || '',
      pageName: page?.name || '',
      allPages: pages.map(p => ({ id: p.id, name: p.name })),
      expiresAt,
      connectedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(fbConnRef.collection('private').doc('tokens'), { accessToken: pageToken }, { merge: true });

    if (igUserId) {
      batch.set(igConnRef, {
        businessId, uid, platform: 'instagram', status: 'connected',
        igUserId, pageId: page?.id || '',
        expiresAt,
        connectedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      batch.set(igConnRef.collection('private').doc('tokens'), { accessToken: pageToken }, { merge: true });
    } else if (existingIgDoc) {
      batch.set(igConnRef, {
        status: 'connected',
        expiresAt,
        connectedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      batch.set(igConnRef.collection('private').doc('tokens'), { accessToken: pageToken }, { merge: true });
    }

    await batch.commit();
    res.redirect(fbConnectedRedirect);
  } catch(e) {
    console.error('facebookOAuthCallback error:', e.response?.data || e.message);
    res.redirect(fbErrorRedirect);
  }
});

exports.disconnectPlatform = onRequest(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  try {
    const decoded = await verifyBearer(req);
    const { bizId, platformId } = req.body;
    if (!bizId || !platformId) return res.status(400).json({ error: 'Missing bizId or platformId' });
    if (!['google', 'facebook', 'instagram'].includes(platformId)) {
      return res.status(400).json({ error: 'Invalid platformId' });
    }

    const connRef = db.collection('users').doc(decoded.uid)
      .collection('businesses').doc(bizId)
      .collection('platformConnections').doc(platformId);
    const connSnap = await connRef.get();
    if (!connSnap.exists) return res.status(404).json({ error: 'Connection not found' });
    const privTokens = await _getConnTokens(connRef);
    const conn = { ...connSnap.data(), ...privTokens };

    if (platformId === 'google') {
      for (const tok of [conn.accessToken, conn.refreshToken].filter(Boolean)) {
        try {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: 'POST' });
        } catch(e) { console.warn('[disconnectPlatform] Google revoke failed:', e.message); }
      }
    }
    if (platformId === 'facebook' || platformId === 'instagram') {
      if (conn.accessToken) {
        try {
          await fetch(`https://graph.facebook.com/v20.0/me/permissions?access_token=${encodeURIComponent(conn.accessToken)}`, { method: 'DELETE' });
        } catch(e) { console.warn('[disconnectPlatform] Facebook revoke failed:', e.message); }
      }
    }

    await connRef.update({ status: 'disconnected', disconnectedAt: admin.firestore.FieldValue.serverTimestamp() });

    if (platformId === 'facebook') {
      const igRef = db.collection('users').doc(decoded.uid)
        .collection('businesses').doc(bizId)
        .collection('platformConnections').doc('instagram');
      const igSnap = await igRef.get();
      if (igSnap.exists) {
        await igRef.update({ status: 'disconnected', disconnectedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    }

    res.json({ ok: true });
  } catch(e) {
    console.error('[disconnectPlatform]', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

exports.checkPlatformTokenExpiry = onSchedule(
  {
    schedule: 'every 30 minutes',
    region: 'us-central1',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  },
  async () => {
    const cutoffShort = new Date(Date.now() + 5 * 60 * 1000);
    const cutoffFb    = new Date(Date.now() + 7 * 24 * 3600 * 1000);

    let tmplSubject = null, tmplHtml = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'platform-expired').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) {
        tmplSubject = tmplSnap.docs[0].data().subject;
        tmplHtml    = tmplSnap.docs[0].data().html;
      }
    } catch(e) { console.error('[checkPlatformTokenExpiry] template fetch failed:', e.message); }

    const snap = await db.collectionGroup('platformConnections')
      .where('status', '==', 'connected')
      .get();

    let refreshed = 0, expired = 0, skipped = 0;
    const toNotify = [];

    for (const docSnap of snap.docs) {
      const conn = docSnap.data();

      if (!conn.expiresAt) { skipped++; continue; }

      const expiresAt = conn.expiresAt.toDate ? conn.expiresAt.toDate() : new Date(conn.expiresAt);
      const isFbOrIg  = conn.platform === 'facebook' || conn.platform === 'instagram';
      const cutoff    = isFbOrIg ? cutoffFb : cutoffShort;

      if (expiresAt > cutoff) { skipped++; continue; }

      const privTokens = await _getConnTokens(docSnap.ref);

      const igRef = docSnap.ref.parent.parent.collection('platformConnections').doc('instagram');

      if (conn.platform === 'facebook' && privTokens.accessToken) {
        try {
          const resp = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
              grant_type:       'fb_exchange_token',
              client_id:        process.env.FACEBOOK_APP_ID,
              client_secret:    process.env.FACEBOOK_APP_SECRET,
              fb_exchange_token: privTokens.accessToken,
            },
          });
          const { access_token, expires_in } = resp.data;
          const newExpiresAt = new Date(Date.now() + (expires_in || 60 * 24 * 3600) * 1000);

          await _setConnTokens(docSnap.ref, { accessToken: access_token });
          await docSnap.ref.update({
            expiresAt: newExpiresAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[checkPlatformTokenExpiry] Refreshed Facebook token for biz ${conn.businessId}`);

          const igSnap  = await igRef.get();
          if (igSnap.exists && igSnap.data().status === 'connected') {
            await _setConnTokens(igRef, { accessToken: access_token });
            await igRef.update({
              expiresAt: newExpiresAt,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`[checkPlatformTokenExpiry] Mirrored refreshed token to instagram for biz ${conn.businessId}`);
          }

          refreshed++;
          continue;
        } catch (e) {
          console.warn(`[checkPlatformTokenExpiry] Facebook refresh failed for biz ${conn.businessId}:`,
            e.response?.data || e.message);
          try {
            const igSnap  = await igRef.get();
            if (igSnap.exists && igSnap.data().status === 'connected') {
              await igRef.update({
                status:    'expired',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              console.log(`[checkPlatformTokenExpiry] Marked expired (paired with failed FB) instagram for biz ${conn.businessId}`);
            }
          } catch (igErr) {
            console.error(`[checkPlatformTokenExpiry] Failed to mark IG expired for business ${conn.businessId}:`, igErr.message);
          }
        }
      }

      if (conn.platform === 'instagram') { skipped++; continue; }

      if (conn.platform === 'google' && privTokens.refreshToken) {
        try {
          const resp = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
              client_id:     process.env.GOOGLE_CLIENT_ID,
              client_secret: process.env.GOOGLE_CLIENT_SECRET,
              refresh_token: privTokens.refreshToken,
              grant_type:    'refresh_token',
            },
          });
          const { access_token, expires_in } = resp.data;
          await _setConnTokens(docSnap.ref, { accessToken: access_token });
          await docSnap.ref.update({
            expiresAt: new Date(Date.now() + (expires_in || 3600) * 1000),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[checkPlatformTokenExpiry] Refreshed Google token for ${docSnap.id}`);
          refreshed++;
          continue;
        } catch (e) {
          console.warn(`[checkPlatformTokenExpiry] Google refresh failed for ${docSnap.id}:`,
            e.response?.data || e.message);
        }
      }

      try {
        await docSnap.ref.update({
          status:    'expired',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[checkPlatformTokenExpiry] Marked expired: ${docSnap.id} (platform: ${conn.platform})`);
        expired++;
      } catch (e) {
        console.error(`[checkPlatformTokenExpiry] Failed to mark expired for ${docSnap.id}:`, e.message);
        continue;
      }

      if (conn.uid) toNotify.push({ conn, docId: docSnap.id });
    }

    if (toNotify.length > 0) {
      const _uniqueUids  = [...new Set(toNotify.map(n => n.conn.uid))];
      const _userRefs    = _uniqueUids.map(uid => db.collection('users').doc(uid));
      const _userDocs    = await db.getAll(..._userRefs);
      const _userDataMap = Object.fromEntries(_userDocs.map(d => [d.id, d.exists ? d.data() : null]));

      for (const { conn, docId } of toNotify) {
        const userData = _userDataMap[conn.uid];
        if (!userData || !userData.email || userData.emailUnsubscribed) continue;

        try {
          const ownerName = userData.ownerName || userData.displayName || '';
          let businessName = '';
          try {
            const bizSnap = await userBizRef(conn.uid, conn.businessId).get();
            businessName = bizSnap.data()?.businessName || '';
          } catch(e) { /* non-fatal */ }

          const platformDisplay = conn.platform === 'google' ? 'Google Business Profile'
            : conn.platform.charAt(0).toUpperCase() + conn.platform.slice(1);

          const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(conn.uid)}&sig=${makeUnsubSig(conn.uid, _unsubSecret())}`;
          const connectUrl = `${APP_BASE_URL}/BlastyBiz-Connect.html`;

          const mergeData = {
            name:           ownerName || 'there',
            businessName:   businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
            platform:       platformDisplay,
            connectUrl,
            appUrl:         APP_BASE_URL,
            unsubscribeUrl: unsubUrl,
          };
          function applyExpiredTags(str) {
            return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
          }

          const subject = tmplSubject
            ? applyExpiredTags(tmplSubject)
            : `Action needed — your ${platformDisplay} connection expired`;
          const html = tmplHtml
            ? applyExpiredTags(tmplHtml)
            : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Your ${platformDisplay} connection needs a quick reconnect, ${mergeData.name}.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">Your <strong>${platformDisplay}</strong> authorization for <strong>${mergeData.businessName}</strong> has expired. Auto-posting to ${platformDisplay} is paused until you reconnect.</p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">It only takes a few seconds — just click the button below and authorize BlastyBiz again.</p>
    <a href="${connectUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Reconnect ${platformDisplay} &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Your content and campaigns are all still saved — nothing is lost.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

          await sendResendEmail({ to: userData.email, subject, html });
          console.log(`[checkPlatformTokenExpiry] Sent expiry email to ${userData.email} for ${docId}`);
        } catch(e) {
          console.error(`[checkPlatformTokenExpiry] Email failed for ${docId}:`, e.message);
        }
      }
    }

    console.log(`[checkPlatformTokenExpiry] Done — refreshed: ${refreshed}, expired: ${expired}, skipped: ${skipped}`);
  }
);
