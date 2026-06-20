/**
 * BlastyBiz — Firebase Cloud Functions v2
 * Deploy with: firebase deploy --only functions
 * Requires Blaze (pay-as-you-go) plan
 *
 * Secrets managed via Firebase Secret Manager:
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 *   firebase functions:secrets:set SQUARE_ACCESS_TOKEN
 *   firebase functions:secrets:set SQUARE_LOCATION_ID
 *   firebase functions:secrets:set SQUARE_PRO_PLAN_ID
 *   firebase functions:secrets:set SQUARE_AGENCY_PLAN_ID
 *   firebase functions:secrets:set SQUARE_WEBHOOK_SIGNATURE_KEY
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

// ── Resend email helper (uses native fetch — Node 22) ──────────────────────
async function sendResendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 'placeholder') {
    console.log('[email] RESEND_API_KEY not configured — skipping email to', to);
    return;
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'BlastyBiz <hello@blastybiz.com>', to: [to], subject, html }),
    });
    if (!resp.ok) console.error('[email] Resend error:', await resp.text());
  } catch (e) {
    console.error('[email] sendResendEmail failed:', e.message);
  }
}

const crypto = require('crypto');

// Lazy-init Square client — secret not available at module load time
let _square;
function getSquare() {
  if (!_square) {
    const { Client, Environment } = require('square');
    _square = new Client({
      accessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: Environment.Production,
    });
  }
  return _square;
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

// ── Auth helpers ─────────────────────────────────────────────────────────────
async function verifyBearer(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing Authorization header'), { status: 401 });
  }
  const token = authHeader.slice(7);
  return await admin.auth().verifyIdToken(token);
}

async function requireAdmin(req) {
  const decoded = await verifyBearer(req);
  if (decoded.email !== 'perceys@gmail.com') {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  return decoded;
}

// ── AI usage limits (actions per month by plan) ──────────────────────────────
const AI_LIMITS = { starter: 10, pro: 100, agency: 500 };

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
exports.adaptListing = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  let plan = 'starter', needsReset = true, used = 0;
  try {
    const userSnap = await db.collection('users').doc(decoded.uid).get();
    const userData  = userSnap.exists ? userSnap.data() : {};
    plan      = userData.plan || 'starter';
    const cap       = AI_LIMITS[plan] || AI_LIMITS.starter;
    const resetAt   = userData.aiActionsResetAt?.toDate?.() || null;
    const now2      = new Date();
    needsReset = !resetAt || now2 > resetAt;
    used      = needsReset ? 0 : (userData.aiActionsUsed || 0);
    if (used >= cap) return res.status(429).json({ error: `AI limit reached (${used}/${cap} this month). Upgrade your plan for more.` });
  } catch(fsErr) {
    console.warn('adaptListing: Firestore read failed (IAM?), proceeding with starter defaults:', fsErr.message);
  }

  const now = new Date();
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

  let parsed;
  try {
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    });
    if (!aiResp.ok) { const t = await aiResp.text(); throw new Error(`Anthropic ${aiResp.status}: ${t.slice(0,200)}`); }
    const aiJson = await aiResp.json();
    parsed = JSON.parse(aiJson.content[0].text.replace(/```json|```/g, '').trim());
  } catch(e) {
    console.error('adaptListing AI error:', e.message);
    return res.status(500).json({ error: 'AI adaptation failed: ' + e.message });
  }

  try {
    if (needsReset) {
      await db.collection('users').doc(decoded.uid).update({
        aiActionsUsed: 1,
        aiActionsResetAt: admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000))
      });
    } else {
      await db.collection('users').doc(decoded.uid).update({
        aiActionsUsed: admin.firestore.FieldValue.increment(1)
      });
    }
  } catch(fsErr) {
    console.warn('adaptListing: Firestore update failed (IAM?), usage not tracked:', fsErr.message);
  }
  res.json(parsed);
});

// ══════════════════════════════════════════
// Function 2: resolveCategories
// POST /resolveCategories
// ══════════════════════════════════════════
exports.resolveCategories = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  let needsReset = true;
  try {
    const userSnap = await db.collection('users').doc(decoded.uid).get();
    const userData  = userSnap.exists ? userSnap.data() : {};
    const plan      = userData.plan || 'starter';
    const cap       = AI_LIMITS[plan] || AI_LIMITS.starter;
    const resetAt   = userData.aiActionsResetAt?.toDate?.() || null;
    const now2      = new Date();
    needsReset = !resetAt || now2 > resetAt;
    const used      = needsReset ? 0 : (userData.aiActionsUsed || 0);
    if (used >= cap) return res.status(429).json({ error: `AI limit reached (${used}/${cap} this month). Upgrade your plan for more.` });
  } catch(fsErr) {
    console.warn('resolveCategories: Firestore read failed (IAM?), proceeding with starter defaults:', fsErr.message);
  }

  const now = new Date();

  const { description, platformCatLists } = req.body;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Given this business: "${description}"
Pick the best matching category for each platform from the lists provided.
Return ONLY valid JSON, no markdown: { "categories": { "platformId": "category name" } }

${Object.entries(platformCatLists).map(([id, cats]) => `${id}: ${cats.join(', ')}`).join('\n')}`;

  let parsed;
  try {
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
    });
    if (!aiResp.ok) { const t = await aiResp.text(); throw new Error(`Anthropic ${aiResp.status}: ${t.slice(0,200)}`); }
    const aiJson = await aiResp.json();
    parsed = JSON.parse(aiJson.content[0].text.replace(/```json|```/g, '').trim());
  } catch(e) {
    console.error('resolveCategories AI error:', e.message);
    return res.status(500).json({ error: 'AI category resolution failed: ' + e.message });
  }

  try {
    if (needsReset) {
      await db.collection('users').doc(decoded.uid).update({
        aiActionsUsed: 1,
        aiActionsResetAt: admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000))
      });
    } else {
      await db.collection('users').doc(decoded.uid).update({
        aiActionsUsed: admin.firestore.FieldValue.increment(1)
      });
    }
  } catch(fsErr) {
    console.warn('resolveCategories: Firestore update failed (IAM?), usage not tracked:', fsErr.message);
  }
  res.json(parsed);
});

// ══════════════════════════════════════════
// Function 3: approveDraft
// POST /approveDraft
// ══════════════════════════════════════════
exports.approveDraft = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { draftId, businessId, platforms } = req.body;
  const uid = decoded.uid;

  // Check user plan — starter users can't auto-post via API platforms
  const userSnap = await db.collection('users').doc(uid).get();
  const userPlan = userSnap.exists ? (userSnap.data().plan || 'starter') : 'starter';
  const isStarter = userPlan === 'starter';

  const batch = db.batch();

  batch.update(db.collection('listingDrafts').doc(draftId), {
    status: 'approved', approvedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  platforms.forEach(platform => {
    const jobRef = db.collection('publishJobs').doc();
    const isNativelyManual = ['manual_assisted', 'unsupported'].includes(platform.capabilityLevel);
    const isManual = isNativelyManual || isStarter;
    const starterBlocked = isStarter && !isNativelyManual;
    batch.set(jobRef, {
      jobId: jobRef.id, businessId, uid, draftId,
      platform: platform.id,
      capabilityLevel: platform.capabilityLevel,
      jobType: 'publish_listing',
      status: isManual ? 'manual_required' : 'pending',
      attempts: 0, maxAttempts: 3,
      customerLabel: isManual ? 'Action needed' : 'Waiting to publish',
      customerVisibleMessage: starterBlocked
        ? `Upgrade to Pro to auto-post to ${platform.name}. Your content is ready — copy it below.`
        : isManual
          ? `Your ${platform.name} listing is ready — you need to post it manually.`
          : `Your ${platform.name} listing is waiting to publish.`,
      planGated: starterBlocked,
      manualInstructions: platform.manualInstructions || '',
      adminError: '', payload: { adaptedContent: platform.adaptedContent || '' },
      apiResponse: {}, customerNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
  res.json({ success: true, plan: userPlan });
});

// ══════════════════════════════════════════
// Function 4: uploadImage
// POST /uploadImage
// ══════════════════════════════════════════
exports.uploadImage = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { imageData, fileName, mimeType } = req.body;
  const uid = decoded.uid;
  const bucket = admin.storage().bucket();
  const file = bucket.file(`users/${uid}/images/${Date.now()}_${fileName}`);
  await file.save(Buffer.from(imageData, 'base64'), { contentType: mimeType });
  const [url] = await file.getSignedUrl({ action: 'read', expires: '03-01-2500' });
  res.json({ url });
});

// ── Internal publishing helpers (used by onJobCreated trigger) ───────────────

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
  const content    = job.payload?.adaptedContent || '';
  const imageUrls  = job.payload?.imageUrls || [];
  async function tryPost(token) {
    return axios.post(
      `https://mybusiness.googleapis.com/v4/accounts/${conn.accountId}/locations/${conn.locationId}/localPosts`,
      { languageCode: 'en-US', summary: content, media: imageUrls.map(u => ({ mediaFormat: 'PHOTO', sourceUrl: u })) },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }
  try {
    const r = await tryPost(conn.accessToken);
    return { postId: r.data.name };
  } catch(e) {
    if (e.response?.status === 401 && conn.refreshToken) {
      const newToken = await _googleRefreshToken(conn.refreshToken);
      await db.collection('platformConnections').doc(`${job.businessId}_google`).update({
        accessToken: newToken, updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
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
  if (!imageUrl) throw new Error('Instagram requires an image URL in payload.imageUrls[0]');
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

// ══════════════════════════════════════════
// Function 5: createCheckoutSession
// POST /createCheckoutSession
// ══════════════════════════════════════════
exports.createCheckoutSession = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID', 'SQUARE_PRO_PLAN_ID', 'SQUARE_AGENCY_PLAN_ID'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
  const uid   = decoded.uid;
  const email = decoded.email || req.body.email || '';
  const { plan } = req.body;
  // Read active plan IDs from Firestore (updated by adminUpdatePricing) — fall back to Secret Manager
  const pricingSnap = await db.collection('settings').doc('pricing').get();
  const pricingData = pricingSnap.exists ? pricingSnap.data() : {};
  const planIds = {
    pro:    pricingData.squareProPlanId    || process.env.SQUARE_PRO_PLAN_ID,
    agency: pricingData.squareAgencyPlanId || process.env.SQUARE_AGENCY_PLAN_ID,
  };
  if (!planIds[plan]) return res.status(400).json({ error: 'Invalid plan' });
  const { checkoutApi } = getSquare();
  const response = await checkoutApi.createPaymentLink({
    idempotencyKey: `checkout-${uid}-${plan}-${Date.now()}`,
    order: {
      locationId: process.env.SQUARE_LOCATION_ID,
      referenceId: uid,
      lineItems: [{ quantity: '1', catalogObjectId: planIds[plan] }],
    },
    checkoutOptions: {
      redirectUrl: `https://blastybiz-9523e.web.app/BlastyBiz-Dashboard.html?success=1`,
      merchantSupportEmail: 'hello@blastybiz.com',
    },
    prePopulatedData: { buyerEmail: email },
  });
  res.json({ url: response.result.paymentLink.url });
});

// ══════════════════════════════════════════
// Function 9: createPortalSession
// POST /createPortalSession
// Square has no hosted billing portal.
// Returns a mailto link so the user can request changes.
// ══════════════════════════════════════════
exports.createPortalSession = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
  const uid = decoded.uid;
  const subSnap = await db.collection('subscriptions').doc(uid).get();
  if (!subSnap.exists) return res.status(404).json({ error: 'No subscription found' });
  res.json({ url: 'mailto:hello@blastybiz.com?subject=Manage%20BlastyBiz%20Subscription' });
});

// ══════════════════════════════════════════
// Function 10: squareWebhook
// POST /squareWebhook
// Verifies Square HMAC signature, handles payment.completed,
// subscription.created, and subscription.updated (cancellation) events.
// ══════════════════════════════════════════
exports.squareWebhook = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_WEBHOOK_SIGNATURE_KEY'] }, async (req, res) => {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/squareWebhook';
  const body = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', signatureKey);
  hmac.update(notificationUrl + body);
  const expected = hmac.digest('base64');
  if (expected !== req.headers['x-square-hmacsha256-signature']) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const event = req.body;

  if (event.type === 'payment.completed') {
    const payment = event.data?.object?.payment;
    if (!payment) return res.json({ received: true });
    const orderId = payment.order_id || payment.orderId;
    if (!orderId) return res.json({ received: true });
    try {
      const { ordersApi } = getSquare();
      const orderResp = await ordersApi.retrieveOrder(orderId);
      const uid = orderResp.result?.order?.referenceId;
      if (!uid) return res.json({ received: true });
      const lineItems = orderResp.result?.order?.lineItems || [];
      const planVarId = lineItems[0]?.catalogObjectId || '';
      const plan = planVarId === process.env.SQUARE_AGENCY_PLAN_ID ? 'agency' : 'pro';
      await db.collection('users').doc(uid).set(
        { plan, planActive: true }, { merge: true }
      );
      await db.collection('subscriptions').doc(uid).set({
        uid,
        squareCustomerId: payment.customer_id || '',
        squarePaymentId: payment.id,
        plan,
        status: 'active',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.error('squareWebhook order lookup error:', e.message);
    }
  }

  if (event.type === 'subscription.created') {
    const sub = event.data?.object?.subscription;
    if (sub) {
      const subscriptionId = sub.id;
      const customerId = sub.customer_id || sub.customerId;
      if (subscriptionId && customerId) {
        try {
          const snap = await db.collection('subscriptions')
            .where('squareCustomerId', '==', customerId).limit(1).get();
          if (!snap.empty) {
            await snap.docs[0].ref.update({
              squareSubscriptionId: subscriptionId,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        } catch (e) {
          console.error('squareWebhook subscription.created error:', e.message);
        }
      }
    }
  }

  if (event.type === 'subscription.updated') {
    const sub = event.data?.object?.subscription;
    if (sub) {
      const status = (sub.status || '').toUpperCase();
      const isCanceled = status === 'CANCELED' || status === 'DEACTIVATED' || status === 'PAUSED';
      if (isCanceled) {
        const customerId = sub.customer_id || sub.customerId;
        if (customerId) {
          try {
            const snap = await db.collection('subscriptions')
              .where('squareCustomerId', '==', customerId).limit(1).get();
            if (!snap.empty) {
              const uid = snap.docs[0].data().uid;
              await db.collection('users').doc(uid).set(
                { plan: 'starter', planActive: false }, { merge: true }
              );
              await snap.docs[0].ref.update({
                status: 'canceled',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          } catch (e) {
            console.error('squareWebhook subscription.updated error:', e.message);
          }
        }
      }
    }
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
exports.initiateGoogleOAuth = onRequest({ invoker: 'public', secrets: ['GOOGLE_CLIENT_ID'] }, (req, res) => {
  const { businessId, uid, returnTo } = req.query;
  if (!businessId) { res.status(400).send('Missing businessId'); return; }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) { res.status(503).send('Google OAuth not configured. Set GOOGLE_CLIENT_ID secret.'); return; }
  const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/googleOAuthCallback';
  const scope = 'https://www.googleapis.com/auth/business.manage';
  const state = encodeURIComponent(JSON.stringify({ businessId, uid: uid || '', returnTo: returnTo || '' }));
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
exports.googleOAuthCallback = onRequest({ invoker: 'public', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.redirect('https://blastybiz-9523e.web.app/BlastyBiz-Connect.html?error=google'); return; }

  let businessId = '', uid = '', returnTo = '';
  try { const s = JSON.parse(decodeURIComponent(state)); businessId = s.businessId; uid = s.uid; returnTo = s.returnTo || ''; } catch(e) { businessId = state || ''; }
  const connectedRedirect = `https://blastybiz-9523e.web.app/BlastyBiz-Connected.html?connected=google${returnTo ? '&returnTo=' + encodeURIComponent(returnTo) : ''}`;
  const errorRedirect     = `https://blastybiz-9523e.web.app/BlastyBiz-Connected.html?error=google${returnTo ? '&returnTo=' + encodeURIComponent(returnTo) : ''}`;

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

    res.redirect(connectedRedirect);
  } catch(e) {
    console.error('googleOAuthCallback error:', e.response?.data || e.message);
    res.redirect(errorRedirect);
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
exports.initiateFacebookOAuth = onRequest({ invoker: 'public', secrets: ['FACEBOOK_APP_ID'] }, (req, res) => {
  const { businessId, uid, returnTo } = req.query;
  if (!businessId) { res.status(400).send('Missing businessId'); return; }
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) { res.status(503).send('Facebook OAuth not configured. Set FACEBOOK_APP_ID secret.'); return; }
  const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/facebookOAuthCallback';
  const scope = 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish';
  const state = encodeURIComponent(JSON.stringify({ businessId, uid: uid || '', returnTo: returnTo || '' }));
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
exports.facebookOAuthCallback = onRequest({ invoker: 'public', secrets: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.redirect('https://blastybiz-9523e.web.app/BlastyBiz-Connect.html?error=facebook'); return; }

  let businessId = '', uid = '', returnTo = '';
  try { const s = JSON.parse(decodeURIComponent(state)); businessId = s.businessId; uid = s.uid; returnTo = s.returnTo || ''; } catch(e) { businessId = state || ''; }
  const fbConnectedRedirect = `https://blastybiz-9523e.web.app/BlastyBiz-Connected.html?connected=facebook${returnTo ? '&returnTo=' + encodeURIComponent(returnTo) : ''}`;
  const fbErrorRedirect     = `https://blastybiz-9523e.web.app/BlastyBiz-Connected.html?error=facebook${returnTo ? '&returnTo=' + encodeURIComponent(returnTo) : ''}`;

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
    res.redirect(fbConnectedRedirect);
  } catch(e) {
    console.error('facebookOAuthCallback error:', e.response?.data || e.message);
    res.redirect(fbErrorRedirect);
  }
});

// ══════════════════════════════════════════
// Function 14: postToBing
// Bing Places has no public write API.
// Marks the job as manual_required with copy-paste instructions.
// ══════════════════════════════════════════
exports.postToBing = onRequest({ invoker: 'public' }, async (req, res) => {
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
exports.postToAppleMaps = onRequest({ invoker: 'public' }, async (req, res) => {
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

// ══════════════════════════════════════════
// Function 17: dispatchPublishJob
// Firestore trigger — publishJobs/{jobId} created
// Dispatches pending auto-post jobs to the right platform helper
// ══════════════════════════════════════════
exports.dispatchPublishJob = onDocumentCreated(
  { document: 'publishJobs/{jobId}', region: 'us-central1', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  async (event) => {
    const job   = event.data.data();
    const jobId = event.params.jobId;

    // Only process jobs that need auto-posting
    if (job.status !== 'pending') return;
    if (job.planGated) return; // starter plan — user sees copy-paste content instead

    // Idempotency guard: claim the job by moving to 'processing'
    await db.collection('publishJobs').doc(jobId).update({
      status: 'processing',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    try {
      const connSnap = await db.collection('platformConnections')
        .doc(`${job.businessId}_${job.platform}`).get();

      if (!connSnap.exists || connSnap.data().status !== 'connected') {
        await db.collection('publishJobs').doc(jobId).update({
          status: 'failed',
          adminError: `No connected ${job.platform} account for business ${job.businessId}`,
          customerVisibleMessage: `Your ${job.platform} account isn't connected. Go to Connect Platforms to link it.`,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
      }

      const conn = connSnap.data();
      let result;

      switch (job.platform) {
        case 'google':    result = await _publishGoogleJob(job, conn);    break;
        case 'facebook':  result = await _publishFacebookJob(job, conn);  break;
        case 'instagram': result = await _publishInstagramJob(job, conn); break;
        default:
          await db.collection('publishJobs').doc(jobId).update({
            status: 'failed',
            adminError: `Unknown auto-post platform: ${job.platform}`,
            customerVisibleMessage: 'Automatic posting is not available for this platform.',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          return;
      }

      await db.collection('publishJobs').doc(jobId).update({
        status: 'success',
        apiResponse: result,
        customerLabel: 'Published',
        customerVisibleMessage: `Your listing is live on ${job.platform}.`,
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    } catch(e) {
      console.error(`jobCreatedTrigger [${jobId}] failed:`, e.message);
      await db.collection('publishJobs').doc(jobId).update({
        status: 'failed',
        adminError: e.message,
        customerVisibleMessage: `There was a problem posting to ${job.platform}. Our team will follow up.`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }
);

// ══════════════════════════════════════════
// Function 18: onJobFailed
// Firestore trigger — publishJobs/{jobId} updated
// Sends failure email via Resend when status → 'failed'
// DISABLED: Firebase has conflicting HTTPS stubs; clean up via console then re-enable
// ══════════════════════════════════════════
/* DISABLED_TRIGGER_onPublishJobFailed
exports.onPublishJobFailed = onDocumentUpdated(
  { document: 'publishJobs/{jobId}', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    if (before.status === after.status || after.status !== 'failed') return;

    const uid = after.uid;
    if (!uid) return;
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return;
    const { email, ownerName } = userSnap.data();
    if (!email) return;

    const platformName = (after.platform || 'platform').replace(/_/g, ' ');
    await sendResendEmail({
      to: email,
      subject: `Action needed: Your ${platformName} post failed`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#1a1a1a">
          <h2 style="color:#0d1a0d;margin-bottom:8px">Your post needs attention</h2>
          <p style="color:#4a4a4a;line-height:1.6">Hi ${ownerName || 'there'},</p>
          <p style="color:#4a4a4a;line-height:1.6">
            Your listing for <strong style="text-transform:capitalize">${platformName}</strong>
            encountered an issue and couldn't be published automatically.
          </p>
          <div style="background:#fff8e1;border-left:4px solid #ffc107;padding:12px 16px;margin:20px 0;border-radius:4px">
            <strong>Error:</strong> ${after.adminError || after.customerVisibleMessage || 'Unknown error'}
          </div>
          <a href="https://blastybiz-9523e.web.app/BlastyBiz-Publishing-Status.html"
             style="display:inline-block;background:#00C853;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin:16px 0">
            View Publishing Status →
          </a>
          <p style="color:#888;font-size:12px;margin-top:24px">BlastyBiz · <a href="https://blastybiz-9523e.web.app" style="color:#888">blastybiz.com</a></p>
        </div>`,
    });
  }
);
DISABLED_TRIGGER_onPublishJobFailed */

