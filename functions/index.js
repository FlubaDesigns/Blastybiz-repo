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
 *   firebase functions:secrets:set YELP_API_KEY
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
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
      body: JSON.stringify({ from: 'BlastyBiz <info@blastybiz.com>', to: [to], subject, html }),
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
    const { SquareClient, SquareEnvironment } = require('square');
    _square = new SquareClient({
      token: process.env.SQUARE_ACCESS_TOKEN,
      environment: SquareEnvironment.Production,
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
exports.generateEnrichmentQuestions = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { businessName, category, address, locationType, region, existingInsights } = req.body;
  const answered = (existingInsights || []).filter(i => i.answer);

  const prompt = `You are a local business marketing AI. Help me write more personal, specific posts for this business.

WHAT I KNOW:
- Business: ${businessName || 'Local business'}
- Category: ${category || 'General'}
- Location: ${locationType === 'online' ? `Online — serves ${region || 'nationwide'}` : (address || 'physical location')}
${answered.length ? '\nWHAT I ALREADY KNOW:\n' + answered.map(i => `Q: ${i.question}\nA: ${i.answer}`).join('\n') : ''}

Generate 2-3 SHORT, specific questions that would make my posts sound local and personal, not generic.

Good question types for physical businesses:
- Nearest intersection or landmark ("corner of Oak and 5th?")
- Most popular product/service or what regulars always order
- A tagline, phrase, or inside joke loyal customers use
- What makes them different from others nearby
- Upcoming events, specials, or seasonal things
- The owner's story or why they started

Good question types for online businesses:
- Biggest result or transformation they deliver for clients
- Specific niche they specialize in
- A client win story in one sentence
- What they hear most from happy customers
- Upcoming launches, offers, or announcements

Rules:
- Skip any topic already covered in answered questions
- Keep each question under 12 words
- Max 3 questions total
- Sound conversational, not corporate

Return ONLY valid JSON: { "questions": ["...", "...", "..."] }`;

  try {
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!aiResp.ok) throw new Error(`Anthropic ${aiResp.status}: ${await aiResp.text()}`);
    const aiJson = await aiResp.json();
    const parsed = JSON.parse(aiJson.content[0].text.replace(/```json|```/g, '').trim());
    res.json({ questions: parsed.questions || [] });
  } catch(e) {
    console.error('generateEnrichmentQuestions error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

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

  const platformList = (platforms || []).map(p => ({
    id: p.id, name: p.name, type: p.type,
    rules: PLATFORM_RULES[p.id] || {}
  }));

  const { aiContext } = listing;
  const aiContextBlock = (() => {
    if (!aiContext) return '';
    const lines = [];
    if (aiContext.story)     lines.push(`Story & History: ${aiContext.story}`);
    if (aiContext.different) lines.push(`What Makes Them Different: ${aiContext.different}`);
    if (aiContext.awards)    lines.push(`Awards & Recognition: ${aiContext.awards}`);
    if (aiContext.customer)  lines.push(`Ideal Customer: ${aiContext.customer}`);
    if (aiContext.other)     lines.push(`Additional Context: ${aiContext.other}`);
    if (!lines.length) return '';
    return '\nBUSINESS BACKGROUND (this is the owner\'s voice — read carefully and weave this authenticity into every platform\'s copy naturally):\n' + lines.join('\n');
  })();

  const prompt = `You are a local business marketing expert. Adapt the following business listing for each platform listed. Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

BUSINESS INFO:
- Name: ${listing.name || 'Local Business'}
- Category: ${listing.category || 'General'}
- Description: ${listing.offer}
- Price/Range: ${listing.price || 'not specified'}
- Phone: ${listing.phone || 'not provided'}
- Location type: ${listing.locationType === 'online' ? 'Online only' : 'Physical location'}
- Address/Area: ${listing.locationType === 'online' ? (listing.region ? 'Serves: ' + listing.region : 'Online — no physical address') : (listing.address || 'not provided')}
- Website: ${listing.website || 'none'}
- Hours: ${listing.hours || 'not provided'}
- Images attached: ${listing.imageCount > 0 ? listing.imageCount + ' photo(s)' : 'none'}
- Preferred tone: ${tone}
${aiContextBlock}${(listing.bizInsights||[]).length ? '\nBUSINESS PERSONALITY & LOCAL DETAILS (use these to make copy personal and specific — reference them naturally):\n' + listing.bizInsights.map(i=>`- ${i.question}: ${i.answer}`).join('\n') : ''}${(listing.bizAnnouncements||[]).length ? '\nUPCOMING EVENTS / PROMOTIONS (weave into every platform\'s copy naturally — do NOT ignore these):\n' + listing.bizAnnouncements.map(a=>`- ${a.text}${a.endDate?' (active until '+a.endDate+')':''}`).join('\n') : ''}
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

  const { businessName, ownerName, city, state, description, specialNotes, followUpAnswers, platformCatLists, locationType } = req.body;

  const platformContext = {
    fbmarket:   'Facebook Marketplace — consumer marketplace for buying/selling goods and booking local services',
    craigslist: 'Craigslist — classified ads for goods and services; pick the Services sub-category for service businesses, For Sale for product sellers',
    yelp:       'Yelp — local business discovery and reviews; used by consumers searching for restaurants, salons, contractors, and other local businesses',
    thumbtack:  'Thumbtack — platform for hiring local professionals and skilled tradespeople for specific jobs',
    angi:       'Angi (formerly Angie\'s List) — home services and contractor marketplace; focused on residential repair, remodeling, and maintenance',
    alignable:  'Alignable — B2B local business networking; categories describe the business\'s industry to other local business owners',
    applemaps:  'Apple Maps — physical location discovery; pick the place type that best describes where customers go'
  };

  const platformBlocks = Object.entries(platformCatLists).map(([id, cats]) => {
    const ctx = platformContext[id] || id;
    return `PLATFORM: ${id}\nPURPOSE: ${ctx}\nCATEGORIES (pick EXACTLY one, copy the string character-for-character):\n${cats.join(' | ')}`;
  }).join('\n\n');

  const locationLabel = locationType === 'online' ? 'Online only (no physical storefront)' :
                        locationType === 'both'   ? 'Physical location + online presence' :
                        'Physical location / storefront';

  const contextLines = [
    businessName  ? `Business Name: ${businessName}`   : null,
    ownerName     ? `Owner: ${ownerName}`               : null,
    (city || state) ? `Location: ${[city, state].filter(Boolean).join(', ')}` : null,
    locationType  ? `Business Type: ${locationLabel}`   : null,
    description   ? `Description: ${description}`       : null,
    specialNotes  ? `Special Notes: ${specialNotes}`    : null,
  ].filter(Boolean).join('\n');

  const isSecondPass = Array.isArray(followUpAnswers) && followUpAnswers.length > 0;

  const followUpBlock = isSecondPass
    ? '\n\nADDITIONAL CONTEXT (user answered your clarifying questions):\n' +
      followUpAnswers.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join('\n')
    : '';

  const returnInstructions = isSecondPass
    ? `You now have full context including the user's answers. You MUST return final category picks — do NOT ask more questions.
Return ONLY valid JSON, no markdown fences, no explanation:
{ "categories": { "platformId": "exact category string" } }`
    : `If you have enough context to confidently pick categories for ALL platforms, return ONLY:
{ "categories": { "platformId": "exact category string" } }

If the description is too vague to confidently classify the business, return ONLY:
{ "followUpQuestions": ["short question 1", "short question 2"] }
(1–3 short questions, plain English, no markdown)`;

  const prompt = `You are a local business categorization expert. Your task is to pick the single best-matching category for a local business on each marketing platform listed below.

BUSINESS CONTEXT:
${contextLines}${followUpBlock}

INSTRUCTIONS:
1. Read the PURPOSE of each platform carefully — it tells you what kind of businesses and customers use it.
2. Think about which category a customer or the platform itself would use to classify this business.
3. Pick ONE category per platform from the provided list.
4. CRITICAL: Copy the category string EXACTLY as it appears — same capitalization, same punctuation, same spacing. Do not paraphrase, abbreviate, or modify it in any way.
5. If no category is a perfect match, pick the closest one. Never invent a new category.

${returnInstructions}

${platformBlocks}`;

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
exports.approvePendingPost = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { pendingPostId } = req.body;
  if (!pendingPostId) return res.status(400).json({ error: 'pendingPostId required' });

  const postRef = db.collection('pendingPosts').doc(pendingPostId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) return res.status(404).json({ error: 'Not found' });

  const post = postSnap.data();
  if (post.uid !== decoded.uid) return res.status(403).json({ error: 'Forbidden' });
  if (post.status !== 'pending') return res.status(409).json({ error: 'Already processed' });

  const { adaptations, platforms, tone, bizId } = post;

  // Look up plan
  let plan = 'starter';
  try {
    const userSnap = await db.collection('users').doc(decoded.uid).get();
    if (userSnap.exists) plan = userSnap.data().plan || 'starter';
  } catch(e) {}
  const isStarter = plan === 'starter';

  const batch = db.batch();
  for (const p of (platforms || [])) {
    const content = (adaptations || {})[p.id];
    if (!content) continue;
    const isManual = p.type === 'manual' || isStarter;
    const jobRef = db.collection('publishJobs').doc();
    batch.set(jobRef, {
      jobId: jobRef.id, businessId: bizId, uid: decoded.uid,
      platform: p.id, platformName: p.name || p.id,
      capabilityLevel: p.type === 'api' ? 'full_api' : 'manual_assisted',
      jobType: 'scheduled_approved',
      status: isManual ? 'manual_required' : 'pending',
      attempts: 0, maxAttempts: 3,
      customerLabel: isManual ? 'Action needed' : 'Waiting to publish',
      customerVisibleMessage: isManual
        ? `Your approved ${p.name || p.id} post is ready — copy it below.`
        : `Your approved ${p.name || p.id} post is waiting to publish.`,
      planGated: isStarter && p.type === 'api',
      payload: { adaptedContent: content },
      apiResponse: {}, customerNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  batch.update(postRef, { status: 'approved', approvedAt: admin.firestore.FieldValue.serverTimestamp() });
  await batch.commit();

  res.json({ ok: true });
});

exports.approveDraft = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { draftId, businessId, platforms } = req.body;
  const uid = decoded.uid;

  // Check user plan — starter users can't auto-post via API platforms
  let userPlan = 'starter';
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.exists) userPlan = userSnap.data().plan || 'starter';
  } catch(e) { console.warn('approveDraft: users read failed, defaulting to starter:', e.message); }
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
  const content   = job.payload?.adaptedContent || '';
  const imageUrls = job.payload?.imageUrls || [];
  // v1 Business Profile Postings API (mybusiness v4 was deprecated 2022)
  async function tryPost(token) {
    return axios.post(
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
  // Instagram requires an image — fall back to manual_required if none supplied
  if (!imageUrl) {
    return { manualFallback: true, reason: 'no_image',
             message: 'Instagram posts require an image. Copy your caption and post it manually.' };
  }
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
  // Read prices from Firestore (written by adminUpdatePricing) — fall back to defaults
  let proMonthly = 49, agencyMonthly = 149;
  try {
    const pricingSnap = await db.collection('settings').doc('pricing').get();
    if (pricingSnap.exists) {
      const d = pricingSnap.data();
      if (d.proMonthly)    proMonthly    = d.proMonthly;
      if (d.agencyMonthly) agencyMonthly = d.agencyMonthly;
    }
  } catch(e) {
    console.warn('createCheckoutSession: Firestore pricing read failed, using defaults:', e.message);
  }
  const planNames  = { pro: 'BlastyBiz Pro',    agency: 'BlastyBiz Agency' };
  const planPrices = { pro: proMonthly, agency: agencyMonthly };
  if (!planPrices[plan]) return res.status(400).json({ error: 'Invalid plan' });
  const response = await getSquare().checkout.paymentLinks.create({
    idempotencyKey: `checkout-${uid}-${plan}-${Date.now()}`,
    quickPay: {
      name: planNames[plan],
      priceMoney: { amount: BigInt(Math.round(planPrices[plan] * 100)), currency: 'USD' },
      locationId: process.env.SQUARE_LOCATION_ID,
    },
    checkoutOptions: {
      redirectUrl: `https://blastybiz-9523e.web.app/BlastyBiz-Dashboard.html?success=1`,
      merchantSupportEmail: 'info@blastybiz.com',
    },
    prePopulatedData: { buyerEmail: email },
  });
  res.json({ url: response.paymentLink.url });
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
  res.json({ url: 'mailto:info@blastybiz.com?subject=Manage%20BlastyBiz%20Subscription' });
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
      const orderResp = await getSquare().orders.get({ orderId });
      const uid = orderResp.order?.referenceId;
      if (!uid) return res.json({ received: true });
      const lineItems = orderResp.order?.lineItems || [];
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

      // Instagram may return a manual fallback when no image is present
      if (result?.manualFallback) {
        await db.collection('publishJobs').doc(jobId).update({
          status: 'manual_required',
          customerVisibleMessage: result.message || 'Please post this manually.',
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
// Function 18: jobFailedTrigger
// Firestore trigger — publishJobs/{jobId} updated
// Sends failure email via Resend when status → 'failed'
// ══════════════════════════════════════════
exports.jobFailedTrigger = onDocumentUpdated(
  { document: 'publishJobs/{jobId}', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    if (before.status === after.status || after.status !== 'failed') return;

    const uid = after.uid;
    if (!uid) return;
    let email, ownerName;
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) return;
      ({ email, ownerName } = userSnap.data());
    } catch(e) { console.warn('jobFailedTrigger: users read failed:', e.message); return; }
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

// ══════════════════════════════════════════
// Function 19: userCreatedTrigger
// Firestore trigger — users/{uid} created
// Sends welcome email via Resend
// ══════════════════════════════════════════
exports.userCreatedTrigger = onDocumentCreated(
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

// ══════════════════════════════════════════
// Function 20: deleteAccount
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
        try { await getSquare().subscriptions.cancel({ subscriptionId: squareSubscriptionId }); } catch (_) {}
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
  const MRR_PRICES = { starter: 0, pro: pricingData.proMonthly || 49, agency: pricingData.agencyMonthly || 149 };
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

exports.sendTestEmail = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(403).json({ error: 'Forbidden' }); }
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'to address required' });
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 'placeholder') return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'BlastyBiz <info@blastybiz.com>',
        to: [to],
        subject: '✅ BlastyBiz Email Test',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#070D07;color:#EEF7EE;border-radius:12px">
          <h1 style="font-size:28px;color:#00C853;margin:0 0 8px">BlastyBiz</h1>
          <p style="font-size:16px;color:#7AB87A;margin:0 0 24px">Lock. Load. Blast.</p>
          <p style="font-size:15px;line-height:1.6;color:#EEF7EE">This is a test email confirming that your Resend integration is working correctly. Emails from BlastyBiz will send from <strong>info@blastybiz.com</strong>.</p>
          <p style="font-size:13px;color:#587058;margin-top:24px">Sent from BlastyBiz Admin · Powered by Fluba Designs LLC</p>
        </div>`
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || 'Resend error', detail: data });
    return res.json({ ok: true, id: data.id, to });
  } catch(e) {
    return res.status(500).json({ error: e.message });
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
  const catalog = getSquare().catalog;
  const ts = Date.now();

  let squareProPlanId, squareAgencyPlanId, squareError;
  try {
    const [proResult, agencyResult] = await Promise.all([
      catalog.object.upsert({
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
      catalog.object.upsert({
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
    squareProPlanId    = proResult.catalogObject?.id;
    squareAgencyPlanId = agencyResult.catalogObject?.id;
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

// ── Yelp Category Cache ────────────────────────────────────────────────────────
async function fetchAndCacheYelpCategories() {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) {
    throw new Error('YELP_API_KEY secret is not configured');
  }

  const resp = await fetch('https://api.yelp.com/v3/categories?locale=en_US', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Yelp API error ${resp.status}: ${text}`);
  }
  const data = await resp.json();

  const cats = (data.categories || [])
    .filter(c => {
      if (c.country_whitelist && c.country_whitelist.length > 0 && !c.country_whitelist.includes('US')) return false;
      if (c.country_blacklist && c.country_blacklist.includes('US')) return false;
      return true;
    })
    .map(c => c.title)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  await db.collection('platformCategoryCache').doc('yelp').set({
    cats,
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: 'yelp_api',
    count: cats.length,
  });

  console.log(`[yelpCategories] Cached ${cats.length} categories`);
  return cats;
}

