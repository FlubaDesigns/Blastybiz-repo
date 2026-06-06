/**
 * BlastyBiz — Firebase Cloud Functions
 * Deploy with: firebase deploy --only functions
 * Requires Blaze (pay-as-you-go) plan
 *
 * Set environment variables with:
 * firebase functions:config:set anthropic.key="sk-ant-..." stripe.secret_key="sk_live_..." etc.
 */

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
exports.adaptListing = onRequest(async (req, res) => {
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
exports.resolveCategories = onRequest(async (req, res) => {
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
    pro:    process.env.STRIPE_PRO_PRICE_ID,    // $19/month
    agency: process.env.STRIPE_AGENCY_PRICE_ID  // $99/month
  };
  const session = await stripe.checkout.sessions.create({
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
  const event = stripe.webhooks.constructEvent(
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