// ══════════════════════════════════════════
// Function 18: onUserCreated
// Firestore trigger — users/{uid} created
// Sends welcome email via Resend
// DISABLED: Firebase has conflicting HTTPS stubs; clean up via console then re-enable
// ══════════════════════════════════════════
/* DISABLED_TRIGGER_onUserSignup
exports.onUserSignup = onDocumentCreated(
  { document: 'users/{uid}', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const data = event.data.data();
    const { email, ownerName } = data || {};
    if (!email) return;
    await sendResendEmail({
      to: email,
      subject: 'Welcome to BlastyBiz 🚀',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#1a1a1a">
          <h1 style="font-family:'Arial Black',sans-serif;color:#0d1a0d;font-size:28px;margin-bottom:4px">Welcome to BlastyBiz</h1>
          <p style="color:#00C853;font-weight:700;margin-bottom:24px;font-size:13px;letter-spacing:2px">LOCK. LOAD. BLAST.</p>
          <p style="color:#4a4a4a;line-height:1.6">Hi ${ownerName || 'there'}, you're in.</p>
          <p style="color:#4a4a4a;line-height:1.6">
            You're set up to blast your business across every platform. Here's how to get going:
          </p>
          <ol style="color:#4a4a4a;line-height:2.2;padding-left:20px">
            <li>Connect your platforms (Google, Facebook, Instagram)</li>
            <li>Fill out your business profile</li>
            <li>Create your first listing — AI adapts it for every platform</li>
            <li>Approve and blast</li>
          </ol>
          <a href="https://blastybiz-9523e.web.app/BlastyBiz-Dashboard.html"
             style="display:inline-block;background:#00C853;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;margin:20px 0">
            Go to Dashboard →
          </a>
          <p style="color:#888;font-size:12px;margin-top:24px">BlastyBiz · <a href="https://blastybiz-9523e.web.app" style="color:#888">blastybiz.com</a></p>
        </div>`,
    });
  }
);
DISABLED_TRIGGER_onUserSignup */