exports.refreshYelpCategories = onRequest(
  { invoker: 'public', region: 'us-central1', secrets: ['YELP_API_KEY'] },
  async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    try {
      await requireAdmin(req);
    } catch (e) {
      return res.status(e.status || 403).json({ error: e.message });
    }
    try {
      const cats = await fetchAndCacheYelpCategories();
      res.json({ ok: true, count: cats.length });
    } catch (e) {
      console.error('[refreshYelpCategories]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ══════════════════════════════════════════
// scheduledPostingCheck
// Runs hourly — finds businesses with active schedules due to post,
// generates adapted content via Claude, creates publishJobs.
// ══════════════════════════════════════════

const SCHED_PLATFORMS = [
  { id: 'google',    name: 'Google Business',    type: 'api'    },
  { id: 'facebook',  name: 'Facebook Business',  type: 'api'    },
  { id: 'instagram', name: 'Instagram Business', type: 'api'    },
  { id: 'nextdoor',  name: 'Nextdoor',           type: 'manual' },
  { id: 'fbmarket',  name: 'Facebook Marketplace', type: 'manual' },
  { id: 'craigslist',name: 'Craigslist',         type: 'manual' },
  { id: 'yelp',      name: 'Yelp',               type: 'manual' },
  { id: 'alignable', name: 'Alignable',          type: 'manual' },
  { id: 'thumbtack', name: 'Thumbtack',          type: 'manual' },
  { id: 'angi',      name: 'Angi',               type: 'manual' },
  { id: 'applemaps', name: 'Apple Maps Connect', type: 'manual' },
];

function _computeNextRunAt(sched, fromDate) {
  const tz = sched.timezone || 'America/New_York';
  const slotHour = { morning: 9, midday: 12, afternoon: 15, evening: 18 }[sched.timeSlot || 'morning'];
  const from = fromDate || new Date();

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(from);
  const gp = (t) => parseInt(parts.find(p => p.type === t)?.value || '0');
  const lYear = gp('year'), lMonth = gp('month') - 1, lDay = gp('day'), lHour = gp('hour');
  const lDow = new Date(lYear, lMonth, lDay).getDay();

  let candYear = lYear, candMonth = lMonth, candDay = lDay;

  if (sched.frequency === 'monthly') {
    const dom = sched.dayOfMonth || 1;
    if (lDay < dom || (lDay === dom && lHour < slotHour)) {
      candDay = dom;
    } else {
      const d = new Date(lYear, lMonth + 1, dom);
      candYear = d.getFullYear(); candMonth = d.getMonth(); candDay = d.getDate();
    }
  } else {
    const targetDow = sched.dayOfWeek ?? 1;
    let ahead = (targetDow - lDow + 7) % 7;
    if (ahead === 0 && lHour >= slotHour) ahead = sched.frequency === 'biweekly' ? 14 : 7;
    else if (sched.frequency === 'biweekly' && ahead > 0 && ahead < 7) ahead += 7;
    const d = new Date(lYear, lMonth, lDay + ahead);
    candYear = d.getFullYear(); candMonth = d.getMonth(); candDay = d.getDate();
  }

  // Convert local calendar time → UTC
  const approx = new Date(candYear, candMonth, candDay, slotHour, 0, 0);
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(approx);
  const tgp = (t) => parseInt(tzParts.find(p => p.type === t)?.value || '0');
  const tzLocalMs = Date.UTC(tgp('year'), tgp('month') - 1, tgp('day'), tgp('hour'), tgp('minute'), 0);
  return new Date(approx.getTime() + (approx.getTime() - tzLocalMs));
}

async function _runScheduledPost(bizId, biz) {
  const sched    = biz.postingSchedule;
  const bizName  = biz.businessName || biz.name || 'Local Business';
  const tone     = biz.tone || 'friendly';
  const address  = biz.address || (biz.city ? `${biz.city}, ${biz.state}` : '');
  const locType  = biz.locationType || 'physical';
  const region   = biz.region || '';

  // Build a "what we offer" summary from profile
  const offerLines = [
    biz.category ? `Category: ${biz.category}` : '',
    biz.offer || biz.description || '',
    biz.specialNotes ? `Notes: ${biz.specialNotes}` : '',
    biz.hours ? `Hours: ${biz.hours}` : '',
  ].filter(Boolean).join('\n');

  // Look up which platforms are connected for this business
  const connSnap = await db.collection('platformConnections')
    .where('businessId', '==', bizId).where('status', '==', 'connected').get();
  const connectedIds = new Set(connSnap.docs.map(d => d.data().platform));

  const activePlatforms = SCHED_PLATFORMS.filter(p =>
    connectedIds.has(p.id) || p.type === 'manual'
  );
  if (!activePlatforms.length) return;

  const platformCats = biz.platformCats || {};

  const platformList = activePlatforms.map(p => ({
    ...p, rules: PLATFORM_RULES[p.id] || {},
    cat: platformCats[p.id] ? ` (category: ${platformCats[p.id]})` : '',
  }));

  const prompt = `You are a local business marketing expert. Generate a fresh recurring post for each platform. This is an automated scheduled post — make it feel current and engaging, not stale.

BUSINESS INFO:
- Name: ${bizName}
- Category: ${biz.category || 'General'}
- Description: ${offerLines || 'A great local business'}
- Phone: ${biz.phone || 'not provided'}
- Location type: ${locType === 'online' ? 'Online only' : 'Physical location'}
- Address/Area: ${locType === 'online' ? (region ? 'Serves: ' + region : 'Online') : (address || 'not provided')}
- Website: ${biz.website || 'none'}
- Hours: ${biz.hours || 'not provided'}
- Preferred tone: ${tone}
${(biz.bizInsights||[]).filter(i=>i.answer).length ? '\nBUSINESS PERSONALITY & LOCAL DETAILS (use to make copy personal and specific):\n' + biz.bizInsights.filter(i=>i.answer).map(i=>`- ${i.question}: ${i.answer}`).join('\n') : ''}${(biz.bizAnnouncements||[]).length ? '\nUPCOMING EVENTS / PROMOTIONS (weave into every platform\'s copy — do NOT ignore these):\n' + biz.bizAnnouncements.map(a=>`- ${a.text}${a.endDate?' (active until '+a.endDate+')':''}`).join('\n') : ''}
PLATFORMS:
${platformList.map(p => `- ${p.id}: ${p.name}${p.cat}${p.rules.maxChars ? ', max ' + p.rules.maxChars + ' chars' : ''}${p.rules.notes ? ', note: ' + p.rules.notes : ''}`).join('\n')}

Return ONLY valid JSON: { "adaptations": { "PLATFORM_ID": "text" } }`;

  const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!aiResp.ok) throw new Error(`Anthropic ${aiResp.status}: ${await aiResp.text()}`);
  const aiJson  = await aiResp.json();
  const parsed  = JSON.parse(aiJson.content[0].text.replace(/```json|```/g, '').trim());
  const adapted = parsed.adaptations || {};

  // If owner wants to review before posting — save draft to pendingPosts and stop
  if (sched.requireApproval) {
    await db.collection('pendingPosts').add({
      bizId,
      uid: biz.uid || '',
      status: 'pending',
      adaptations: adapted,
      platforms: activePlatforms,
      tone,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[scheduledPost] biz ${bizId} — requireApproval=true, saved to pendingPosts`);
    return;
  }

  // Get user plan to determine manual vs auto-post
  const uid = biz.uid || '';
  let plan = 'starter';
  if (uid) {
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      if (userSnap.exists) plan = userSnap.data().plan || 'starter';
    } catch(e) { console.warn('_runScheduledPost: users read failed, defaulting to starter:', e.message); }
  }
  const isStarter = plan === 'starter';

  const batch = db.batch();
  for (const p of activePlatforms) {
    const content = adapted[p.id];
    if (!content) continue;
    const isManual = p.type === 'manual' || isStarter;
    const jobRef = db.collection('publishJobs').doc();
    batch.set(jobRef, {
      jobId: jobRef.id, businessId: bizId, uid,
      platform: p.id,
      capabilityLevel: p.type === 'api' ? 'full_api' : 'manual_assisted',
      jobType: 'scheduled_post',
      status: isManual ? 'manual_required' : 'pending',
      attempts: 0, maxAttempts: 3,
      customerLabel: isManual ? 'Action needed' : 'Waiting to publish',
      customerVisibleMessage: isManual
        ? `Your scheduled ${p.name} post is ready — copy it below.`
        : `Your scheduled ${p.name} post is waiting to publish.`,
      planGated: isStarter && p.type === 'api',
      payload: { adaptedContent: content },
      apiResponse: {}, customerNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

exports.scheduledPostingCheck = onSchedule(
  { schedule: 'every 1 hours', region: 'us-central1', secrets: ['ANTHROPIC_API_KEY'] },
  async () => {
    const now = new Date();
    const snap = await db.collection('businesses')
      .where('postingSchedule.enabled', '==', true)
      .get();

    for (const bizDoc of snap.docs) {
      const biz   = bizDoc.data();
      const bizId = bizDoc.id;
      const sched = biz.postingSchedule;
      if (!sched?.nextRunAt) continue;

      const nextRun = sched.nextRunAt.toDate ? sched.nextRunAt.toDate() : new Date(sched.nextRunAt);
      if (nextRun > now) continue; // not yet time

      try {
        await _runScheduledPost(bizId, biz);

        const next = _computeNextRunAt(sched, now);
        await bizDoc.ref.update({
          'postingSchedule.lastRunAt':  admin.firestore.FieldValue.serverTimestamp(),
          'postingSchedule.nextRunAt':  admin.firestore.Timestamp.fromDate(next),
          'postingSchedule.updatedAt':  admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[scheduledPostingCheck] Posted for biz ${bizId}, next run: ${next.toISOString()}`);
      } catch (e) {
        console.error(`[scheduledPostingCheck] biz ${bizId} failed:`, e.message);
      }
    }
  }
);

exports.scheduledYelpCategoryRefresh = onSchedule(
  { schedule: 'every monday 03:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['YELP_API_KEY'] },
  async () => {
    try {
      await fetchAndCacheYelpCategories();
    } catch (e) {
      console.error('[scheduledYelpCategoryRefresh]', e.message);
    }
  }
);
