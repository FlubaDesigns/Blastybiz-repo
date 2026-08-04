'use strict';
const axios = require('axios');
const { onRequest } = require('firebase-functions/v2/https');

const { db, admin, userBizRef, userBizConnsRef, _setConnTokens } = require('../lib/db');
const { withAuth, checkUidRateLimit: _unused, setCors }          = require('../lib/auth');
const { checkUidRateLimit }                                       = require('../lib/rateLimit');
const { APP_BASE_URL }                                            = require('../lib/config');

// ══════════════════════════════════════════
// initiateGoogleOAuth
// GET /initiateGoogleOAuth?businessId=...
// ══════════════════════════════════════════
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
  const scope       = 'https://www.googleapis.com/auth/business.manage';
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

// ══════════════════════════════════════════
// googleOAuthCallback
// GET /googleOAuthCallback?code=...&state=...
// ══════════════════════════════════════════
exports.googleOAuthCallback = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.redirect(`${APP_BASE_URL}/BlastyBiz-Connect.html?error=google`); return; }

  let businessId = '', uid = '', returnTo = '';
  try {
    const nonce    = decodeURIComponent(state || '');
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

    res.redirect(connectedRedirect);
  } catch(e) {
    console.error('googleOAuthCallback error:', e.response?.data || e.message);
    res.redirect(errorRedirect);
  }
});

// ══════════════════════════════════════════
// initiateFacebookOAuth
// GET /initiateFacebookOAuth?businessId=...
// ══════════════════════════════════════════
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
  const scope       = 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish';
  const url =
    `https://www.facebook.com/v18.0/dialog/oauth` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(nonce)}`;
  res.json({ url });
}));

// ══════════════════════════════════════════
// facebookOAuthCallback
// GET /facebookOAuthCallback?code=...&state=...
// ══════════════════════════════════════════
exports.facebookOAuthCallback = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.redirect(`${APP_BASE_URL}/BlastyBiz-Connect.html?error=facebook`); return; }

  let businessId = '', uid = '', returnTo = '';
  try {
    const nonce    = decodeURIComponent(state || '');
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
    const redirectUri  = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/facebookOAuthCallback';
    const tokenResp    = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: { client_id: process.env.FACEBOOK_APP_ID, client_secret: process.env.FACEBOOK_APP_SECRET, redirect_uri: redirectUri, code }
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
    const expiresIn      = longLivedResp.data.expires_in || (60 * 24 * 3600);
    const expiresAt      = new Date(Date.now() + expiresIn * 1000);

    const pagesResp = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: longLivedToken }
    });
    const pages     = pagesResp.data.data || [];
    const page      = pages[0];
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
    const batch     = db.batch();
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
      batch.set(igConnRef, { status: 'connected', expiresAt, connectedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      batch.set(igConnRef.collection('private').doc('tokens'), { accessToken: pageToken }, { merge: true });
    }

    await batch.commit();
    res.redirect(fbConnectedRedirect);
  } catch(e) {
    console.error('facebookOAuthCallback error:', e.response?.data || e.message);
    res.redirect(fbErrorRedirect);
  }
});