// ══════════════════════════════════════════
// Function 19: deleteAccount
// POST /deleteAccount  { idToken }
// Cancels Square sub, wipes all Firestore data, deletes Auth user
// ══════════════════════════════════════════
exports.deleteAccount = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_ACCESS_TOKEN'] }, async (req, res) => {
  setCors(res);
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
    // Cancel Square subscription if exists
    const subSnap = await db.collection('subscriptions').doc(uid).get();
    if (subSnap.exists) {
      const { squareSubscriptionId } = subSnap.data();
      if (squareSubscriptionId) {
        try { await getSquare().subscriptionsApi.cancelSubscription(squareSubscriptionId); } catch (_) {}
      }
    }

    // Collect all docs to delete
    const [bizSnap, draftsSnap, jobsSnap, connsSnap] = await Promise.all([
      db.collection('businesses').where('uid', '==', uid).get(),
      db.collection('listingDrafts').where('uid', '==', uid).get(),
      db.collection('publishJobs').where('uid', '==', uid).get(),
      db.collection('platformConnections').where('uid', '==', uid).get(),
    ]);

    const batch = db.batch();
    batch.delete(db.collection('users').doc(uid));
    batch.delete(db.collection('subscriptions').doc(uid));
    [...bizSnap.docs, ...draftsSnap.docs, ...jobsSnap.docs, ...connsSnap.docs]
      .forEach(d => batch.delete(d.ref));
    await batch.commit();

    // Delete Firebase Auth user last
    await admin.auth().deleteUser(uid);

    res.json({ success: true });
  } catch (e) {
    console.error('deleteAccount error:', e);
    res.status(500).json({ error: 'Delete failed: ' + e.message });
  }
});

