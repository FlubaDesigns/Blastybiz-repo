/**
 * BlastyBiz — Firebase Cloud Functions
 * Deploy with: firebase deploy --only functions
 * Requires Blaze (pay-as-you-go) plan
 *
 * Secrets managed via Firebase Secret Manager:
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 *   firebase functions:secrets:set STRIPE_SECRET_KEY
 *   firebase functions:secrets:set STRIPE_PRO_PRICE_ID
 *   firebase functions:secrets:set STRIPE_AGENCY_PRICE_ID
 *   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

// Lazy-init Stripe — secret not available at module load time
let _stripe;
function getStripe() {
  if (!_stripe) _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

admin.initializeApp();
const db = admin.firestore();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.set(k, v));
}

const PLATFORM_RULES = {
  google:     { maxChars: 1500, notes: 'Professional, keyword-rich, include all contact info' },
  facebook:   { maxChars: 2000, notes: 'Engaging, emoji welcome, strong call to action' },
  instagram:  { maxChars: 2200, notes: 'Caption style, 3-5 hashtags at end' },
  bing:       { maxChars: 1500, notes: 'Professional, complete business info, include hours and location' },
  nextdoor:   { maxChars: 1000, notes: 'Warm, community-focused, mention neighborhood' },
  fbmarket:   { maxChars: 1000, notes: 'Clear title, price prominent, location, contact' },
  craigslist: { maxChars: 1500, notes: 'Structured sections, plain text, no emoji' },
  yelp:       { maxChars: 1500, notes: 'Descriptive, highlight uniqueness and atmosphere' },
  applemaps:  { maxChars: 500,  notes: 'Factual, complete, hours and category accurate' },
  alignable:  { maxChars: 800,  notes: 'B2B professional, what you offer other businesses' },
  thumbtack:  { maxChars: 800,  notes: 'Service-focused, expertise, reliability' },
  angi:       { maxChars: 800,  notes: 'Trade-specific, licensed/insured if applicable' },
};

// ══════════════════════════════════════════
// Function 1: adaptListing
// POST /adaptListing
// ══════════════════════════════════════════
exports.adaptListing = onRequest({ secrets: ['ANTHROPIC_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const { listing, platforms, tone, platformCats } = req.body;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const platformList = platforms.map(p => ({
    id: p.id, name: p.name, type: p.type,
    rules: PLATFORM_RULES[p.id] || {}
  }));

  const prompt = `You are a local business marketing expert. Adapt the following business listing for each platform listed. Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

BUSINESS INFO:
- Name: ${listing.name || 'Local Business'}
- Category: ${listing.category || 'General'}
- Description: ${listing.offer}
- Price/Range: ${listing.price || 'not specified'}
- Phone: ${listing.phone || 'not provided'}
- Address: ${listing.address || 'not provided'}
- Website: ${listing.website || 'none'}
- Hours: ${listing.hours || 'not provided'}
- Images attached: ${listing.imageCount > 0 ? listing.imageCount + ' photo(s)' : 'none'}
- Preferred tone: ${tone}

PLATFORMS TO ADAPT FOR:
${platformList.map(p => `- ${p.id}: ${p.name} (${p.type === 'api' ? 'auto-post' : 'copy-paste'})${p.rules.maxChars ? ', max ' + p.rules.maxChars + ' chars' : ''}${p.rules.notes ? ', note: ' + p.rules.notes : ''}`).join('\n')}

Return this exact JSON structure:
{
  "adaptations": {
    "PLATFORM_ID": "adapted text here"
  }
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  const parsed = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim());
  res.json(parsed);
});

// ══════════════════════════════════════════
// Function 2: resolveCategories
// POST /resolveCategories
// ══════════════════════════════════════════
exports.resolveCategories = onRequest({ secrets: ['ANTHROPIC_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const { description, platformCatLists } = req.body;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Given this business: "${description}"
Pick the best matching category for each platform from the lists provided.
Return ONLY valid JSON, no markdown: { "categories": { "platformId": "category name" } }

${Object.entries(platformCatLists).map(([id, cats]) => `${id}: ${cats.join(', ')}`).join('\n')}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const parsed = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim());
  res.json(parsed);
});

// ══════════════════════════════════════════
// Function 3: approveDraft
// POST /approveDraft
// ══════════════════════════════════════════
exports.approveDraft = onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const { draftId, businessId, uid, platforms } = req.body;
  const batch = db.batch();

  batch.update(db.collection('listingDrafts').doc(draftId), {
    status: 'approved', approvedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  platforms.forEach(platform => {
    const jobRef = db.collection('publishJobs').doc();
    const isManual = ['manual_assisted', 'unsupported'].includes(platform.capabilityLevel);
    batch.set(jobRef, {
      jobId: jobRef.id, businessId, uid, draftId,
      platform: platform.id,
      capabilityLevel: platform.capabilityLevel,
      jobType: 'publish_listing',
      status: isManual ? 'manual_required' : 'pending',
      attempts: 0, maxAttempts: 3,
      customerLabel: isManual ? 'Action needed' : 'Waiting to publish',
      customerVisibleMessage: isManual
        ? `Your ${platform.name} listing is ready — you need to post it manually.`
        : `Your ${platform.name} listing is waiting to publish.`,
      manualInstructions: platform.manualInstructions || '',
      adminError: '', payload: { adaptedContent: platform.adaptedContent || '' },
      apiResponse: {}, customerNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
  res.json({ success: true });
});

// ══════════════════════════════════════════
// Function 4: uploadImage
// POST /uploadImage
// ══════════════════════════════════════════
exports.uploadImage = onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const { uid, imageData, fileName, mimeType } = req.body;
  const bucket = admin.storage().bucket();
  const file = bucket.file(`users/${uid}/images/${Date.now()}_${fileName}`);
  await file.save(Buffer.from(imageData, 'base64'), { contentType: mimeType });
  const [url] = await file.getSignedUrl({ action: 'read', expires: '03-01-2500' });
  res.json({ url });
});

// ══════════════════════════════════════════
// Function 5: postToGoogle
// POST /postToGoogle
// ══════════════════════════════════════════
exports.postToGoogle = onRequest(async (req, res) => {
  setCors(res);
  const { content, imageUrls, accessToken, locationId, accountId } = req.body;
  const response = await axios.post(
    `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`,
    {
      languageCode: 'en-US', summary: content,
      media: (imageUrls || []).map(url => ({ mediaFormat: 'PHOTO', sourceUrl: url }))
    },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  res.json({ success: true, postId: response.data.name });
});

// ══════════════════════════════════════════
// Function 6: postToFacebook
// POST /postToFacebook
// ══════════════════════════════════════════
exports.postToFacebook = onRequest(async (req, res) => {
  setCors(res);
  const { content, accessToken, pageId } = req.body;
  const response = await axios.post(
    `https://graph.facebook.com/v18.0/${pageId}/feed`,
    { message: content, access_token: accessToken }
  );
  res.json({ success: true, postId: response.data.id });
});

// ══════════════════════════════════════════
// Function 7: postToInstagram
// POST /postToInstagram
// Two-step: create container then publish
// ══════════════════════════════════════════
exports.postToInstagram = onRequest(async (req, res) => {
  setCors(res);
  const { caption, imageUrl, accessToken, igUserId } = req.body;
  const media = await axios.post(
    `https://graph.facebook.com/v18.0/${igUserId}/media`,
    { image_url: imageUrl, caption, access_token: accessToken }
  );
  const publish = await axios.post(
    `https://graph.facebook.com/v18.0/${igUserId}/media_publish`,
    { creation_id: media.data.id, access_token: accessToken }
  );
  res.json({ success: true, postId: publish.data.id });
});

// ══════════════════════════════════════════
// Function 8: createCheckoutSession
// POST /createCheckoutSession
// ══════════════════════════════════════════
exports.createCheckoutSession = onRequest(async (req, res) => {
  setCors(res);
  const { plan, uid, email } = req.body;
  const prices = {
    pro:    process.env.STRIPE_PRO_PRICE_ID,
    agency: process.env.STRIPE_AGENCY_PRICE_ID
  };
  const session = await getStripe().checkout.sessions.create({
    customer_email: email,
    line_items: [{ price: prices[plan], quantity: 1 }],
    mode: 'subscription',
    success_url: `https://blastybiz-9523e.web.app/BlastyBiz-Dashboard.html?success=1`,
    cancel_url:  `https://blastybiz-9523e.web.app/BlastyBiz-Login.html`,
    metadata: { uid }
  });
  res.json({ url: session.url });
});

// ══════════════════════════════════════════
// Function 9: stripeWebhook
// POST /stripeWebhook
// ══════════════════════════════════════════
exports.stripeWebhook = onRequest(async (req, res) => {
  const event = getStripe().webhooks.constructEvent(
    req.rawBody,
    req.headers['stripe-signature'],
    process.env.STRIPE_WEBHOOK_SECRET
  );

  if (['customer.subscription.created', 'customer.subscription.updated'].includes(event.type)) {
    const sub = event.data.object;
    const uid = sub.metadata.uid;
    const plan = sub.items.data[0].price.nickname?.toLowerCase() || 'pro';

    await db.collection('users').doc(uid).set(
      { plan, planActive: true }, { merge: true }
    );
    await db.collection('subscriptions').doc(uid).set({
      uid,
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      plan,
      status: sub.status,
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
    }, { merge: true });
  }

  if (event.type === 'customer.subscription.deleted') {
    const uid = event.data.object.metadata.uid;
    await db.collection('users').doc(uid).set(
      { plan: 'starter', planActive: false }, { merge: true }
    );
  }

  res.json({ received: true });
});

// ══════════════════════════════════════════
// Function 10: initiateGoogleOAuth
// GET /initiateGoogleOAuth?businessId=...&uid=...
// Redirect prerequisites: set GOOGLE_CLIENT_ID secret
// Google Cloud Console: enable Business Profile API,
// OAuth 2.0 redirect URI = https://us-central1-blastybiz-9523e.cloudfunctions.net/googleOAuthCallback
// ══════════════════════════════════════════
exports.initiateGoogleOAuth = onRequest({ secrets: ['GOOGLE_CLIENT_ID'] }, (req, res) => {
  const { businessId, uid } = req.query;
  if (!businessId) { res.status(400).send('Missing businessId'); return; }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) { res.status(503).send('Google OAuth not configured. Set GOOGLE_CLIENT_ID secret.'); return; }
  const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/googleOAuthCallback';
  const scope = 'https://www.googleapis.com/auth/business.manage';
  const state = encodeURIComponent(JSON.stringify({ businessId, uid: uid || '' }));
  res.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&access_type=offline&prompt=consent` +
    `&state=${state}`
  );
});

// ══════════════════════════════════════════
// Function 11: googleOAuthCallback
// GET /googleOAuthCallback?code=...&state=...
// Exchanges auth code for tokens, stores in platformConnections
// ══════════════════════════════════════════
exports.googleOAuthCallback = onRequest({ secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.redirect('https://blastybiz-9523e.web.app/BlastyBiz-Connect.html?error=google'); return; }

  let businessId = '', uid = '';
  try { const s = JSON.parse(decodeURIComponent(state)); businessId = s.businessId; uid = s.uid; } catch(e) { businessId = state || ''; }

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

    await db.collection('platformConnections').doc(`${businessId}_google`).set({
      businessId, uid, platform: 'google', status: 'connected',
      accessToken: access_token, refreshToken: refresh_token || '',
      accountId, locationId,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + (expires_in || 3600) * 1000)
    }, { merge: true });

    res.redirect('https://blastybiz-9523e.web.app/BlastyBiz-Connect.html?connected=google');
  } catch(e) {
    console.error('googleOAuthCallback error:', e.response?.data || e.message);
    res.redirect('https://blastybiz-9523e.web.app/BlastyBiz-Connect.html?error=google');
  }
});

// ══════════════════════════════════════════
// Function 12: initiateFacebookOAuth
// GET /initiateFacebookOAuth?businessId=...&uid=...
// Redirect prerequisites: set FACEBOOK_APP_ID secret
// Facebook Developer Console: redirect URI =
//   https://us-central1-blastybiz-9523e.cloudfunctions.net/facebookOAuthCallback
// Required permissions: pages_manage_posts, pages_read_engagement,
//   instagram_basic, instagram_content_publish
// ══════════════════════════════════════════
exports.initiateFacebookOAuth = onRequest({ secrets: ['FACEBOOK_APP_ID'] }, (req, res) => {
  const { businessId, uid } = req.query;
  if (!businessId) { res.status(400).send('Missing businessId'); return; }
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) { res.status(503).send('Facebook OAuth not configured. Set FACEBOOK_APP_ID secret.'); return; }
  const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/facebookOAuthCallback';
  const scope = 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish';
  const state = encodeURIComponent(JSON.stringify({ businessId, uid: uid || '' }));
  res.redirect(
    `https://www.facebook.com/v18.0/dialog/oauth` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}`
  );
});

// ══════════════════════════════════════════
// Function 13: facebookOAuthCallback
// GET /facebookOAuthCallback?code=...&state=...
// Exchanges code for page token, fetches linked IG account,
// stores both in platformConnections
// ══════════════════════════════════════════
exports.facebookOAuthCallback = onRequest({ secrets: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.redirect('https://blastybiz-9523e.web.app/BlastyBiz-Connect.html?error=facebook'); return; }

  let businessId = '', uid = '';
  try { const s = JSON.parse(decodeURIComponent(state)); businessId = s.businessId; uid = s.uid; } catch(e) { businessId = state || ''; }

  try {
    const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/facebookOAuthCallback';
    const tokenResp = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: redirectUri, code
      }
    });
    const { access_token } = tokenResp.data;

    const pagesResp = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token }
    });
    const pages = pagesResp.data.data || [];
    const page = pages[0];
    const pageToken = page?.access_token || access_token;

    let igUserId = '';
    if (page?.id) {
      try {
        const igResp = await axios.get(`https://graph.facebook.com/v18.0/${page.id}`, {
          params: { fields: 'instagram_business_account', access_token: pageToken }
        });
        igUserId = igResp.data.instagram_business_account?.id || '';
      } catch(e) { /* no IG account linked */ }
    }

    const batch = db.batch();
    batch.set(db.collection('platformConnections').doc(`${businessId}_facebook`), {
      businessId, uid, platform: 'facebook', status: 'connected',
      accessToken: pageToken, pageId: page?.id || '',
      pageName: page?.name || '',
      allPages: pages.map(p => ({ id: p.id, name: p.name })),
      connectedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (igUserId) {
      batch.set(db.collection('platformConnections').doc(`${businessId}_instagram`), {
        businessId, uid, platform: 'instagram', status: 'connected',
        accessToken: pageToken, igUserId, pageId: page?.id || '',
        connectedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    await batch.commit();
    res.redirect('https://blastybiz-9523e.web.app/BlastyBiz-Connect.html?connected=facebook');
  } catch(e) {
    console.error('facebookOAuthCallback error:', e.response?.data || e.message);
    res.redirect('https://blastybiz-9523e.web.app/BlastyBiz-Connect.html?error=facebook');
  }
});

// ══════════════════════════════════════════
// Function 14: postToBing
// Bing Places has no public write API.
// Marks the job as manual_required with copy-paste instructions.
// ══════════════════════════════════════════
exports.postToBing = onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const { jobId } = req.body;
  if (jobId) {
    await db.collection('publishJobs').doc(jobId).update({
      status: 'manual_required',
      customerVisibleMessage: 'Your Bing Places listing is ready — paste it at bingplaces.com.',
      manualUrl: 'https://www.bingplaces.com',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  res.json({ status: 'manual_required', manualUrl: 'https://www.bingplaces.com' });
});

// ══════════════════════════════════════════
// Function 15: postToAppleMaps
// Apple Maps Connect has no public write API.
// Marks the job as manual_required with submission instructions.
// ══════════════════════════════════════════
exports.postToAppleMaps = onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const { jobId } = req.body;
  if (jobId) {
    await db.collection('publishJobs').doc(jobId).update({
      status: 'manual_required',
      customerVisibleMessage: 'Your Apple Maps listing is ready — submit it at mapsconnect.apple.com.',
      manualUrl: 'https://mapsconnect.apple.com',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  res.json({ status: 'manual_required', manualUrl: 'https://mapsconnect.apple.com' });
});