// ── ADMIN: Browser-based secret manager ─────────────────────────────────────
exports.setOperatorSecret = onRequest({ invoker: 'public', cors: true }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

  let decoded;
  try { decoded = await admin.auth().verifyIdToken(idToken); }
  catch (e) { return res.status(401).json({ error: 'Invalid token' }); }

  if (decoded.email !== 'perceys@gmail.com') return res.status(403).json({ error: 'Forbidden' });

  const { name, value } = req.body;
  if (!name || !value) return res.status(400).json({ error: 'Missing name or value' });

  const ALLOWED = [
    'ANTHROPIC_API_KEY',
    'SQUARE_ACCESS_TOKEN','SQUARE_LOCATION_ID',
    'SQUARE_PRO_PLAN_ID','SQUARE_AGENCY_PLAN_ID','SQUARE_WEBHOOK_SIGNATURE_KEY',
    'GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
    'FACEBOOK_APP_ID','FACEBOOK_APP_SECRET','RESEND_API_KEY'
  ];
  if (!ALLOWED.includes(name)) return res.status(400).json({ error: 'Unknown secret name' });

  try {
    const tokenResp = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } }
    );
    const { access_token } = await tokenResp.json();
    const project = process.env.GCLOUD_PROJECT || 'blastybiz-9523e';
    const base = `https://secretmanager.googleapis.com/v1/projects/${project}`;
    const hdrs = { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' };

    // Create secret if it doesn't exist (409 = already exists — fine)
    const createResp = await fetch(`${base}/secrets?secretId=${name}`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ replication: { automatic: {} } })
    });
    if (!createResp.ok && createResp.status !== 409) {
      console.warn('createSecret non-fatal:', await createResp.text());
    }

    // Add new version
    const addResp = await fetch(`${base}/secrets/${name}:addVersion`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ payload: { data: Buffer.from(value).toString('base64') } })
    });
    if (!addResp.ok) {
      const err = await addResp.text();
      console.error('addVersion error:', err);
      return res.status(500).json({ error: 'Save failed: ' + err });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('setOperatorSecret error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════
// Admin endpoints — all require requireAdmin()
// ══════════════════════════════════════════

exports.adminListPublishJobs = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const { status, limit: lim = '100' } = req.query;
  const col = db.collection('publishJobs');
  const q = status
    ? col.where('status', '==', status).orderBy('createdAt', 'desc').limit(Number(lim))
    : col.orderBy('createdAt', 'desc').limit(Number(lim));
  const snap = await q.get();
  res.json({ jobs: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

exports.adminListFailedJobs = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const snap = await db.collection('publishJobs')
    .where('status', 'in', ['failed', 'manual_required', 'manual_followup'])
    .orderBy('createdAt', 'desc').limit(100).get();
  res.json({ jobs: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

exports.adminRetryJob = onRequest({ invoker: 'public', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const jobRef = db.collection('publishJobs').doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) return res.status(404).json({ error: 'Job not found' });
  const job = { ...jobSnap.data(), id: jobId };

  // Claim the job so concurrent retries don't double-fire
  await jobRef.update({
    status: 'processing',
    attempts: admin.firestore.FieldValue.increment(1),
    adminError: '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  try {
    const connSnap = await db.collection('platformConnections')
      .doc(`${job.businessId}_${job.platform}`).get();
    if (!connSnap.exists || connSnap.data().status !== 'connected') {
      await jobRef.update({
        status: 'failed',
        adminError: `No connected ${job.platform} account for business ${job.businessId}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.status(400).json({ error: 'Platform not connected' });
    }
    const conn = connSnap.data();
    let result;
    switch (job.platform) {
      case 'google':    result = await _publishGoogleJob(job, conn);    break;
      case 'facebook':  result = await _publishFacebookJob(job, conn);  break;
      case 'instagram': result = await _publishInstagramJob(job, conn); break;
      default:
        await jobRef.update({
          status: 'failed',
          adminError: `Unknown auto-post platform: ${job.platform}`,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return res.status(400).json({ error: 'Unknown platform' });
    }
    await jobRef.update({
      status: 'success',
      apiResponse: result,
      customerLabel: 'Published',
      customerVisibleMessage: `Your listing is live on ${job.platform}.`,
      publishedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true });
  } catch(e) {
    console.error(`adminRetryJob [${jobId}] failed:`, e.message);
    await jobRef.update({
      status: 'failed',
      adminError: e.message,
      customerVisibleMessage: `Retry failed for ${job.platform}. Check connection tokens.`,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(500).json({ error: e.message });
  }
});

exports.adminMarkManualFollowup = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  await db.collection('publishJobs').doc(jobId).update({
    status: 'manual_followup',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.json({ success: true });
});

exports.adminListBusinesses = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const snap = await db.collection('businesses').orderBy('createdAt', 'desc').limit(200).get();
  res.json({ businesses: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

exports.adminListPlatformConnections = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const snap = await db.collection('platformConnections').orderBy('connectedAt', 'desc').limit(200).get();
  res.json({ connections: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

exports.adminListActivityLogs = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const { uid } = req.query;
  const col = db.collection('activityLogs');
  const q = uid
    ? col.where('uid', '==', uid).orderBy('createdAt', 'desc').limit(100)
    : col.orderBy('createdAt', 'desc').limit(100);
  const snap = await q.get();
  res.json({ logs: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

exports.adminSubscriptionSummary = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const [usersSnap, subsSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('subscriptions').get(),
  ]);
  const planCounts = { starter: 0, pro: 0, agency: 0 };
  usersSnap.docs.forEach(d => {
    const p = d.data().plan || 'starter';
    planCounts[p] = (planCounts[p] || 0) + 1;
  });
  const pricingSnap = await db.collection('settings').doc('pricing').get();
  const pricingData = pricingSnap.exists ? pricingSnap.data() : {};
  const MRR_PRICES = { starter: 0, pro: pricingData.proMonthly || 19, agency: pricingData.agencyMonthly || 99 };
  const mrr = Object.entries(planCounts)
    .reduce((sum, [plan, count]) => sum + (MRR_PRICES[plan] || 0) * count, 0);
  res.json({
    planCounts, mrr,
    totalUsers: usersSnap.size,
    totalSubscriptions: subsSnap.size,
    asOf: new Date().toISOString(),
  });
});

// ══════════════════════════════════════════
// Function 30: adminUpdatePricing
// POST /adminUpdatePricing  { proMonthly, agencyMonthly }
// Admin-only: updates display prices in Firestore AND creates new Square
// subscription plans at those prices. Stores the new Square plan IDs so
// createCheckoutSession picks them up immediately.
// ══════════════════════════════════════════
// ══════════════════════════════════════════
// Function: suggestPlatforms
// POST /suggestPlatforms
// AI recommends which platforms to enable based on business info.
// API-connected platforms (google, facebook, instagram, bing) — AI evaluates fit.
// Manual-only platforms (fbmarket, craigslist, nextdoor, yelp, etc.) — AI uses
// category knowledge since no live data can be fetched yet.
// User toggles remain fully editable after suggestions are applied.
// ══════════════════════════════════════════
exports.suggestPlatforms = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { name, category, description, locationType, website } = req.body;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are a local business marketing expert. Based on the business info below, decide which platforms this business should target.

BUSINESS:
- Name: ${name || 'Local Business'}
- Category: ${category || 'General'}
- Description: ${description || 'No description provided'}
- Location type: ${locationType || 'physical'} (physical = fixed storefront or office, service_area = goes to customer, online = digital/remote only)
- Website: ${website || 'none'}

PLATFORMS TO EVALUATE:
- google: Google Business Profile (auto-post API available)
- facebook: Facebook Business Page (auto-post API available)
- instagram: Instagram Business (auto-post API available)
- bing: Bing Places (auto-post API available)
- nextdoor: Nextdoor (copy-paste only — blocks all third-party apps)
- fbmarket: Facebook Marketplace (copy-paste only — Meta closed API in 2018)
- craigslist: Craigslist (copy-paste only — no API ever)
- yelp: Yelp (copy-paste only)
- alignable: Alignable B2B local network (copy-paste only)
- thumbtack: Thumbtack service marketplace (copy-paste only)
- angi: Angi home services marketplace (copy-paste only)
- applemaps: Apple Maps Connect (copy-paste submission only)

DECISION RULES:
- google: almost always yes; no only for purely online businesses with zero local presence
- facebook: yes for B2C; optional for pure B2B
- instagram: yes for visual businesses (food, beauty, home services, events, fitness, retail, landscaping); no for unsexy services like accounting
- bing: yes when extra search coverage matters; skip for hyper-local informal or very small budget businesses
- nextdoor: yes for local service businesses that serve homeowners (cleaning, lawn care, plumbing, painting, etc.); no for B2B, restaurants, retail, or online-only
- fbmarket: yes for local goods and consumer services people shop for (furniture, appliances, handyman, moving, cleaning); no for professional services, B2B, or restaurants
- craigslist: yes for tradespeople, local services, rentals, items for sale; no for upscale/professional services or pure B2B
- yelp: yes for restaurants, cafes, salons, spas, auto repair, home services, gyms, and any consumer-facing local service; no for B2B
- alignable: yes for B2B or service businesses seeking local referral networks; no for pure B2C consumer retail
- thumbtack: yes for services where customers search and compare (cleaners, tutors, photographers, handyman, movers, DJ, etc.); no for retail or restaurants
- angi: yes ONLY for home services (plumbers, electricians, HVAC, roofers, painters, landscapers, handyman, pest control); no for everything else
- applemaps: yes for any physical location or service-area business; no for online-only

Return ONLY valid JSON, no markdown, no explanation:
{
  "suggestions": {
    "google":     { "enabled": true,  "reason": "max 7 words why" },
    "facebook":   { "enabled": true,  "reason": "max 7 words why" },
    "instagram":  { "enabled": false, "reason": "max 7 words why" },
    "bing":       { "enabled": true,  "reason": "max 7 words why" },
    "nextdoor":   { "enabled": false, "reason": "max 7 words why" },
    "fbmarket":   { "enabled": false, "reason": "max 7 words why" },
    "craigslist": { "enabled": false, "reason": "max 7 words why" },
    "yelp":       { "enabled": false, "reason": "max 7 words why" },
    "alignable":  { "enabled": false, "reason": "max 7 words why" },
    "thumbtack":  { "enabled": false, "reason": "max 7 words why" },
    "angi":       { "enabled": false, "reason": "max 7 words why" },
    "applemaps":  { "enabled": true,  "reason": "max 7 words why" }
  }
}`;

  try {
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
    });
    if (!aiResp.ok) { const t = await aiResp.text(); throw new Error(`Anthropic ${aiResp.status}: ${t.slice(0,200)}`); }
    const aiJson = await aiResp.json();
    const parsed = JSON.parse(aiJson.content[0].text.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch(e) {
    console.error('suggestPlatforms error:', e.message);
    res.status(500).json({ error: 'AI suggestion failed: ' + e.message });
  }
});

exports.adminUpdatePricing = onRequest({ invoker: 'public', secrets: ['SQUARE_ACCESS_TOKEN'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(403).json({ error: 'Forbidden' }); }
  const { proMonthly, agencyMonthly } = req.body;
  if (!proMonthly || !agencyMonthly) return res.status(400).json({ error: 'proMonthly and agencyMonthly required' });
  const pro    = parseFloat(proMonthly);
  const agency = parseFloat(agencyMonthly);
  if (isNaN(pro) || isNaN(agency) || pro < 0 || agency < 0) return res.status(400).json({ error: 'Invalid prices' });

  // Create new Square subscription plans at the given prices
  const { catalogApi } = getSquare();
  const ts = Date.now();

  let squareProPlanId, squareAgencyPlanId, squareError;
  try {
    const [proResult, agencyResult] = await Promise.all([
      catalogApi.upsertCatalogObject({
        idempotencyKey: `blastybiz-pro-${ts}`,
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: '#pro_plan',
          subscriptionPlanData: {
            name: `BlastyBiz Pro — $${pro}/mo`,
            phases: [{
              cadence: 'MONTHLY',
              recurringPriceMoney: { amount: BigInt(Math.round(pro * 100)), currency: 'USD' },
              ordinal: BigInt(0),
            }],
          },
        },
      }),
      catalogApi.upsertCatalogObject({
        idempotencyKey: `blastybiz-agency-${ts}`,
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: '#agency_plan',
          subscriptionPlanData: {
            name: `BlastyBiz Agency — $${agency}/mo`,
            phases: [{
              cadence: 'MONTHLY',
              recurringPriceMoney: { amount: BigInt(Math.round(agency * 100)), currency: 'USD' },
              ordinal: BigInt(0),
            }],
          },
        },
      }),
    ]);
    squareProPlanId    = proResult.result.catalogObject.id;
    squareAgencyPlanId = agencyResult.result.catalogObject.id;
  } catch (e) {
    squareError = e.message || String(e);
    console.error('[adminUpdatePricing] Square plan creation failed:', squareError);
  }

  // Always write to Firestore — even if Square failed, update display prices
  const update = {
    proMonthly: pro,
    agencyMonthly: agency,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (squareProPlanId)    update.squareProPlanId    = squareProPlanId;
  if (squareAgencyPlanId) update.squareAgencyPlanId = squareAgencyPlanId;
  await db.collection('settings').doc('pricing').set(update, { merge: true });

  res.json({
    ok: true,
    proMonthly: pro,
    agencyMonthly: agency,
    squareProPlanId:    squareProPlanId    || null,
    squareAgencyPlanId: squareAgencyPlanId || null,
    squareError:        squareError        || null,
  });
});
