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

// ── Base URL for all web-app redirects (checkout, OAuth, emails) ──────────────
// Set APP_BASE_URL env var when adding a custom domain so all redirects update
// without a code change. Falls back to Firebase default domain.
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://blastybiz-9523e.web.app';
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

// ── Subcollection path helpers ─────────────────────────────────────────────────
function userBizRef(uid, bizId) { return db.collection('users').doc(uid).collection('businesses').doc(bizId); }
function userBizCol(uid) { return db.collection('users').doc(uid).collection('businesses'); }
function userBizDraftsRef(uid, bizId) { return userBizRef(uid, bizId).collection('listingDrafts'); }
function userBizJobsRef(uid, bizId)   { return userBizRef(uid, bizId).collection('publishJobs'); }
function userBizPostsRef(uid, bizId)  { return userBizRef(uid, bizId).collection('pendingPosts'); }
function userBizConnsRef(uid, bizId)  { return userBizRef(uid, bizId).collection('platformConnections'); }

// ── AI cost tracking ──────────────────────────────────────────────────────────
// Prices per million tokens (update if Anthropic changes rates)
const AI_COSTS = {
  'claude-haiku-4-5':           { input: 0.80, output: 4.00 },
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
};
async function trackAiUsage(uid, fnName, model, usage, opts = {}) {
  const { failureType = null, timing = null, context = null } = opts;
  if (!usage && !failureType) return;
  try {
    const rates = AI_COSTS[model] || { input: 3.00, output: 15.00 };
    const costUsd = usage
      ? ((usage.input_tokens || 0) * rates.input + (usage.output_tokens || 0) * rates.output) / 1_000_000
      : 0;
    await db.collection('aiUsageLogs').add({
      uid:          uid || 'system',
      fn:           fnName,
      model,
      inputTokens:  usage?.input_tokens  || 0,
      outputTokens: usage?.output_tokens || 0,
      costUsd,
      failureType:  failureType || null,
      aiElapsedMs:  timing?.aiElapsedMs  || null,
      fnElapsedMs:  timing?.fnElapsedMs  || null,
      businessId:   context?.businessId  || null,
      campaignId:   context?.campaignId  || null,
      scheduleId:   context?.scheduleId  || null,
      ts: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[trackAiUsage] failed:', e.message);
  }
}

// ── reserveAiAction — atomic AI usage gate ────────────────────────────────────
// Reads current usage, checks against plan cap, and atomically increments the
// counter — all in one Firestore transaction. Call AFTER dedup checks (so cached
// hits return for free) and BEFORE the Anthropic API call.
// Throws { message: 'LIMIT_REACHED', used, cap, plan } if at cap.
async function reserveAiAction(uid) {
  return db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const snap    = await tx.get(userRef);
    const data    = snap.exists ? snap.data() : {};
    const plan    = data.plan || 'starter';
    const cap     = AI_LIMITS[plan] || AI_LIMITS.starter;
    const resetAt = data.aiActionsResetAt?.toDate?.() || null;
    const now     = new Date();
    const needsReset = !resetAt || now > resetAt;
    const used    = needsReset ? 0 : (data.aiActionsUsed || 0);

    if (used >= cap) {
      throw Object.assign(new Error('LIMIT_REACHED'), { used, cap, plan });
    }

    if (needsReset) {
      tx.update(userRef, {
        aiActionsUsed: 1,
        aiActionsResetAt: admin.firestore.Timestamp.fromDate(
          new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        ),
      });
    } else {
      tx.update(userRef, {
        aiActionsUsed: admin.firestore.FieldValue.increment(1),
      });
    }

    return { plan, used: used + 1, cap };
  });
}

// ── fetchWithTimeout — wraps fetch() with a 25s AbortController timeout ──────
// Throws AbortError on timeout; all other errors pass through unchanged.
// ⚠ REQUIRED OPS STEP: Create a Firestore TTL policy on the aiRequestDedup
//   collection using the `expiresAt` field (30 min) in Firebase Console →
//   Firestore → TTL policies so dedup docs auto-expire without manual cleanup.
async function fetchWithTimeout(url, options, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── classifyAiError — maps caught errors to structured failureType strings ────
function classifyAiError(e) {
  if (e.name === 'AbortError')                               return 'anthropic_timeout';
  if (e.name === 'SyntaxError')                              return 'json_parse';
  if (e._isHttpError)                                        return 'anthropic_http';
  if (/network|fetch/i.test(e.message))                      return 'network_error';
  if (/firebase|firestore/i.test(e.message))                 return 'firebase_error';
  return 'unknown';
}

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

// Bootstrap admin — always has access regardless of Firestore config.
// Additional admins are managed via config/admins in Firestore (Admin-Operate.html).
const BOOTSTRAP_ADMIN_EMAILS = ['info@blastybiz.com'];

async function getAdminEmails() {
  try {
    const snap = await db.collection('config').doc('admins').get();
    if (snap.exists) {
      const extra = snap.data().emails || [];
      return [...new Set([...BOOTSTRAP_ADMIN_EMAILS, ...extra])];
    }
  } catch(e) { /* fall through to bootstrap list */ }
  return BOOTSTRAP_ADMIN_EMAILS;
}

async function requireAdmin(req) {
  const decoded = await verifyBearer(req);
  const adminEmails = await getAdminEmails();
  if (!adminEmails.includes(decoded.email)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  return decoded;
}

// HMAC-signed unsubscribe tokens — prevents forging by base64-encoding a uid
function makeUnsubSig(uid, secret) {
  return crypto.createHmac('sha256', secret).update(uid).digest('hex');
}

// ── AI usage limits (actions per month by plan) ──────────────────────────────
const AI_LIMITS = { starter: 10, pro: 100, agency: 500 };

// ── Canonical job status values ───────────────────────────────────────────────
const JOB_STATUS = {
  PENDING:            'pending',
  PROCESSING:         'processing',
  SUCCESS:            'success',
  FAILED:             'failed',
  MANUAL_REQUIRED:    'manual_required',
  MANUAL_FOLLOWUP:    'manual_followup',
  MANUAL_COMPLETED:   'manual_completed',
  CLOSED:             'closed',
};

const PLATFORM_DOCS = {
  google: {
    name:'Google Business Profile', purpose:'Local search — customers finding you via Google Maps and Search',
    maxChars:750, format:'Business description. Plain text only. No markdown, no links.',
    tone:'Professional, informative, keyword-aware but natural',
    dos:['Include primary service keywords in the first sentence','Mention your city or neighborhood for local SEO','State what makes you different from competitors','Include specialty, experience level, or credentials'],
    donts:['No "best in town" or superlatives — Google may suppress','No URLs or phone numbers — they are stripped from descriptions','No emoji','No all-caps','No competitor names'],
    images:{recommended:true, notes:'Cover photo (16:9), logo (1:1), interior/exterior and product shots. JPG or PNG, max 5MB each.'}
  },
  facebook: {
    name:'Facebook Business Page', purpose:'Social feed — customers who follow or discover the page',
    maxChars:2000, format:'Post body. No separate title field. Supports emoji, line breaks, casual formatting.',
    tone:'Friendly, conversational, engaging — write like a person not a press release',
    dos:['Lead with a hook or question in the first line','Use 1-3 emoji naturally','Include a clear CTA (call, message, book, visit)','Use short paragraphs — mobile readers scan fast','Mention specific details like price, time, or a name to feel real'],
    donts:['No walls of text','Avoid over-hashtagging — 1-2 max or none','No generic openers like "We are excited to announce"','No all-caps','No excessive punctuation!!!'],
    images:{recommended:true, notes:'Single image or carousel (up to 10). Landscape 1200×630px for link posts. Square 1080×1080px for organic feed posts.'}
  },
  instagram: {
    name:'Instagram', purpose:'Visual-first social feed — customers who discover or follow the account',
    maxChars:2200, format:'Caption only. No title field. Links in captions are NOT clickable on Instagram.',
    tone:'Conversational, energetic, brand personality forward',
    dos:['Lead with a strong hook — first line is the preview before "more"','Put 3-5 hashtags at the very end of the caption only','End with a CTA that works without a link (DM us, call now, visit us)','Use line breaks between paragraphs','Emoji used intentionally — reinforce the message'],
    donts:['No clickable links in caption — they do not work on Instagram','No markdown or bullet points — renders as plain text','Do not write like a traditional ad','No hashtag stuffing','Do not bury the hook — first line must earn the tap to read more'],
    images:{required:true, notes:'Image or video required. Single or carousel (up to 10 slides). Feed: 1:1 or 4:5 portrait. Stories: 9:16. JPG/PNG max 30MB.'}
  },
  nextdoor: {
    name:'Nextdoor', purpose:'Hyperlocal neighborhood community — residents looking for local recommendations',
    maxChars:1000, format:'Post body. Conversational, neighborhood-aware. No formal title required.',
    tone:'Warm, community-focused, neighbor-to-neighbor — not corporate',
    dos:['Mention the neighborhood, city, or area by name','Write as a neighbor and local business owner — personal and approachable','Include how long you have served the area if applicable','Keep it short — Nextdoor readers scroll fast'],
    donts:['No corporate or press-release tone','Do not over-promote — helpful beats salesy here','Limit emoji to 0-1','Do not ignore the local angle — generic copy performs poorly here','No all-caps'],
    images:{recommended:true, notes:'Single image. Authentic local photos outperform stock imagery. Square or landscape. JPG/PNG.'}
  },
  fbmarket: {
    name:'Facebook Marketplace', purpose:'Consumer marketplace — buyers searching for local services and goods',
    maxChars:1000, format:'Listing title + description. Title is separate and appears in search results.',
    tone:'Clear, direct, transactional — buyers want facts not stories',
    dos:['Lead with what you offer and price or starting rate','Include city/area in the description','List specific services or options clearly','State availability (available now, book in advance)','Include contact method and response time'],
    donts:['No fluff or storytelling — buyers scan fast','Do not omit pricing context — listings without it get skipped','No emoji in the title','Avoid vague descriptions — be specific','Do not skip contact info'],
    images:{recommended:true, notes:'At least 1 image strongly recommended — listings without photos get far less engagement. Up to 10. JPG/PNG.'}
  },
  craigslist: {
    name:'Craigslist', purpose:'Classified ads — buyers searching locally for services and goods',
    maxChars:1500, format:'Title + body. Plain text. Structured sections with headers work well. No emoji. No markdown.',
    tone:'Direct, factual, professional — Craigslist readers are deal-oriented and skeptical of hype',
    dos:['Use clear section headers: Services Offered, Pricing, Contact','List services one per line','Include location, service area, and contact info','State credentials, experience, or license number if applicable','Use a strong, specific title — it is your first impression'],
    donts:['No emoji — renders poorly and looks unprofessional on Craigslist','No markdown (asterisks and pound signs appear as literal characters)','No hype words like amazing or unbeatable','No all-caps','No excessive exclamation points'],
    images:{recommended:true, notes:'Up to 24 images per listing. Real work or location photos build trust significantly. JPG preferred, max 10MB each.'}
  },
  yelp: {
    name:'Yelp', purpose:'Local business reviews and discovery — customers actively comparing service providers',
    maxChars:1500, format:'Business description field. Yelp also has separate Specialties, History, and Meet the Owner fields.',
    tone:'Warm, confident, and specific — highlight what makes you worth choosing',
    dos:['Open with your specialty or most popular service','Mention years in business, credentials, or certifications','Describe what the customer experience is like','Call out real awards or recognitions if you have them','End with an invitation to visit or contact'],
    donts:['No fake social proof or invented testimonials','No competitor comparisons or mentions','Avoid vague generic claims like great customer service — be specific','No promotional pricing language — Yelp policies restrict it','No emoji in business descriptions'],
    images:{recommended:true, notes:'Photos are critical on Yelp — businesses with photos get significantly more profile clicks. Cover, interior, exterior, work samples. JPG/PNG.'}
  },
  thumbtack: {
    name:'Thumbtack', purpose:'Service marketplace — customers requesting quotes for specific jobs',
    maxChars:800, format:'Business intro / about section. Customers compare multiple pros side-by-side.',
    tone:'Professional, reliable, expertise-forward — make them feel confident choosing you',
    dos:['State specialty and primary service in the first sentence','Mention years of experience and any licenses or certifications','Include response time or availability (same-day, 24-hour response)','Name specific services you excel at','Convey reliability — customers are trusting you in their home or business'],
    donts:['Do not be vague — customers are comparing you directly to other pros','No pricing in the intro — Thumbtack has a separate quoting system','Avoid generic claims without specifics','No emoji','No filler — every sentence should add a reason to choose you'],
    images:{recommended:true, notes:'Profile photo and work photos both matter. Before/after shots perform well for service trades. JPG/PNG.'}
  },
  angi: {
    name:"Angi (formerly Angie's List)", purpose:'Home services marketplace — homeowners looking for vetted contractors',
    maxChars:800, format:'Business description / about section. Homeowners compare multiple pros.',
    tone:'Professional, trustworthy, trade-specific — homeowners want to feel safe hiring you',
    dos:['Lead with your primary trade or specialty','Mention licensing and insurance if applicable — it is a key trust signal','Include years in business and service area','Describe specific job types you handle','Mention guarantees or warranties if offered'],
    donts:['Do not skip licensing or insurance info if you have it — Angi customers look for it','No vague claims without substance','No pricing in description — Angi has a separate quote flow','No emoji','Do not sound like a new business — homeowners want established pros'],
    images:{recommended:true, notes:'Before/after project photos are highly effective on Angi. Profile photo required. JPG/PNG.'}
  },
  alignable: {
    name:'Alignable', purpose:'B2B local business network — other business owners looking for referral partners',
    maxChars:800, format:'Business description for peer-to-peer B2B context. The audience is other business owners, not consumers.',
    tone:'Professional, peer-to-peer, network-oriented — you are talking to fellow business owners',
    dos:['Frame services in terms of how you help other businesses','Mention the types of businesses you work with or serve','Include what makes you a good referral partner','Name your primary service category clearly','Invite connection or referral relationships'],
    donts:['Do not write consumer-facing copy — this is a B2B context','No consumer-oriented offers or promotions','No emoji — this is a professional network','Do not ignore the referral angle — Alignable is built around it','No pricing — focus on relationship and fit'],
    images:{recommended:true, notes:'Professional logo and team or location photo. Business-appropriate imagery only. JPG/PNG.'}
  },
  applemaps: {
    name:'Apple Maps', purpose:'Location discovery — iPhone users finding businesses nearby via Maps',
    maxChars:500, format:'Business description. Very short and factual. Pairs with structured data fields (hours, category, address).',
    tone:'Factual, complete, concise — Apple Maps users want fast answers',
    dos:['State what you are and what you do in the first sentence','Include your primary category or specialty','Mention physical location context if helpful (near X, in Y neighborhood)','Keep it to 2-3 sentences max','Ensure hours, address, and phone are accurate in the listing fields'],
    donts:['No promotional language','No emoji','Do not write more than needed — short and factual wins here','No hashtags','No calls to action — Apple Maps is for discovery not conversion'],
    images:{recommended:true, notes:'Exterior and interior photos recommended. JPG/PNG.'}
  },
  bing: {
    name:'Bing Places', purpose:'Local search on Bing and Microsoft products — customers finding businesses via Bing Maps',
    maxChars:1500, format:'Business description. Similar to Google Business Profile. Plain text, professional.',
    tone:'Professional, informative, keyword-aware — mirrors Google Business Profile tone',
    dos:['Include primary service keywords naturally','Mention your city or region for local search relevance','State specialty, experience, or credentials','Write for an audience that searched specifically for your service type'],
    donts:['No promotional superlatives','No URLs or phone numbers in description','No emoji','No all-caps','No competitor names'],
    images:{recommended:true, notes:'Cover photo and additional photos supported. JPG/PNG, max 5MB.'}
  },
  linkedin: {
    name:'LinkedIn', purpose:'Professional network — business owners, decision-makers, and potential clients who engage with industry content',
    maxChars:3000, format:'Post body. Supports text, emoji, and line breaks. No separate title. First 2-3 lines show before "see more" — make them count.',
    tone:'Professional but personal — share a perspective, insight, or story. Write like a founder, not a press release.',
    dos:['Lead with a hook or insight in the first line — readers skim before clicking "see more"','Tell a story or share a specific observation about your business or industry','Use short paragraphs — 1-2 sentences max per line','End with a question or soft CTA to drive comments','1-3 hashtags at the end — relevant and specific'],
    donts:['No walls of text — LinkedIn skimmers will scroll past','No generic openers like "We are excited to announce" or "Check us out"','No more than 3 hashtags','Do not write consumer ad copy — the audience is professionals and peers','Avoid pure self-promotion without value — give before you ask'],
    images:{recommended:true, notes:'Single image or document carousel. Native video also performs well. 1200×627px for link posts. Square 1080×1080px for feed images. JPG/PNG.'}
  },
  x: {
    name:'X (Twitter)', purpose:'Real-time social feed — followers and discoverers scrolling a fast-moving timeline',
    maxChars:280, format:'Single tweet. Plain text. Emoji supported. Links count as ~23 characters. No title field.',
    tone:'Short, direct, punchy — every word earns its place. Hook in the first 5 words.',
    dos:['Lead with the most interesting thing — no warm-up sentences','Use 1-2 hashtags max and only if they are highly relevant','Keep it to 1-2 short sentences when possible','End with a clear action (link, reply, quote tweet) if applicable','Emoji used sparingly to reinforce — not decorate'],
    donts:['No long-winded setups — get to the point immediately','No more than 2 hashtags','Do not try to fit a paragraph into 280 characters — trim ruthlessly','No all-caps','No generic promotional language — it blends into noise on X'],
    images:{recommended:true, notes:'Single image or up to 4 images. 16:9 landscape preferred (1200×675px). GIF supported. Images increase engagement significantly on X.'}
  },
  pinterest: {
    name:'Pinterest', purpose:'Visual discovery platform — users actively browsing for ideas, inspiration, and services across home, food, beauty, fashion, and lifestyle categories',
    maxChars:500, format:'Pin description + separate title (up to 100 chars). Description supports the image with context and keywords. Plain text — no markdown.',
    tone:'Inspiring, aspirational, and helpful — write like you\'re sharing a great idea, not running an ad',
    dos:['Weave in 2-4 natural keywords in the first sentence — Pinterest is a search engine','Write a specific, descriptive title that tells exactly what the pin is about','Describe what the viewer will get, learn, see, or experience','Include a soft CTA (visit us, save this, try it today)','2-3 targeted hashtags at the end — specific beats generic'],
    donts:['No hashtag stuffing — 2-3 max, highly relevant only','No aggressive sales language — inspire first, sell second','Do not write a generic caption — specificity drives saves and clicks','No all-caps','Do not skip the title — it appears in search results and is your first impression'],
    images:{required:true, notes:'Image is everything on Pinterest. Vertical 2:3 ratio strongly preferred (e.g. 1000×1500px). Bright, high-quality, well-composed images dramatically outperform dark or cluttered ones. JPG or PNG.'}
  }
};

function buildPlatformBlock(p) {
  const d = p.doc || {};
  return [
    `\n=== ${(d.name || p.name).toUpperCase()} — ${p.type === 'api' ? 'AUTO-POST' : 'COPY-PASTE'}${p.cat ? ' | ' + p.cat.replace(/^\s*\(category:\s*/i,'').replace(/\)\s*$/,'') : ''} ===`,
    `PURPOSE: ${d.purpose || ''}`,
    `FORMAT: ${d.format || ''} Max ${d.maxChars || 1000} characters.`,
    `TONE: ${d.tone || ''}`,
    d.dos  && d.dos.length  ? `DO: ${d.dos.join(' | ')}` : '',
    d.donts && d.donts.length ? `DON'T: ${d.donts.join(' | ')}` : '',
    d.images ? `IMAGES: ${d.images.required ? '(REQUIRED) ' : '(recommended) '}${d.images.notes}` : ''
  ].filter(Boolean).join('\n');
}

// ══════════════════════════════════════════
// Function 1: adaptListing
// POST /adaptListing
// ══════════════════════════════════════════
exports.generateEnrichmentQuestions = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  try {
    await reserveAiAction(decoded.uid);
  } catch(e) {
    if (e.message === 'LIMIT_REACHED') return res.status(429).json({ error: `AI limit reached (${e.used}/${e.cap} this month). Upgrade your plan for more.` });
    console.warn('[reserveAiAction] generateEnrichmentQuestions transaction failed, proceeding:', e.message);
  }

  const { businessName, category, address, locationType, region, existingInsights } = req.body;
  const answered = (existingInsights || []).filter(i => i.answer);

  const prompt = `You are a local business marketing AI. Help me write more personal, specific posts for this business.

WHAT I KNOW:
- Business: ${businessName}
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

  const aiStartMs = Date.now();
  try {
    const aiResp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!aiResp.ok) {
      const err = new Error(`Anthropic ${aiResp.status}: ${await aiResp.text()}`);
      err._isHttpError = true;
      throw err;
    }
    const aiJson = await aiResp.json();
    const parsed = JSON.parse(aiJson.content[0].text.replace(/```json|```/g, '').trim());
    const aiElapsedMs = Date.now() - aiStartMs;
    trackAiUsage(decoded.uid, 'followUpQuestions', 'claude-haiku-4-5', aiJson.usage, {
      timing: { aiElapsedMs },
    });
    res.json({ questions: parsed.questions || [] });
  } catch(e) {
    const failureType = classifyAiError(e);
    if (failureType === 'anthropic_timeout') console.warn('[AI_TIMEOUT] generateEnrichmentQuestions timed out after 25s — uid:', decoded.uid);
    trackAiUsage(decoded.uid, 'followUpQuestions', 'claude-haiku-4-5', null, { failureType });
    console.error('generateEnrichmentQuestions error [' + failureType + ']:', e.message);
    res.status(500).json({ error: e.message });
  }
});

exports.adaptListing = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY'], timeoutSeconds: 120 }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const fnStartMs = Date.now();

  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { listing, platforms, tone, platformCats } = req.body;
  const now = new Date();

  // Dedup check BEFORE usage reservation — cached hit returns without cost
  const requestId = listing?.requestId;
  if (requestId) {
    try {
      const dedupSnap = await db.collection('aiRequestDedup').doc(`${decoded.uid}_${requestId}`).get();
      if (dedupSnap.exists) return res.json(dedupSnap.data().result);
    } catch(e) { console.warn('[adaptListing] dedup read failed:', e.message); }
  }

  try {
    await reserveAiAction(decoded.uid);
  } catch(e) {
    if (e.message === 'LIMIT_REACHED') return res.status(429).json({ error: `AI limit reached (${e.used}/${e.cap} this month). Upgrade your plan for more.` });
    console.warn('[reserveAiAction] adaptListing transaction failed, proceeding:', e.message);
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const platformList = (platforms || []).map(p => ({
    id: p.id, name: p.name, type: p.type,
    doc: PLATFORM_DOCS[p.id] || {},
    cat: (platformCats || {})[p.id] ? ` (category: ${platformCats[p.id]})` : ''
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
    return '\n📖 BRAND STORY — ALL CAMPAIGNS (the owner\'s voice — weave this authenticity naturally into every platform\'s copy):\n' + lines.join('\n');
  })();

  const campaignContextBlock = listing.campaignContext
    ? '\n🎯 THIS CAMPAIGN ONLY — HIGH PRIORITY (specific details for this post run — use these to make copy feel fresh and specific, not generic):\n' + listing.campaignContext
    : '';

  const MAX_LIBRARY_DOC_CHARS   = 3000;
  const MAX_LIBRARY_TOTAL_CHARS = 12000;
  let libraryTotalChars = 0;
  const trimmedLibraryDocs = (listing.libraryDocs || []).reduce((acc, d) => {
    if (libraryTotalChars >= MAX_LIBRARY_TOTAL_CHARS) return acc;
    const text      = (d.extractedText || '').slice(0, MAX_LIBRARY_DOC_CHARS);
    const remaining = MAX_LIBRARY_TOTAL_CHARS - libraryTotalChars;
    const safeText  = text.slice(0, remaining);
    libraryTotalChars += safeText.length;
    acc.push({ name: d.name, extractedText: safeText });
    return acc;
  }, []);
  const libraryDocsBlock = trimmedLibraryDocs.length
    ? '\n📂 BUSINESS LIBRARY DOCUMENTS — Read these carefully. Reference specific details naturally:\n' +
      trimmedLibraryDocs.map(d => `[${d.name}]:\n${d.extractedText}`).join('\n\n')
    : '';

  const prompt = `You are a local business marketing expert. Adapt the following business listing for each platform listed. Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

BUSINESS INFO:
- Business name: ${listing.name || 'not provided'}
- Owner name: ${listing.ownerName || 'not provided'}
- Category: ${listing.category || 'General'}
- Campaign: ${listing.campaignName || 'General'}
- Ad: ${listing.adName || listing.offer}
- Offer description: ${listing.offer}
${listing.adDetails ? `- Additional ad details: ${listing.adDetails}\n` : ''}- Price/Range: ${listing.price || 'not specified'}
- Phone: ${listing.phone || 'not provided'}
- Location type: ${listing.locationType === 'online' ? 'Online only' : 'Physical location'}
- Address/Area: ${listing.locationType === 'online' ? (listing.region ? 'Serves: ' + listing.region : 'Online — no physical address') : (listing.address || 'not provided')}
- Website: ${listing.website || 'none'}
- Hours: ${listing.hours || 'not provided'}
- Images attached: ${listing.imageCount > 0 ? listing.imageCount + ' photo(s)' : 'none'}
- Preferred tone: ${tone}
${aiContextBlock}${libraryDocsBlock}${campaignContextBlock}${(listing.bizInsights||[]).length ? '\n⚠️ CAMPAIGN-SPECIFIC AI FACTS — MANDATORY. These answers are specific to this campaign. Reference them directly — do NOT write generic filler:\n' + listing.bizInsights.map(i=>`- ${i.question}: ${i.answer}`).join('\n') : ''}${(listing.globalFactoids||[]).length ? '\n⚠️ GLOBAL BUSINESS FACTS — Always true about this business. Reference naturally where relevant:\n' + listing.globalFactoids.map(f=>`- ${f.text}`).join('\n') : ''}${(listing.campaignFactoids||[]).length ? '\n⚠️ CAMPAIGN-SPECIFIC FACTS — Specific to this campaign. Work these in:\n' + listing.campaignFactoids.map(f=>`- ${f.text}`).join('\n') : ''}
PLATFORMS TO ADAPT FOR:
${platformList.map(buildPlatformBlock).join('\n')}

Return this exact JSON structure:
{
  "adaptations": {
    "PLATFORM_ID": "adapted text here"
  }
}`;

  let parsed;
  const aiStartMs = Date.now();
  try {
    const aiResp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] })
    }, 110000);
    if (!aiResp.ok) {
      const t = await aiResp.text();
      const err = new Error(`Anthropic ${aiResp.status}: ${t.slice(0,200)}`);
      err._isHttpError = true;
      throw err;
    }
    const aiJson = await aiResp.json();
    parsed = JSON.parse(aiJson.content[0].text.replace(/```json|```/g, '').trim());
    const aiElapsedMs = Date.now() - aiStartMs;
    trackAiUsage(decoded.uid, 'adaptListing', 'claude-sonnet-4-5-20250929', aiJson.usage, {
      timing:  { aiElapsedMs, fnElapsedMs: Date.now() - fnStartMs },
      context: { businessId: listing.businessId || null, campaignId: listing.campaignId || null },
    });
  } catch(e) {
    const failureType = classifyAiError(e);
    if (failureType === 'anthropic_timeout') console.warn('[AI_TIMEOUT] adaptListing timed out after 110s — uid:', decoded.uid);
    trackAiUsage(decoded.uid, 'adaptListing', 'claude-sonnet-4-5-20250929', null, { failureType });
    console.error('adaptListing AI error [' + failureType + ']:', e.message);
    return res.status(500).json({ error: 'AI adaptation failed: ' + e.message });
  }

  if (requestId) {
    try {
      await db.collection('aiRequestDedup').doc(`${decoded.uid}_${requestId}`).set({
        result: parsed,
        uid: decoded.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
      });
    } catch(e) { console.warn('[adaptListing] dedup write failed:', e.message); }
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
  const fnStartMs = Date.now();

  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }

  const { businessName, ownerName, city, state, description, specialNotes, followUpAnswers, platformCatLists, locationType, requestId: rcRequestId } = req.body;

  // Dedup check BEFORE usage reservation — cached hit returns without cost
  if (rcRequestId) {
    try {
      const dedupSnap = await db.collection('aiRequestDedup').doc(`${decoded.uid}_${rcRequestId}`).get();
      if (dedupSnap.exists) return res.json(dedupSnap.data().result);
    } catch(e) { console.warn('[resolveCategories] dedup read failed:', e.message); }
  }

  try {
    await reserveAiAction(decoded.uid);
  } catch(e) {
    if (e.message === 'LIMIT_REACHED') return res.status(429).json({ error: `AI limit reached (${e.used}/${e.cap} this month). Upgrade your plan for more.` });
    console.warn('[reserveAiAction] resolveCategories transaction failed, proceeding:', e.message);
  }

  const now = new Date();

  const platformContext = {
    fbmarket:   'Facebook Marketplace — consumer marketplace for buying/selling goods and booking local services',
    craigslist: 'Craigslist — classified ads for goods and services; pick the Services sub-category for service businesses, For Sale for product sellers',
    yelp:       'Yelp — local business discovery and reviews; used by consumers searching for restaurants, salons, contractors, and other local businesses',
    thumbtack:  'Thumbtack — platform for hiring local professionals and skilled tradespeople for specific jobs',
    angi:       'Angi (formerly Angie\'s List) — home services and contractor marketplace; focused on residential repair, remodeling, and maintenance',
    alignable:  'Alignable — B2B local business networking; categories describe the business\'s industry to other local business owners',
    applemaps:  'Apple Maps — physical location discovery; pick the place type that best describes where customers go',
    linkedin:   'LinkedIn — professional network; categories describe the business industry to business owners and decision-makers',
    x:          'X (Twitter) — real-time social platform; categories or topics that match the business industry and audience'
  };

  const PLATFORM_MAX_CATS = { fbmarket: 1, craigslist: 1, yelp: 3, thumbtack: 5, angi: 5, alignable: 1, applemaps: 5, linkedin: 1, x: 1 };

  const platformBlocks = Object.entries(platformCatLists).map(([id, cats]) => {
    const ctx = platformContext[id] || id;
    const max = PLATFORM_MAX_CATS[id] || 1;
    const catInstr = max === 1
      ? 'CATEGORIES (pick EXACTLY 1 — return a JSON string):'
      : `CATEGORIES (pick 1 to ${max}, most relevant first — return a JSON array of strings):`;
    return `PLATFORM: ${id}\nPURPOSE: ${ctx}\n${catInstr}\n${cats.join(' | ')}`;
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
{ "categories": { "singleCatPlatformId": "exact string", "multiCatPlatformId": ["cat1","cat2"] } }`
    : `If you have enough context to confidently pick categories for ALL platforms, return ONLY:
{ "categories": { "singleCatPlatformId": "exact string", "multiCatPlatformId": ["cat1","cat2"] } }

If the description is too vague to confidently classify the business, return ONLY:
{ "followUpQuestions": ["short question 1", "short question 2"] }
(1–3 short questions, plain English, no markdown)`;

  const prompt = `You are a local business categorization expert. Your task is to pick the best-matching categories for a local business on each marketing platform listed below.

BUSINESS CONTEXT:
${contextLines}${followUpBlock}

INSTRUCTIONS:
1. Read the PURPOSE of each platform carefully — it tells you what kind of businesses and customers use it.
2. Think about which categories a customer or the platform itself would use to classify this business.
3. For platforms that say "pick EXACTLY 1", return a single JSON string. For platforms that say "pick 1 to N", return a JSON array with the most relevant categories first (do not pad — only include genuinely relevant ones).
4. CRITICAL: Copy every category string EXACTLY as it appears — same capitalization, same punctuation, same spacing. Do not paraphrase, abbreviate, or modify.
5. If no category is a perfect match, pick the closest one. Never invent a new category.

${returnInstructions}

${platformBlocks}`;

  let parsed;
  const aiStartMs = Date.now();
  try {
    const aiResp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
    });
    if (!aiResp.ok) {
      const t = await aiResp.text();
      const err = new Error(`Anthropic ${aiResp.status}: ${t.slice(0,200)}`);
      err._isHttpError = true;
      throw err;
    }
    const aiJson = await aiResp.json();
    parsed = JSON.parse(aiJson.content[0].text.replace(/```json|```/g, '').trim());
    const aiElapsedMs = Date.now() - aiStartMs;
    trackAiUsage(decoded.uid, 'resolveCategories', 'claude-sonnet-4-5-20250929', aiJson.usage, {
      timing: { aiElapsedMs, fnElapsedMs: Date.now() - fnStartMs },
    });
  } catch(e) {
    const failureType = classifyAiError(e);
    if (failureType === 'anthropic_timeout') console.warn('[AI_TIMEOUT] resolveCategories timed out after 25s — uid:', decoded.uid);
    trackAiUsage(decoded.uid, 'resolveCategories', 'claude-sonnet-4-5-20250929', null, { failureType });
    console.error('resolveCategories AI error [' + failureType + ']:', e.message);
    return res.status(500).json({ error: 'AI category resolution failed: ' + e.message });
  }

  if (rcRequestId) {
    try {
      await db.collection('aiRequestDedup').doc(`${decoded.uid}_${rcRequestId}`).set({
        result: parsed,
        uid: decoded.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
      });
    } catch(e) { console.warn('[resolveCategories] dedup write failed:', e.message); }
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

  const { pendingPostId, bizId: pendingBizId } = req.body;
  if (!pendingPostId) return res.status(400).json({ error: 'pendingPostId required' });
  if (!pendingBizId) return res.status(400).json({ error: 'bizId required' });

  const postRef = userBizPostsRef(decoded.uid, pendingBizId).doc(pendingPostId);
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
    const jobRef = userBizJobsRef(decoded.uid, bizId).doc();
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

  // Ownership verification — both draftId and businessId must belong to the caller
  const [draftSnap, bizSnap] = await Promise.all([
    userBizDraftsRef(uid, businessId).doc(draftId).get(),
    userBizRef(uid, businessId).get()
  ]);
  if (!draftSnap.exists || draftSnap.data().uid !== uid) {
    return res.status(403).json({ error: 'Forbidden: draft does not belong to you' });
  }
  if (!bizSnap.exists) {
    return res.status(403).json({ error: 'Forbidden: business does not belong to you' });
  }

  // Check user plan — starter users can't auto-post via API platforms
  let userPlan = 'starter';
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.exists) userPlan = userSnap.data().plan || 'starter';
  } catch(e) { console.warn('approveDraft: users read failed, defaulting to starter:', e.message); }
  const isStarter = userPlan === 'starter';

  const batch = db.batch();

  batch.update(userBizDraftsRef(uid, businessId).doc(draftId), {
    status: 'approved', approvedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  platforms.forEach(platform => {
    const jobRef = userBizJobsRef(uid, businessId).doc();
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
  if (!imageData || !fileName || !mimeType) return res.status(400).json({ error: 'Missing fields' });

  const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  if (!ALLOWED_MIME.has(mimeType)) return res.status(400).json({ error: 'Invalid file type' });

  let rawBytes;
  try { rawBytes = Buffer.from(imageData, 'base64'); } catch(e) {
    return res.status(400).json({ error: 'Invalid image data' });
  }
  if (!rawBytes || rawBytes.byteLength === 0) return res.status(400).json({ error: 'Empty image' });

  const MAX_SIZE = 5 * 1024 * 1024;
  if (rawBytes.byteLength > MAX_SIZE) return res.status(400).json({ error: 'File too large (max 5MB)' });

  // Validate binary signature — don't trust the caller-supplied mimeType alone
  const isJpeg = rawBytes[0] === 0xFF && rawBytes[1] === 0xD8;
  const isPng  = rawBytes[0] === 0x89 && rawBytes[1] === 0x50 && rawBytes[2] === 0x4E && rawBytes[3] === 0x47;
  const isWebp = rawBytes.slice(0, 4).toString('binary') === 'RIFF' && rawBytes.slice(8, 12).toString('binary') === 'WEBP';
  const isGif  = rawBytes.slice(0, 6).toString('ascii').startsWith('GIF8');
  if (!isJpeg && !isPng && !isWebp && !isGif) return res.status(400).json({ error: 'File is not a valid image' });

  // Sanitize fileName — strip path separators and limit length
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);

  const uid = decoded.uid;
  const bucket = admin.storage().bucket();
  const file = bucket.file(`users/${uid}/images/${Date.now()}_${safeFileName}`);
  await file.save(rawBytes, { contentType: mimeType });
  const [url] = await file.getSignedUrl({ action: 'read', expires: new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000) });
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
      await userBizConnsRef(job.uid, job.businessId).doc('google').update({
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
exports.createCheckoutSession = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID'] }, async (req, res) => {
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
  // Idempotency key uses a 1-hour window so retries within the hour reuse the same key
  // (protects against double-clicks and slow-network retries without blocking legitimate re-purchases)
  const idempotencyKey = `checkout-${uid}-${plan}-${Math.floor(Date.now() / 3600000)}`;
  const response = await getSquare().checkout.paymentLinks.create({
    idempotencyKey,
    quickPay: {
      name: planNames[plan],
      priceMoney: { amount: BigInt(Math.round(planPrices[plan] * 100)), currency: 'USD' },
      locationId: process.env.SQUARE_LOCATION_ID,
    },
    checkoutOptions: {
      redirectUrl: `${APP_BASE_URL}/BlastyBiz-Dashboard.html?success=1`,
      merchantSupportEmail: 'info@blastybiz.com',
    },
    prePopulatedData: { buyerEmail: email },
  });
  // Store uid + plan keyed by Square orderId so squareWebhook can reliably map payments back
  // to users without depending on Square metadata fields (referenceId/catalogObjectId).
  const orderId = response.paymentLink?.orderId;
  if (orderId) {
    await db.collection('pendingCheckouts').doc(orderId).set({
      uid, plan,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      // TTL field — Firestore TTL policy on pendingCheckouts/expiresAt cleans up abandoned checkouts after 48h
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 48 * 60 * 60 * 1000),
    });
  }
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
exports.squareWebhook = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_WEBHOOK_SIGNATURE_KEY', 'RESEND_API_KEY'] }, async (req, res) => {
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
      // Look up uid + plan from the pendingCheckouts record written by createCheckoutSession.
      // This is reliable regardless of Square metadata fields (referenceId/catalogObjectId).
      const pendingSnap = await db.collection('pendingCheckouts').doc(orderId).get();
      if (!pendingSnap.exists) return res.json({ received: true });
      const { uid, plan } = pendingSnap.data();
      if (!uid) return res.json({ received: true });
      await db.collection('pendingCheckouts').doc(orderId).delete();
      // Atomic batch: users/{uid}.plan + all businesses/{bizId}.currentPlan in one commit.
      // If any write fails the whole batch rolls back — no more half-written plan state.
      // subscriptions is written separately; it's an audit record, not an entitlement gate.
      const bizSnaps = await userBizCol(uid).get();
      const syncBatch = db.batch();
      syncBatch.set(
        db.collection('users').doc(uid),
        { plan, planActive: true },
        { merge: true }
      );
      bizSnaps.docs.forEach(biz => {
        syncBatch.update(biz.ref, { currentPlan: plan, subscriptionStatus: 'active' });
      });
      await syncBatch.commit();
      await db.collection('subscriptions').doc(uid).set({
        uid,
        squareCustomerId: payment.customer_id || '',
        squarePaymentId: payment.id,
        plan,
        status: 'active',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Send paid-welcome email (Pro or Agency)
      try {
        const userSnap = await db.collection('users').doc(uid).get();
        const userData = userSnap.data() || {};
        const toEmail = userData.email;
        const ownerName = userData.ownerName || userData.displayName || '';
        const businessName = (bizSnaps.docs[0]?.data()?.businessName) || (ownerName ? ownerName + '\'s Business' : 'your business');
        const planName = plan === 'agency' ? 'Agency' : 'Pro';

        if (toEmail) {
          const mergeData = {
            name: ownerName || 'there',
            businessName,
            planName,
            dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
            appUrl: APP_BASE_URL,
          };
          function applyPaidTags(str) {
            return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
          }

          let paidSubject = 'Welcome aboard, ' + mergeData.name + ' — you\'re now BlastyBiz ' + planName + '! 🎉';
          let paidHtml = null;
          try {
            const tmplSnap = await db.collection('emailTemplates')
              .where('type', '==', 'paid-welcome')
              .where('active', '==', true)
              .limit(1)
              .get();
            if (!tmplSnap.empty) {
              const tmpl = tmplSnap.docs[0].data();
              paidSubject = applyPaidTags(tmpl.subject || paidSubject);
              paidHtml = applyPaidTags(tmpl.html || '');
            }
          } catch(e) {
            console.error('[squareWebhook] paid-welcome template fetch failed:', e.message);
          }

          // Fallback HTML
          if (!paidHtml) {
            paidHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
              <div style="background:#0d1a0d;padding:28px 32px">
                <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz ${planName}</div>
                <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
              </div>
              <div style="padding:32px">
                <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Welcome aboard, ${mergeData.name}. You&#39;re ${planName}. &#127881;</h1>
                <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 20px">Your payment went through and <strong>${mergeData.businessName}</strong> is now on BlastyBiz ${planName}. Everything unlocked. Let&#39;s get blasting.</p>
                <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Go to Dashboard &#8594;</a>
              </div>
              <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
                <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
              </div>
            </div>`;
          }

          await sendResendEmail({ to: toEmail, subject: paidSubject, html: paidHtml });
        }
      } catch(e) {
        console.error('[squareWebhook] paid-welcome email failed:', e.message);
      }

      // Internal admin alert — new paying customer
      try {
        const paidUserSnap = await db.collection('users').doc(uid).get();
        const paidUserData = paidUserSnap.data() || {};
        const paidEmail = paidUserData.email || uid;
        const paidName = paidUserData.ownerName || paidUserData.displayName || 'Unknown';
        const paidBizSnap = await userBizCol(uid).limit(1).get();
        const paidBiz = paidBizSnap.docs[0]?.data()?.businessName || '—';
        await sendResendEmail({
          to: 'info@blastybiz.com',
          subject: `[BlastyBiz] 💰 New paying customer: ${paidName} (${plan})`,
          html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
  <h2 style="margin:0 0 12px;font-size:18px">&#128176; New paying customer!</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#888;width:140px">Plan</td><td style="padding:6px 0;font-weight:700;color:#00873a;text-transform:uppercase">${plan}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Name</td><td style="padding:6px 0;font-weight:600">${paidName}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0">${paidEmail}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Business</td><td style="padding:6px 0">${paidBiz}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Payment ID</td><td style="padding:6px 0;font-size:12px;color:#888">${payment.id || '—'}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Time</td><td style="padding:6px 0">${new Date().toUTCString()}</td></tr>
  </table>
</div>`,
        });
      } catch(e) { console.warn('[squareWebhook] admin new-paying alert failed:', e.message); }
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
      const isCanceled = status === 'CANCELED' || status === 'DEACTIVATED';
      if (isCanceled) {
        const customerId = sub.customer_id || sub.customerId;
        if (customerId) {
          try {
            const snap = await db.collection('subscriptions')
              .where('squareCustomerId', '==', customerId).limit(1).get();
            if (!snap.empty) {
              const uid = snap.docs[0].data().uid;
              // Read current plan BEFORE downgrading so we can reference it in the cancellation email
              const priorUserSnap = await db.collection('users').doc(uid).get();
              const priorPlan = priorUserSnap.data()?.plan || 'pro';
              const priorPlanName = priorPlan === 'agency' ? 'Agency' : 'Pro';
              await db.collection('users').doc(uid).set(
                { plan: 'starter', planActive: false }, { merge: true }
              );
              await snap.docs[0].ref.update({
                status: 'canceled',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              // Mirror cancellation onto businesses docs
              const bizSnaps = await userBizCol(uid).get();
              for (const biz of bizSnaps.docs) {
                await biz.ref.update({ currentPlan: 'starter', subscriptionStatus: 'canceled' });
              }

              // Send cancellation confirmation email
              try {
                const userSnap = await db.collection('users').doc(uid).get();
                const userData = userSnap.data() || {};
                const toEmail = userData.email;
                const ownerName = userData.ownerName || userData.displayName || '';
                const businessName = (bizSnaps.docs[0]?.data()?.businessName) || (ownerName ? ownerName + '\'s Business' : 'your business');
                if (toEmail) {
                  const mergeData = {
                    name: ownerName || 'there',
                    businessName,
                    planName: priorPlanName,
                    upgradeUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
                    dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
                    appUrl: APP_BASE_URL,
                  };
                  function applyCancelTags(str) {
                    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
                  }
                  let cancelSubject = `Your BlastyBiz subscription has ended, ${mergeData.name}`;
                  let cancelHtml = null;
                  try {
                    const tmplSnap = await db.collection('emailTemplates')
                      .where('type', '==', 'cancellation').where('active', '==', true).limit(1).get();
                    if (!tmplSnap.empty) {
                      const tmpl = tmplSnap.docs[0].data();
                      cancelSubject = applyCancelTags(tmpl.subject || cancelSubject);
                      cancelHtml = applyCancelTags(tmpl.html || '');
                    }
                  } catch(e) { console.error('[squareWebhook] cancellation template fetch failed:', e.message); }

                  if (!cancelHtml) {
                    cancelHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz</div>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">You're on the free plan now, ${mergeData.name}.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">Your BlastyBiz ${mergeData.planName} subscription for <strong>${mergeData.businessName}</strong> has ended. We've moved you to the free plan — your account and all your data are still here.</p>
    <div style="background:#f7f7f7;border-radius:8px;padding:20px 24px;margin-bottom:24px">
      <div style="font-size:12px;font-weight:800;color:#888;letter-spacing:2px;margin-bottom:10px">WHAT YOU'VE LOST ACCESS TO</div>
      <ul style="color:#555;font-size:14px;line-height:2;padding-left:18px;margin:0">
        <li>Auto-posting to every major platform</li>
        <li>Business Library AI context</li>
        <li>Priority queue &amp; posting history</li>
      </ul>
    </div>
    <a href="${mergeData.upgradeUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Come Back to ${mergeData.planName} &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Changed your mind? Upgrade anytime — everything picks up right where you left off.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
                  }
                  await sendResendEmail({ to: toEmail, subject: cancelSubject, html: cancelHtml });
                }
              } catch(e) { console.error('[squareWebhook] cancellation email failed:', e.message); }
            }
          } catch (e) {
            console.error('squareWebhook subscription.updated error:', e.message);
          }
        }
      }
    }
  }

  // Payment failed — notify the customer so they can update their payment method
  if (event.type === 'payment.failed') {
    const payment = event.data?.object?.payment;
    if (payment) {
      try {
        const customerId = payment.customer_id || payment.customerId;
        let uid, ownerName, businessName, toEmail;
        if (customerId) {
          const snap = await db.collection('subscriptions').where('squareCustomerId', '==', customerId).limit(1).get();
          if (!snap.empty) uid = snap.docs[0].data().uid;
        }
        if (!uid && (payment.order_id || payment.orderId)) {
          const pendingSnap = await db.collection('pendingCheckouts').doc(payment.order_id || payment.orderId).get();
          if (pendingSnap.exists) uid = pendingSnap.data().uid;
        }
        if (uid) {
          const userSnap = await db.collection('users').doc(uid).get();
          const userData = userSnap.data() || {};
          toEmail = userData.email;
          ownerName = userData.ownerName || userData.displayName || '';
          const bizSnap = await userBizCol(uid).limit(1).get();
          businessName = bizSnap.docs[0]?.data()?.businessName || (ownerName ? ownerName + '\'s Business' : 'your business');
        }
        if (toEmail) {
          const mergeData = {
            name: ownerName || 'there',
            businessName: businessName || 'your business',
            dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
            upgradeUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
            appUrl: APP_BASE_URL,
          };
          function applyPaymentFailedTags(str) {
            return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
          }
          let pfSubject = `Action needed, ${mergeData.name} — your BlastyBiz payment didn't go through`;
          let pfHtml = null;
          try {
            const tmplSnap = await db.collection('emailTemplates')
              .where('type', '==', 'payment-failed').where('active', '==', true).limit(1).get();
            if (!tmplSnap.empty) {
              const tmpl = tmplSnap.docs[0].data();
              pfSubject = applyPaymentFailedTags(tmpl.subject || pfSubject);
              pfHtml = applyPaymentFailedTags(tmpl.html || '');
            }
          } catch(e) { console.error('[squareWebhook] payment-failed template fetch failed:', e.message); }

          if (!pfHtml) {
            pfHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz</div>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hi ${mergeData.name} — your payment didn't go through.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">We weren't able to process your BlastyBiz subscription payment for <strong>${mergeData.businessName}</strong>. This can happen when a card expires or a bank blocks a recurring charge.</p>
    <div style="background:#fff3cd;border-left:4px solid #ffc107;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:13px;font-weight:700;color:#856404;margin-bottom:4px">&#9888; Your account may be paused</div>
      <div style="font-size:14px;color:#6b5300">Update your payment method to keep your Pro features active and avoid interruption.</div>
    </div>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Update Payment Method &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Questions? Reply to this email — a real person reads every reply. We want to keep <strong>${mergeData.businessName}</strong> on BlastyBiz Pro.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
          }
          await sendResendEmail({ to: toEmail, subject: pfSubject, html: pfHtml });
        }
      } catch(e) { console.error('[squareWebhook] payment.failed handler error:', e.message); }
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
exports.initiateGoogleOAuth = onRequest({ invoker: 'public', secrets: ['GOOGLE_CLIENT_ID'] }, async (req, res) => {
  setCors(res);
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
  const uid = decoded.uid;
  const { businessId, returnTo } = req.query;
  if (!businessId) { res.status(400).json({ error: 'Missing businessId' }); return; }
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
});

// ══════════════════════════════════════════
// Function 11: googleOAuthCallback
// GET /googleOAuthCallback?code=...&state=...
// Exchanges auth code for tokens, stores in platformConnections
// ══════════════════════════════════════════
exports.googleOAuthCallback = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.redirect(`${APP_BASE_URL}/BlastyBiz-Connect.html?error=google`); return; }

  // Verify nonce — prevents forged OAuth state attacks
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

    await userBizConnsRef(uid, businessId).doc('google').set({
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
exports.initiateFacebookOAuth = onRequest({ invoker: 'public', secrets: ['FACEBOOK_APP_ID'] }, async (req, res) => {
  setCors(res);
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
  const uid = decoded.uid;
  const { businessId, returnTo } = req.query;
  if (!businessId) { res.status(400).json({ error: 'Missing businessId' }); return; }
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
});

// ══════════════════════════════════════════
// Function 13: facebookOAuthCallback
// GET /facebookOAuthCallback?code=...&state=...
// Exchanges code for page token, fetches linked IG account,
// stores both in platformConnections
// ══════════════════════════════════════════
exports.facebookOAuthCallback = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  if (!code) { res.redirect(`${APP_BASE_URL}/BlastyBiz-Connect.html?error=facebook`); return; }

  // Verify nonce — prevents forged OAuth state attacks
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

    // Exchange for a long-lived user token (~60 days) so page tokens are also long-lived
    const longLivedResp = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        fb_exchange_token: shortLivedToken
      }
    });
    const longLivedToken = longLivedResp.data.access_token;
    const expiresIn = longLivedResp.data.expires_in || (60 * 24 * 3600); // fallback: 60 days
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

    // If the Graph API didn't return an igUserId this time, check whether a paired
    // Instagram doc already exists (e.g. status: 'expired'). If so we still need
    // to refresh its token so it doesn't stay stale after a Facebook reconnect.
    let existingIgDoc = null;
    if (!igUserId) {
      try {
        const igSnap = await userBizConnsRef(uid, businessId).doc('instagram').get();
        if (igSnap.exists) existingIgDoc = igSnap.data();
      } catch(e) { /* ignore — absence is fine */ }
    }

    const batch = db.batch();
    batch.set(userBizConnsRef(uid, businessId).doc('facebook'), {
      businessId, uid, platform: 'facebook', status: 'connected',
      accessToken: pageToken, pageId: page?.id || '',
      pageName: page?.name || '',
      allPages: pages.map(p => ({ id: p.id, name: p.name })),
      expiresAt,
      connectedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    if (igUserId) {
      // Fresh igUserId from the API — write the full Instagram doc.
      batch.set(userBizConnsRef(uid, businessId).doc('instagram'), {
        businessId, uid, platform: 'instagram', status: 'connected',
        accessToken: pageToken, igUserId, pageId: page?.id || '',
        expiresAt,
        connectedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } else if (existingIgDoc) {
      // No igUserId returned this time, but a paired Instagram doc exists
      // (possibly expired). Refresh its token and reset to connected so it
      // doesn't remain stale after the Facebook reconnect.
      batch.set(userBizConnsRef(uid, businessId).doc('instagram'), {
        accessToken: pageToken, status: 'connected',
        expiresAt,
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
  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
  const { jobId, businessId: bingBizId } = req.body;
  if (jobId && bingBizId) {
    const jobSnap = await userBizJobsRef(decoded.uid, bingBizId).doc(jobId).get();
    if (!jobSnap.exists || jobSnap.data().uid !== decoded.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await userBizJobsRef(decoded.uid, bingBizId).doc(jobId).update({
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
  let decoded;
  try { decoded = await verifyBearer(req); } catch(e) { return res.status(401).json({ error: 'Unauthorized' }); }
  const { jobId, businessId: appleBizId } = req.body;
  if (jobId && appleBizId) {
    const jobSnap = await userBizJobsRef(decoded.uid, appleBizId).doc(jobId).get();
    if (!jobSnap.exists || jobSnap.data().uid !== decoded.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await userBizJobsRef(decoded.uid, appleBizId).doc(jobId).update({
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
  { document: 'users/{userId}/businesses/{bizId}/publishJobs/{jobId}', region: 'us-central1', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  async (event) => {
    const job    = event.data.data();
    const jobRef = event.data.ref;

    // Only process jobs that need auto-posting
    if (job.status !== 'pending') return;
    if (job.planGated) return; // starter plan — user sees copy-paste content instead

    // Idempotency guard: claim the job by moving to 'processing'
    await jobRef.update({
      status: 'processing',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    try {
      const connSnap = await userBizConnsRef(job.uid, job.businessId).doc(job.platform).get();

      if (!connSnap.exists || connSnap.data().status !== 'connected') {
        await jobRef.update({
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
          await jobRef.update({
            status: 'manual_required',
            adminError: `No automated publisher for platform: ${job.platform}`,
            customerVisibleMessage: `Your AI-written copy for ${job.platform} is ready — this platform requires manual posting. Copy your text from the listing preview and paste it directly.`,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          return;
      }

      // Instagram may return a manual fallback when no image is present
      if (result?.manualFallback) {
        await jobRef.update({
          status: 'manual_required',
          customerVisibleMessage: result.message || 'Please post this manually.',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
      }

      await jobRef.update({
        status: 'success',
        apiResponse: result,
        customerLabel: 'Published',
        customerVisibleMessage: `Your listing is live on ${job.platform}.`,
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    } catch(e) {
      console.error(`dispatchPublishJob [${event.params.jobId}] failed:`, e.message);
      await jobRef.update({
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
  { document: 'users/{userId}/businesses/{bizId}/publishJobs/{jobId}', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    if (before.status === after.status || after.status !== 'failed') return;

    const uid = after.uid;
    if (!uid) return;
    let toEmail, ownerName, businessName;
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) return;
      const userData = userSnap.data();
      toEmail = userData.email;
      ownerName = userData.ownerName || userData.displayName || '';
    } catch(e) { console.warn('[jobFailedTrigger] users read failed:', e.message); return; }
    if (!toEmail) return;

    try {
      const bizSnap = await userBizCol(uid).limit(1).get();
      businessName = bizSnap.docs[0]?.data()?.businessName || '';
    } catch(e) { /* non-fatal */ }

    const platformRaw = (after.platform || 'your platform').replace(/_/g, ' ');
    const platformDisplay = platformRaw.replace(/\b\w/g, c => c.toUpperCase());

    const mergeData = {
      name: ownerName || 'there',
      businessName: businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
      platform: platformDisplay,
      dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
      appUrl: APP_BASE_URL,
    };
    function applyFailedTags(str) {
      return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
    }

    let subject = `Heads up, ${mergeData.name} — your ${platformDisplay} post needs attention`;
    let html = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'job-failed').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) {
        const tmpl = tmplSnap.docs[0].data();
        subject = applyFailedTags(tmpl.subject || subject);
        html = applyFailedTags(tmpl.html || '');
      }
    } catch(e) { console.error('[jobFailedTrigger] template fetch failed:', e.message); }

    if (!html) {
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz</div>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Heads up, ${mergeData.name} — your ${platformDisplay} post hit a snag.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">We tried to publish <strong>${mergeData.businessName}</strong>'s content to <strong>${platformDisplay}</strong> automatically, but ran into an issue.</p>
    <div style="background:#fff3cd;border-left:4px solid #ffc107;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:13px;font-weight:700;color:#856404;margin-bottom:4px">What happened</div>
      <div style="font-size:14px;color:#6b5300">${after.customerVisibleMessage || 'Your post could not be published automatically.'}</div>
    </div>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Go to Dashboard &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Your AI-written copy is saved — nothing is lost. You can post it manually or reply to this email if you need help.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
    }

    await sendResendEmail({ to: toEmail, subject, html });
  }
);

// ══════════════════════════════════════════
// Function 18b: jobCompletedTrigger
// Firestore trigger — publishJobs/{jobId} updated
// Sends "your listing is live" email when status → 'success'
// ══════════════════════════════════════════
exports.jobCompletedTrigger = onDocumentUpdated(
  { document: 'users/{userId}/businesses/{bizId}/publishJobs/{jobId}', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    if (before.status === after.status || after.status !== 'success') return;

    const uid = after.uid;
    if (!uid) return;
    let toEmail, ownerName, businessName;
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) return;
      const userData = userSnap.data();
      toEmail = userData.email;
      ownerName = userData.ownerName || userData.displayName || '';
    } catch(e) { console.warn('[jobCompletedTrigger] users read failed:', e.message); return; }
    if (!toEmail) return;

    try {
      const bizSnap = await userBizCol(uid).limit(1).get();
      businessName = bizSnap.docs[0]?.data()?.businessName || '';
    } catch(e) { /* non-fatal */ }

    const platformRaw = (after.platform || 'your platform').replace(/_/g, ' ');
    const platformDisplay = platformRaw.replace(/\b\w/g, c => c.toUpperCase());

    const mergeData = {
      name: ownerName || 'there',
      businessName: businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
      platform: platformDisplay,
      dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
      appUrl: APP_BASE_URL,
    };
    function applyCompletedTags(str) {
      return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
    }

    let subject = `Your listing is live on ${platformDisplay}, ${mergeData.name}! 🚀`;
    let html = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'job-completed').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) {
        const tmpl = tmplSnap.docs[0].data();
        subject = applyCompletedTags(tmpl.subject || subject);
        html = applyCompletedTags(tmpl.html || '');
      }
    } catch(e) { console.error('[jobCompletedTrigger] template fetch failed:', e.message); }

    if (!html) {
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz</div>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <div style="display:inline-block;background:#e8f5e9;border-radius:100px;padding:8px 18px;font-size:13px;font-weight:700;color:#00873a;margin-bottom:20px">&#10003; Posted successfully</div>
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">${mergeData.businessName} is live on ${platformDisplay}. &#128640;</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">Hey ${mergeData.name} — BlastyBiz just published your listing to <strong>${platformDisplay}</strong>. It's out there right now, working for you.</p>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px;margin-bottom:24px">View Your Dashboard &#8594;</a>
    <p style="font-size:14px;color:#666;line-height:1.6;margin:0">Keep the momentum going — blast to another platform or schedule your next post from the dashboard.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
    }

    await sendResendEmail({ to: toEmail, subject, html });
  }
);

// ══════════════════════════════════════════
// Function 19: userCreatedTrigger
// Firestore trigger — users/{uid} created
// Welcome email moved to businessCreatedTrigger so businessName is available.
// ══════════════════════════════════════════
exports.userCreatedTrigger = onDocumentCreated(
  { document: 'users/{uid}', region: 'us-central1' },
  async (event) => {
    const uid = event.params.uid;
    const userData = event.data.data();
    try {
      await db.collection('setupNudges').doc(uid).set({
        uid,
        email: userData.email || null,
        sendAfter: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
        sent: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch(e) { console.error('[userCreatedTrigger] setupNudges write failed:', e.message); }
  }
);

// ══════════════════════════════════════════
// Function 19b: businessCreatedTrigger
// Firestore trigger — businesses/{bizId} created (end of onboarding step 6)
// Sends welcome email + admin alert once businessName is known
// ══════════════════════════════════════════
exports.businessCreatedTrigger = onDocumentCreated(
  { document: 'users/{uid}/businesses/{bizId}', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const biz = event.data.data();
    const uid = event.params.uid;
    if (!uid) return;

    // Get auth email from users doc (the form email field is the business contact, not auth email)
    let email, ownerName;
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) return;
      const userData = userSnap.data();
      email = userData.email;
      ownerName = biz.ownerName || userData.ownerName || userData.displayName || '';
    } catch(e) { console.warn('[businessCreatedTrigger] users read failed:', e.message); return; }
    if (!email) return;

    const businessName = biz.businessName || (ownerName ? ownerName + '\'s Business' : 'your business');

    const mergeData = {
      name: ownerName || 'there',
      businessName,
      dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
      upgradeUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
      appUrl: APP_BASE_URL,
    };
    function applyTags(str) {
      return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
    }

    let subject = 'Welcome to BlastyBiz, ' + mergeData.name + '! 🚀';
    let html = null;
    try {
      const snap = await db.collection('emailTemplates')
        .where('type', '==', 'welcome')
        .where('active', '==', true)
        .limit(1)
        .get();
      if (!snap.empty) {
        const tmpl = snap.docs[0].data();
        subject = applyTags(tmpl.subject || subject);
        html = applyTags(tmpl.html || '');
      }
    } catch(e) { console.error('[businessCreatedTrigger] template fetch failed:', e.message); }

    if (!html) {
      html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px">
    <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz</div>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">You&#39;re in, ${mergeData.name}. Let&#39;s blast.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 20px"><strong>${mergeData.businessName}</strong> is set up and ready. Fill out your profile once — BlastyBiz writes the copy for every platform automatically.</p>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Go to Dashboard &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
    }

    await sendResendEmail({ to: email, subject, html });

    // Internal admin alert — new signup completed onboarding
    try {
      await sendResendEmail({
        to: 'info@blastybiz.com',
        subject: `[BlastyBiz] New signup: ${mergeData.name} (${email})`,
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
  <h2 style="margin:0 0 12px;font-size:18px">&#128226; New signup — onboarding complete</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#888;width:140px">Name</td><td style="padding:6px 0;font-weight:600">${mergeData.name}</td></tr>
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

    // Collect all top-level collections to delete
    const [bizSnap, activitySnap] =
      await Promise.all([
        userBizCol(uid).get(),
        db.collection('activityLogs').where('uid', '==', uid).get(),
      ]);

    // Walk each business and collect all subcollection docs to delete
    const bizSubRefs = [];
    for (const bizDoc of bizSnap.docs) {
      const bizId = bizDoc.id;
      const [draftsSnap, jobsSnap, connsSnap, pendingSnap, libSnap] = await Promise.all([
        userBizDraftsRef(uid, bizId).get(),
        userBizJobsRef(uid, bizId).get(),
        userBizConnsRef(uid, bizId).get(),
        userBizPostsRef(uid, bizId).get(),
        userBizRef(uid, bizId).collection('documents').get(),
      ]);
      draftsSnap.docs.forEach(d => bizSubRefs.push(d.ref));
      jobsSnap.docs.forEach(d => bizSubRefs.push(d.ref));
      connsSnap.docs.forEach(d => bizSubRefs.push(d.ref));
      pendingSnap.docs.forEach(d => bizSubRefs.push(d.ref));
      libSnap.docs.forEach(d => bizSubRefs.push(d.ref));
    }

    // Assemble all refs (aiUsageLogs intentionally excluded — billing records must be retained)
    const allRefs = [
      db.collection('users').doc(uid),
      db.collection('subscriptions').doc(uid),
      ...bizSnap.docs.map(d => d.ref),
      ...bizSubRefs,
      ...activitySnap.docs.map(d => d.ref),
    ];

    // Batch delete in chunks of 450 (Firestore hard limit is 500 per batch)
    const CHUNK = 450;
    for (let i = 0; i < allRefs.length; i += CHUNK) {
      const batch = db.batch();
      allRefs.slice(i, i + CHUNK).forEach(ref => batch.delete(ref));
      await batch.commit();
    }

    // Delete Storage files — wrapped so account deletion doesn't fail if Storage throws
    try {
      const storageBucket = admin.storage().bucket();
      await storageBucket.deleteFiles({ prefix: `users/${uid}/images/` });
    } catch(e) {
      console.error('[deleteAccount] Storage cleanup failed:', e.message);
    }

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

  try { await requireAdmin(req); }
  catch (e) { return res.status(e.status || 403).json({ error: e.message }); }

  const { name, value } = req.body;
  if (!name || !value) return res.status(400).json({ error: 'Missing name or value' });

  const ALLOWED = [
    'ANTHROPIC_API_KEY',
    'SQUARE_ACCESS_TOKEN','SQUARE_LOCATION_ID',
    'SQUARE_PRO_PLAN_ID','SQUARE_AGENCY_PLAN_ID','SQUARE_WEBHOOK_SIGNATURE_KEY',
    'GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
    'FACEBOOK_APP_ID','FACEBOOK_APP_SECRET',
    'RESEND_API_KEY','YELP_API_KEY'
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
  let snap;
  if (status) {
    snap = await db.collectionGroup('publishJobs').where('status', '==', status).get();
  } else {
    snap = await db.collectionGroup('publishJobs').get();
  }
  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  jobs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  res.json({ jobs: jobs.slice(0, Number(lim)) });
});

exports.adminListFailedJobs = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const snap = await db.collectionGroup('publishJobs')
    .where('status', 'in', ['failed', 'manual_required', 'manual_followup']).get();
  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  jobs.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  res.json({ jobs: jobs.slice(0, 100) });
});

exports.adminRetryJob = onRequest({ invoker: 'public', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  let adminDecoded;
  try { adminDecoded = await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const { jobId, uid: jobUid, businessId: jobBizId, force } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  if (!jobUid || !jobBizId) return res.status(400).json({ error: 'uid and businessId required' });

  const jobRef = userBizJobsRef(jobUid, jobBizId).doc(jobId);
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
        type:             'admin_force_retry',
        adminEmail:       adminDecoded?.email || 'unknown',
        jobId,
        uid:              jobUid,
        businessId:       jobBizId,
        platform:         job.platform,
        previousAttempts: currentAttempts,
        maxAttempts,
        forcedAt:         admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch(logErr) {
      console.warn('[adminRetryJob] activity log write failed:', logErr.message);
    }
  }

  // Claim the job so concurrent retries don't double-fire
  await jobRef.update({
    status: 'processing',
    attempts: admin.firestore.FieldValue.increment(1),
    adminError: '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  try {
    const connSnap = await userBizConnsRef(job.uid, job.businessId).doc(job.platform).get();
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
          status: 'manual_required',
          adminError: `No automated publisher for platform: ${job.platform}`,
          customerVisibleMessage: `Your AI-written copy for ${job.platform} is ready — this platform requires manual posting.`,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return res.status(200).json({ status: 'manual_required', platform: job.platform });
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
  const { jobId, uid: jobUid, businessId: jobBizId } = req.body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  if (!jobUid || !jobBizId) return res.status(400).json({ error: 'uid and businessId required' });
  await userBizJobsRef(jobUid, jobBizId).doc(jobId).update({
    status: 'manual_followup',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  res.json({ success: true });
});

exports.adminListBusinesses = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const snap = await db.collectionGroup('businesses').orderBy('createdAt', 'desc').limit(200).get();
  res.json({ businesses: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

exports.adminListPlatformConnections = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const snap = await db.collectionGroup('platformConnections').get();
  const conns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  conns.sort((a, b) => (b.connectedAt?.toMillis?.() || 0) - (a.connectedAt?.toMillis?.() || 0));
  res.json({ connections: conns.slice(0, 200) });
});

// Returns connection-health summary + list of broken/expiring connections joined with business names
exports.adminPlatformHealth = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }

  const snap = await db.collectionGroup('platformConnections').get();
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

  // Join broken connections with business names
  const bizIds = [...new Set(broken.map(c => c.businessId).filter(Boolean))];
  const bizMap = {};
  await Promise.all(broken.map(async c => {
    if (!c.businessId || !c.uid) return;
    try {
      const s = await userBizRef(c.uid, c.businessId).get();
      if (s.exists) bizMap[c.businessId] = s.data().businessName || c.businessId;
    } catch(e) { /* non-fatal */ }
  }));

  const now = Date.now();
  const result = broken.map(c => {
    const expiresAt = c.expiresAt ? (c.expiresAt.toDate ? c.expiresAt.toDate() : new Date(c.expiresAt)) : null;
    const daysSinceExpired = expiresAt ? Math.floor((now - expiresAt.getTime()) / 86400000) : null;
    return {
      id: c.id,
      businessId: c.businessId || '',
      businessName: (c.businessId && bizMap[c.businessId]) || '—',
      uid: c.uid || '',
      platform: c.platform || 'unknown',
      status: c.status || 'unknown',
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      daysSinceExpired,
      connectedAt: c.connectedAt ? (c.connectedAt.toDate ? c.connectedAt.toDate().toISOString() : new Date(c.connectedAt).toISOString()) : null,
    };
  }).sort((a, b) => (b.daysSinceExpired || 0) - (a.daysSinceExpired || 0));

  res.json({ counts, broken: result });
});

// Sends a one-off reconnect nudge email to the business owner for a given connection
exports.adminSendReconnectNudge = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }

  const { uid: nudgeUid, bizId: nudgeBizId, platform: nudgePlatform } = req.body;
  if (!nudgeUid || !nudgeBizId || !nudgePlatform) return res.status(400).json({ error: 'uid, bizId, and platform required' });

  const connSnap = await userBizConnsRef(nudgeUid, nudgeBizId).doc(nudgePlatform).get();
  if (!connSnap.exists) return res.status(404).json({ error: 'Connection not found' });
  const conn = connSnap.data();
  if (!conn.uid) return res.status(400).json({ error: 'Connection has no uid' });

  const userSnap = await db.collection('users').doc(conn.uid).get();
  if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
  const userData = userSnap.data();
  if (!userData.email) return res.status(400).json({ error: 'User has no email' });
  if (userData.emailUnsubscribed) return res.status(400).json({ error: 'User is unsubscribed' });

  let businessName = '';
  if (conn.businessId && conn.uid) {
    try {
      const bizSnap = await userBizRef(conn.uid, conn.businessId).get();
      businessName = bizSnap.data()?.businessName || '';
    } catch(e) { /* non-fatal */ }
  }

  const ownerName = userData.ownerName || userData.displayName || 'there';
  const platformDisplay = conn.platform === 'google' ? 'Google Business Profile'
    : (conn.platform || 'Platform').charAt(0).toUpperCase() + (conn.platform || 'Platform').slice(1);
  const connectUrl = `${APP_BASE_URL}/BlastyBiz-Connect.html`;
  const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(conn.uid)}&sig=${makeUnsubSig(conn.uid, process.env.RESEND_API_KEY)}`;
  const bizLabel = businessName || (ownerName !== 'there' ? ownerName + "'s Business" : 'your business');

  const subject = `Action needed — your ${platformDisplay} connection expired`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz</div>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Your ${platformDisplay} connection needs a quick reconnect, ${ownerName}.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">Your <strong>${platformDisplay}</strong> authorization for <strong>${bizLabel}</strong> has expired. Auto-posting to ${platformDisplay} is paused until you reconnect.</p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">It only takes a few seconds — just click the button below and authorize BlastyBiz again.</p>
    <a href="${connectUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Reconnect ${platformDisplay} &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Your content and campaigns are all still saved — nothing is lost.</p>
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
});

// ── createBusiness — server-enforced plan limits + atomic write ───────────────
// Onboarding calls this instead of writing Firestore directly.
// Returns { bizId } on success; 403 if the user has hit their plan cap.
exports.createBusiness = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let uid;
  try {
    const decoded = await verifyBearer(req);
    uid = decoded.uid;
  } catch(e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { profileData, isNew } = req.body || {};
  if (!profileData || typeof profileData !== 'object') {
    return res.status(400).json({ error: 'Missing profileData' });
  }
  const BIZ_LIMITS = { starter: 1, pro: 3, agency: 10 };
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const plan = userData.plan || 'starter';
    const cap = BIZ_LIMITS[plan] || 1;
    if (isNew) {
      const bizSnap = await userBizCol(uid).where('onboarded', '==', true).get();
      if (bizSnap.size >= cap) {
        return res.status(403).json({ error: 'Business limit reached', plan, cap, used: bizSnap.size });
      }
    }
    // New business: auto-generated ID. Editing existing: use the user's activeBusiness doc.
    const bizRef = isNew
      ? userBizCol(uid).doc()
      : userBizRef(uid, userData.activeBusiness || uid);
    // Strip any client-side timestamp fields — CF sets authoritative timestamps.
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
});

// ── adminGetAdminEmails / adminUpdateAdminEmails ───────────────────────────────
// Allow authorized admins to manage the dynamic admin list stored in config/admins.
// BOOTSTRAP_ADMIN_EMAILS (info@blastybiz.com) is always included and cannot be removed.
exports.adminGetAdminEmails = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const snap = await db.collection('config').doc('admins').get();
  const extra = snap.exists ? (snap.data().emails || []) : [];
  res.json({ bootstrap: BOOTSTRAP_ADMIN_EMAILS, extra });
});

exports.adminUpdateAdminEmails = onRequest({ invoker: 'public' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try { await requireAdmin(req); } catch(e) { return res.status(e.status || 403).json({ error: e.message }); }
  const { emails } = req.body || {};
  if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails must be an array' });
  const valid = emails.filter(e => typeof e === 'string' && e.includes('@'));
  await db.collection('config').doc('admins').set({
    emails: valid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ success: true, emails: valid });
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
    const data = d.data();
    const p = data.plan || 'starter';
    // Only count paid plans when the subscription is actually active
    if (p !== 'starter' && data.planActive !== true) return;
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

  const { name, category, description, locationType, website, requestId: spRequestId } = req.body;

  // Dedup check BEFORE usage reservation — cached hit returns without cost
  if (spRequestId) {
    try {
      const dedupSnap = await db.collection('aiRequestDedup').doc(`${decoded.uid}_${spRequestId}`).get();
      if (dedupSnap.exists) return res.json(dedupSnap.data().result);
    } catch(e) { console.warn('[suggestPlatforms] dedup read failed:', e.message); }
  }

  try {
    await reserveAiAction(decoded.uid);
  } catch(e) {
    if (e.message === 'LIMIT_REACHED') return res.status(429).json({ error: `AI limit reached (${e.used}/${e.cap} this month). Upgrade your plan for more.` });
    console.warn('[reserveAiAction] suggestPlatforms transaction failed, proceeding:', e.message);
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const fnStartMs = Date.now();

  const prompt = `You are a local business marketing expert. Based on the business info below, decide which platforms this business should target.

BUSINESS:
- Name: ${name}
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
- linkedin: LinkedIn (copy-paste only)
- x: X / Twitter (copy-paste only)

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
- linkedin: yes for B2B services, professional services (legal, accounting, consulting, marketing, SaaS, agencies), and businesses targeting other business owners; no for purely hyperlocal consumer services (plumbers, restaurants, nail salons) where no professional audience exists
- x: yes for businesses with timely content, promotions, events, or a strong brand voice; yes for B2C brands, tech, SaaS, food, entertainment, retail; optional for local services; no for very small hyperlocal-only businesses with no social content strategy

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
    "applemaps":  { "enabled": true,  "reason": "max 7 words why" },
    "linkedin":   { "enabled": false, "reason": "max 7 words why" },
    "x":          { "enabled": false, "reason": "max 7 words why" }
  }
}`;

  const aiStartMs = Date.now();
  try {
    const aiResp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
    });
    if (!aiResp.ok) {
      const t = await aiResp.text();
      const err = new Error(`Anthropic ${aiResp.status}: ${t.slice(0,200)}`);
      err._isHttpError = true;
      throw err;
    }
    const aiJson = await aiResp.json();
    const parsed = JSON.parse(aiJson.content[0].text.replace(/```json|```/g, '').trim());
    const aiElapsedMs = Date.now() - aiStartMs;
    trackAiUsage(decoded.uid, 'suggestPlatforms', 'claude-sonnet-4-5-20250929', aiJson.usage, {
      timing: { aiElapsedMs, fnElapsedMs: Date.now() - fnStartMs },
    });
    if (spRequestId) {
      try {
        await db.collection('aiRequestDedup').doc(`${decoded.uid}_${spRequestId}`).set({
          result: parsed,
          uid: decoded.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
        });
      } catch(e) { console.warn('[suggestPlatforms] dedup write failed:', e.message); }
    }
    res.json(parsed);
  } catch(e) {
    const failureType = classifyAiError(e);
    if (failureType === 'anthropic_timeout') console.warn('[AI_TIMEOUT] suggestPlatforms timed out after 25s — uid:', decoded.uid);
    trackAiUsage(decoded.uid, 'suggestPlatforms', 'claude-sonnet-4-5-20250929', null, { failureType });
    console.error('suggestPlatforms error [' + failureType + ']:', e.message);
    res.status(500).json({ error: 'AI suggestion failed: ' + e.message });
  }
});

exports.sendTestEmail = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  try { await requireAdmin(req); } catch(e) { return res.status(403).json({ error: 'Forbidden' }); }
  const { to, subject: rawSubject, html: rawHtml } = req.body;
  if (!to || !rawSubject || !rawHtml) return res.status(400).json({ error: 'to, subject, and html are required' });
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 'placeholder') return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  const SAMPLE = {
    name: 'Alex Johnson',
    businessName: 'Sunrise Café',
    planName: 'Pro',
    platform: 'Google Business',
    jobCount: '5',
    platformList: 'Google Business, Facebook, Instagram',
    dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
    upgradeUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
    appUrl: APP_BASE_URL,
  };
  function applyTags(str) {
    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE[k] ?? '');
  }
  const finalSubject = '[TEST] ' + applyTags(rawSubject);
  const finalHtml    = applyTags(rawHtml);

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'BlastyBiz <info@blastybiz.com>', to: [to], subject: finalSubject, html: finalHtml }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || 'Resend error', detail: data });
    return res.json({ ok: true, id: data.id, to });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════
// contactForm — public CF replacing Express /api/contact route
// Accepts to, name, email, message from the Contact page
// ══════════════════════════════════════════
exports.contactForm = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  const ALLOWED_TO = new Set(['support@blastybiz.com', 'info@blastybiz.com', 'sales@blastybiz.com', 'billing@blastybiz.com']);
  const { to, name, email, message } = req.body || {};
  if (!ALLOWED_TO.has(to)) return res.status(400).json({ error: 'Invalid recipient' });
  if (!name?.trim() || !email?.trim() || !message?.trim()) return res.status(400).json({ error: 'Missing fields' });
  if (name.trim().length > 200) return res.status(400).json({ error: 'Name too long' });
  if (email.trim().length > 200) return res.status(400).json({ error: 'Email too long' });
  if (message.trim().length > 3000) return res.status(400).json({ error: 'Message too long (3000 chars max)' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: 'Invalid email address' });

  // Rate limit: 5 submissions per IP per hour (stored in Firestore via Admin SDK)
  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    const ipKey = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const rlRef = db.collection('contactRateLimit').doc(ipKey);
    const rlSnap = await rlRef.get();
    const now = Date.now();
    const windowMs = 60 * 60 * 1000;
    if (rlSnap.exists) {
      const { count, windowStart } = rlSnap.data();
      if (now - windowStart < windowMs) {
        if (count >= 5) return res.status(429).json({ error: 'Too many messages. Please try again in an hour.' });
        await rlRef.update({ count: admin.firestore.FieldValue.increment(1) });
      } else {
        await rlRef.set({ count: 1, windowStart: now });
      }
    } else {
      await rlRef.set({ count: 1, windowStart: now });
    }
  } catch(e) { /* rate-limit check non-fatal — proceed if Firestore unavailable */ }

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
        from: 'BlastyBiz <info@blastybiz.com>',
        to: [to],
        reply_to: email.trim(),
        subject: `New message from ${safeName}`,
        html: `<p><strong>Name:</strong> ${safeName}<br><strong>Email:</strong> ${safeEmail}</p><p><strong>Message:</strong><br>${safeMessage}</p>`,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || 'Resend error' });
    return res.json({ success: true, id: data.id });
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
  { id: 'linkedin',  name: 'LinkedIn',           type: 'manual' },
  { id: 'x',        name: 'X (Twitter)',         type: 'manual' },
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
  const bizName  = biz.businessName || biz.name;
  const tone     = biz.tone || 'friendly';
  const address  = biz.address || (biz.city ? `${biz.city}, ${biz.state}` : '');
  const locType  = biz.locationType || 'physical';
  const region   = biz.region || '';

  // Look up active campaign's most recent ad details from listingDrafts
  let campaignContext = '';
  const activeCampaignId = sched.activeCampaignId || '';
  const schedUid = biz.uid || '';

  // Gate: only paid active users get scheduled AI posting.
  // Cache userData here — reused later to avoid a second Firestore read.
  let _schedUserData = {};
  if (schedUid) {
    try {
      const userSnap = await db.collection('users').doc(schedUid).get();
      _schedUserData = userSnap.exists ? userSnap.data() : {};
      const isPaid = _schedUserData.planActive === true &&
                     (_schedUserData.plan === 'pro' || _schedUserData.plan === 'agency');
      if (!isPaid) {
        console.log(`[scheduledPost] Skipping biz ${bizId} — not a paid active plan (uid=${schedUid})`);
        return;
      }
    } catch(e) {
      console.error(`[scheduledPost] plan check failed for biz ${bizId}:`, e.message);
      return; // Skip rather than risk free AI usage
    }
  }

  if (activeCampaignId) {
    try {
      const draftQ = await userBizDraftsRef(schedUid, bizId)
        .where('campaignId', '==', activeCampaignId)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      if (!draftQ.empty) {
        const d = draftQ.docs[0].data();
        const lines = [
          `Campaign: ${d.campaignName || sched.activeCampaignName || ''}`,
          d.adName    ? `Ad: ${d.adName}`           : '',
          d.offer     ? `Offer: ${d.offer}`          : '',
          d.adDetails ? `Details: ${d.adDetails}`    : '',
          d.price     ? `Price: ${d.price}`          : '',
        ].filter(Boolean);
        if (lines.length) campaignContext = '\nACTIVE CAMPAIGN (use this as the primary focus for every platform post):\n' + lines.join('\n');
      }
    } catch(e) {
      console.warn('[scheduledPost] campaign draft lookup failed:', e.message);
    }
  }

  // Build a "what we offer" summary from profile
  const offerLines = [
    biz.category ? `Category: ${biz.category}` : '',
    biz.offer || biz.description || '',
    biz.specialNotes ? `Notes: ${biz.specialNotes}` : '',
    biz.hours ? `Hours: ${biz.hours}` : '',
  ].filter(Boolean).join('\n');

  // Look up which platforms are connected for this business
  const connSnap = await userBizConnsRef(schedUid, bizId).where('status', '==', 'connected').get();
  const connectedIds = new Set(connSnap.docs.map(d => d.data().platform || d.id));

  const activePlatforms = SCHED_PLATFORMS.filter(p =>
    connectedIds.has(p.id) || p.type === 'manual'
  );
  if (!activePlatforms.length) return;

  const platformCats = biz.platformCats || {};

  const platformList = activePlatforms.map(p => ({
    ...p, doc: PLATFORM_DOCS[p.id] || {},
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
${(biz.bizInsights||[]).filter(i=>i.answer).length ? '\n⚠️ OWNER-PROVIDED FACTS — MANDATORY. The owner answered these questions so their copy is never generic. You MUST reference these details directly and specifically in the copy. Do NOT write filler when real facts are available:\n' + biz.bizInsights.filter(i=>i.answer).map(i=>`- ${i.question}: ${i.answer}`).join('\n') : ''}${(biz.globalFactoids||[]).length ? '\n⚠️ GLOBAL BUSINESS FACTS — Always true about this business. Reference naturally where relevant:\n' + biz.globalFactoids.map(f=>`- ${f.text}`).join('\n') : ''}${(biz.campaignFactoids||[]).length ? '\n⚠️ CAMPAIGN-SPECIFIC FACTS — Specific to this campaign. Work these in:\n' + biz.campaignFactoids.map(f=>`- ${f.text}`).join('\n') : ''}${campaignContext}
PLATFORMS TO WRITE FOR:
${platformList.map(buildPlatformBlock).join('\n')}

Return ONLY valid JSON: { "adaptations": { "PLATFORM_ID": "text" } }`;

  const aiStartMs = Date.now();
  let aiJson, parsed;
  try {
    const aiResp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!aiResp.ok) {
      const err = new Error(`Anthropic ${aiResp.status}: ${await aiResp.text()}`);
      err._isHttpError = true;
      throw err;
    }
    aiJson = await aiResp.json();
    parsed = JSON.parse(aiJson.content[0].text.replace(/```json|```/g, '').trim());
  } catch(e) {
    const failureType = classifyAiError(e);
    if (failureType === 'anthropic_timeout') console.warn('[AI_TIMEOUT] generateScheduledPost timed out after 25s — bizId:', bizId);
    trackAiUsage('system', 'generateScheduledPost', 'claude-sonnet-4-5-20250929', null, {
      failureType,
      context: { businessId: bizId || null, scheduleId: bizId || null, campaignId: activeCampaignId || null },
    });
    throw e;
  }
  const aiElapsedMs = Date.now() - aiStartMs;
  trackAiUsage('system', 'generateScheduledPost', 'claude-sonnet-4-5-20250929', aiJson.usage, {
    timing:  { aiElapsedMs },
    context: { businessId: bizId || null, scheduleId: bizId || null, campaignId: activeCampaignId || null },
  });
  const adapted = parsed.adaptations || {};

  // If owner wants to review before posting — save draft to pendingPosts and stop
  if (sched.requireApproval) {
    await userBizPostsRef(schedUid, bizId).add({
      bizId,
      uid: schedUid,
      status: 'pending',
      adaptations: adapted,
      platforms: activePlatforms,
      tone,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[scheduledPost] biz ${bizId} — requireApproval=true, saved to pendingPosts`);
    return;
  }

  // Reuse the plan cached from the paid-gate check above (avoids a second Firestore read)
  const uid = schedUid;
  const plan = _schedUserData.plan || 'starter';
  const isStarter = plan === 'starter';

  const batch = db.batch();
  for (const p of activePlatforms) {
    const content = adapted[p.id];
    if (!content) continue;
    const isManual = p.type === 'manual' || isStarter;
    const jobRef = userBizJobsRef(uid, bizId).doc();
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
    const BATCH_SIZE = 50;
    let lastDoc = null;

    while (true) {
      let q = db.collectionGroup('businesses')
        .where('postingSchedule.enabled', '==', true)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(BATCH_SIZE);
      if (lastDoc) q = q.startAfter(lastDoc);

      const snap = await q.get();
      if (snap.empty) break;

      for (const bizDoc of snap.docs) {
        const biz   = bizDoc.data();
        const bizId = bizDoc.id;
        const sched = biz.postingSchedule;
        if (!sched?.nextRunAt) continue;

        const nextRun = sched.nextRunAt.toDate ? sched.nextRunAt.toDate() : new Date(sched.nextRunAt);
        if (nextRun > now) continue;

        // Claim this document — prevents double-fire if Cloud Scheduler fires twice
        let claimed = false;
        try {
          await db.runTransaction(async (tx) => {
            const freshDoc  = await tx.get(bizDoc.ref);
            const freshSched = freshDoc.data()?.postingSchedule || {};
            if (freshSched.processing === true) {
              const claimedAt = freshSched.processingStartedAt?.toDate?.() || new Date(0);
              const stale = (now - claimedAt) > 10 * 60 * 1000; // 10 min staleness window
              if (!stale) return; // already claimed by another invocation
            }
            tx.update(bizDoc.ref, {
              'postingSchedule.processing': true,
              'postingSchedule.processingStartedAt': admin.firestore.FieldValue.serverTimestamp(),
            });
            claimed = true;
          });
        } catch(e) {
          console.warn(`[scheduledPostingCheck] claim tx failed for ${bizId}:`, e.message);
        }
        if (!claimed) continue;

        try {
          await _runScheduledPost(bizId, biz);
          const next = _computeNextRunAt(sched, now);
          await bizDoc.ref.update({
            'postingSchedule.lastRunAt':          admin.firestore.FieldValue.serverTimestamp(),
            'postingSchedule.nextRunAt':          admin.firestore.Timestamp.fromDate(next),
            'postingSchedule.updatedAt':          admin.firestore.FieldValue.serverTimestamp(),
            'postingSchedule.processing':         false,
            'postingSchedule.processingStartedAt': null,
          });
          console.log(`[scheduledPostingCheck] Posted for biz ${bizId}, next run: ${next.toISOString()}`);
        } catch (e) {
          await bizDoc.ref.update({
            'postingSchedule.processing':         false,
            'postingSchedule.processingStartedAt': null,
          }).catch(() => {});
          console.error(`[scheduledPostingCheck] biz ${bizId} failed:`, e.message);
        }
      }

      if (snap.docs.length < BATCH_SIZE) break;
      lastDoc = snap.docs[snap.docs.length - 1];
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

// ══════════════════════════════════════════
// scheduledUpgradeNudge
// Runs daily at 10am ET — finds free users who signed up exactly 7 days ago
// and haven't upgraded yet; sends a friendly "here's what you're missing" email.
// ══════════════════════════════════════════
exports.scheduledUpgradeNudge = onSchedule(
  { schedule: 'every day 10:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    // Query window: created between 8d ago and 7d ago (24-hour window).
    // Runs daily at 10am ET — each user lands in this window exactly once, no double-send risk.
    const windowStart = new Date(sevenDaysAgo);
    windowStart.setDate(windowStart.getDate() - 1);

    let tmplSubject = null;
    let tmplHtml = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'upgrade-nudge').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) {
        tmplSubject = tmplSnap.docs[0].data().subject;
        tmplHtml = tmplSnap.docs[0].data().html;
      }
    } catch(e) { console.error('[scheduledUpgradeNudge] template fetch failed:', e.message); }

    const usersSnap = await db.collection('users')
      .where('plan', '==', 'starter')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(windowStart))
      .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(sevenDaysAgo))
      .get();

    let sent = 0;
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      if (!userData.email) continue;
      if (userData.emailUnsubscribed) continue;
      const uid = userDoc.id;
      const ownerName = userData.ownerName || userData.displayName || '';
      let businessName = '';
      try {
        const bizSnap = await userBizCol(uid).limit(1).get();
        businessName = bizSnap.docs[0]?.data()?.businessName || '';
      } catch(e) { /* non-fatal */ }

      const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, process.env.RESEND_API_KEY)}`;

      const mergeData = {
        name: ownerName || 'there',
        businessName: businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
        upgradeUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
        dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
        appUrl: APP_BASE_URL,
        unsubscribeUrl: unsubUrl,
      };
      function applyNudgeTags(str) {
        return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
      }

      const subject = tmplSubject
        ? applyNudgeTags(tmplSubject)
        : `${mergeData.name}, BlastyBiz is ready to blast for ${mergeData.businessName} 👀`;
      const html = tmplHtml
        ? applyNudgeTags(tmplHtml)
        : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz</div>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hey ${mergeData.name} — it's been a week. Let's talk.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">You signed up 7 days ago, and <strong>${mergeData.businessName}</strong> is still on the free plan. That means you're doing the copy, the posting, the formatting — all of it by hand, for every platform, every time.</p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">BlastyBiz Pro does all of that in one click. Here's what you're leaving on the table:</p>
    <div style="background:#f0fff4;border-left:4px solid #00C853;border-radius:0 8px 8px 0;padding:20px 24px;margin-bottom:24px">
      <ul style="color:#444;font-size:14px;line-height:2.1;padding-left:18px;margin:0">
        <li>AI-written copy adapted for every major platform automatically</li>
        <li>Auto-posting — no login, no paste, no repeat</li>
        <li>Business Library — upload once, AI uses it every time</li>
        <li>Campaign history and copy archive</li>
      </ul>
    </div>
    <a href="${mergeData.upgradeUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Go Pro — Unlock Everything &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Questions before you upgrade? Reply to this email — we're real people who want to see ${mergeData.businessName} succeed.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

      try {
        await sendResendEmail({ to: userData.email, subject, html });
        sent++;
      } catch(e) { console.error(`[scheduledUpgradeNudge] failed for ${userData.email}:`, e.message); }
    }
    console.log(`[scheduledUpgradeNudge] sent ${sent} nudge emails`);
  }
);

// ══════════════════════════════════════════
// scheduledWeeklyDigest
// Runs every Monday at 8am ET — sends each paid user a recap of
// their published jobs from the past 7 days.
// ══════════════════════════════════════════
exports.scheduledWeeklyDigest = onSchedule(
  { schedule: 'every monday 08:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    let tmplSubject = null;
    let tmplHtml = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'weekly-digest').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) {
        tmplSubject = tmplSnap.docs[0].data().subject;
        tmplHtml = tmplSnap.docs[0].data().html;
      }
    } catch(e) { console.error('[scheduledWeeklyDigest] template fetch failed:', e.message); }

    // Get all paid users (pro or agency)
    const usersSnap = await db.collection('users')
      .where('planActive', '==', true)
      .get();

    let sent = 0;
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      if (!userData.email) continue;
      if (userData.emailUnsubscribed) continue;
      const uid = userDoc.id;
      const ownerName = userData.ownerName || userData.displayName || '';

      let businessName = '';
      let bizId = null;
      try {
        const bizSnap = await userBizCol(uid).limit(1).get();
        if (!bizSnap.empty) {
          businessName = bizSnap.docs[0].data().businessName || '';
          bizId = bizSnap.docs[0].id;
        }
      } catch(e) { /* non-fatal */ }

      // Get this week's successful jobs
      let successJobs = [];
      try {
        const jobsSnap = await db.collectionGroup('publishJobs')
          .where('uid', '==', uid)
          .where('status', '==', 'success')
          .get();
        const sevenDaysAgoMs = sevenDaysAgo.getTime();
        successJobs = jobsSnap.docs.map(d => d.data()).filter(j => {
          const pub = j.publishedAt?.toDate?.() || null;
          return pub && pub.getTime() >= sevenDaysAgoMs;
        });
      } catch(e) { /* non-fatal */ }

      // Only send if there were jobs this week
      if (successJobs.length === 0) continue;

      const platformList = [...new Set(successJobs.map(j =>
        (j.platform || 'platform').replace(/\b\w/g, c => c.toUpperCase())
      ))].join(', ');
      const jobCount = successJobs.length.toString();

      const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, process.env.RESEND_API_KEY)}`;

      const mergeData = {
        name: ownerName || 'there',
        businessName: businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
        jobCount,
        platformList,
        dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
        appUrl: APP_BASE_URL,
        unsubscribeUrl: unsubUrl,
      };
      function applyDigestTags(str) {
        return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
      }

      // Build platform rows for fallback HTML
      const platformRows = successJobs.map(j => {
        const plat = (j.platform || 'platform').replace(/\b\w/g, c => c.toUpperCase());
        return `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333">${plat}</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#00873a;text-align:right">&#10003; Published</td>
        </tr>`;
      }).join('');

      const subject = tmplSubject
        ? applyDigestTags(tmplSubject)
        : `${mergeData.businessName}'s BlastyBiz recap — ${jobCount} post${jobCount === '1' ? '' : 's'} this week 📊`;
      const html = tmplHtml
        ? applyDigestTags(tmplHtml)
        : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz</div>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <div style="font-size:12px;font-weight:700;color:#888;letter-spacing:2px;margin-bottom:8px">WEEKLY RECAP</div>
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 8px">${mergeData.businessName}</h1>
    <p style="font-size:15px;color:#555;margin:0 0 24px">Here's what BlastyBiz published for you this week, ${mergeData.name}.</p>
    <div style="background:#f0fff4;border-radius:8px;padding:16px 20px;margin-bottom:24px;text-align:center">
      <div style="font-size:40px;font-weight:800;color:#00873a;line-height:1">${jobCount}</div>
      <div style="font-size:13px;color:#555;margin-top:4px">post${jobCount === '1' ? '' : 's'} published across ${platformList}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${platformRows}</table>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">View Full History &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Keep the momentum going — blast to more platforms from your dashboard.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; Sent every Monday to Pro &amp; Agency subscribers. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

      try {
        await sendResendEmail({ to: userData.email, subject, html });
        sent++;
      } catch(e) { console.error(`[scheduledWeeklyDigest] failed for ${userData.email}:`, e.message); }
    }
    console.log(`[scheduledWeeklyDigest] sent ${sent} digest emails`);
  }
);

// ══════════════════════════════════════════
// unsubscribeEmail
// GET /unsubscribeEmail?uid=<uid>&sig=<hmac-hex>
// HMAC-signed — sig = HMAC-SHA256(uid, RESEND_API_KEY); prevents uid-guessing attacks
// Sets emailUnsubscribed: true on the users doc
// ══════════════════════════════════════════
exports.unsubscribeEmail = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['RESEND_API_KEY'] }, async (req, res) => {
  const uid = req.query.uid;
  const sig = req.query.sig;
  if (!uid || !sig) return res.status(400).send('<p>Missing unsubscribe parameters.</p>');

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).send('<p>Configuration error.</p>');

  const expected = makeUnsubSig(uid, apiKey);
  let sigValid = false;
  try {
    sigValid = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch(e) { /* invalid hex — sigValid stays false */ }
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
// scheduledSetupNudge
// Runs daily at 9am ET — finds users who signed up 24h+ ago
// but never completed onboarding (no business doc); sends a nudge email.
// ══════════════════════════════════════════
exports.scheduledSetupNudge = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async () => {
    // Query setupNudges docs that are unsent and past their sendAfter time
    let nudgesSnap;
    try {
      nudgesSnap = await db.collection('setupNudges')
        .where('sent', '==', false)
        .where('sendAfter', '<=', admin.firestore.Timestamp.now())
        .get();
    } catch(e) {
      // Composite index may not be deployed yet — fallback: query sendAfter only, filter sent in code
      console.warn('[scheduledSetupNudge] composite query failed, using fallback:', e.message);
      nudgesSnap = await db.collection('setupNudges')
        .where('sendAfter', '<=', admin.firestore.Timestamp.now())
        .get();
    }

    let sent = 0;
    for (const nudgeDoc of nudgesSnap.docs) {
      const nudgeData = nudgeDoc.data();
      // Fallback filter if composite index wasn't available
      if (nudgeData.sent === true) continue;

      const uid = nudgeData.uid;
      if (!uid) { await nudgeDoc.ref.delete(); continue; }

      // Check if user already has a business in the subcollection
      const bizQuery = await userBizCol(uid).limit(1).get();
      if (!bizQuery.empty) {
        await db.collection('setupNudges').doc(uid).delete();
        continue;
      }

      // 3. No business found — user abandoned onboarding. Check user doc.
      let userDoc;
      try {
        userDoc = await db.collection('users').doc(uid).get();
      } catch(e) { console.error('[scheduledSetupNudge] users read failed:', e.message); continue; }

      if (!userDoc.exists) { await db.collection('setupNudges').doc(uid).delete(); continue; }
      const userData = userDoc.data();

      if (!userData.email) { await db.collection('setupNudges').doc(uid).delete(); continue; }
      if (userData.emailUnsubscribed) { await db.collection('setupNudges').doc(uid).delete(); continue; }

      const ownerName = userData.ownerName || userData.displayName || '';
      const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, process.env.RESEND_API_KEY)}`;

      let tmplSubject = null;
      let tmplHtml = null;
      try {
        const tmplSnap = await db.collection('emailTemplates')
          .where('type', '==', 'setup-nudge').where('active', '==', true).limit(1).get();
        if (!tmplSnap.empty) {
          tmplSubject = tmplSnap.docs[0].data().subject;
          tmplHtml = tmplSnap.docs[0].data().html;
        }
      } catch(e) { console.warn('[scheduledSetupNudge] template fetch failed:', e.message); }

      const mergeData = {
        name: ownerName || 'there',
        onboardingUrl: APP_BASE_URL + '/BlastyBiz-Onboarding.html',
        appUrl: APP_BASE_URL,
        unsubscribeUrl: unsubUrl,
      };
      function applyNudgeTags(str) {
        return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
      }

      const subject = tmplSubject
        ? applyNudgeTags(tmplSubject)
        : `${mergeData.name}, finish setting up your BlastyBiz profile`;
      const html = tmplHtml
        ? applyNudgeTags(tmplHtml)
        : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz</div>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hey ${mergeData.name} — your profile is almost ready.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">You created your BlastyBiz account yesterday but haven't finished setting up your business profile yet. It only takes a few minutes — and once it's done, BlastyBiz writes the copy for every platform automatically.</p>
    <a href="${mergeData.onboardingUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Finish Setup &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Questions? Reply to this email — a real person reads every reply.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

      try {
        await sendResendEmail({ to: userData.email, subject, html });
        await db.collection('setupNudges').doc(uid).update({ sent: true });
        sent++;
      } catch(e) { console.error(`[scheduledSetupNudge] failed for ${userData.email}:`, e.message); }
    }
    console.log(`[scheduledSetupNudge] sent ${sent} setup nudge emails`);
  }
);

// ══════════════════════════════════════════
// Scheduled: checkPlatformTokenExpiry
// Runs every 30 minutes. Scans all connected platformConnections where
// expiresAt is in the past or within the next 5 minutes. For Google
// connections with a refreshToken, proactively refreshes the access token.
// All others are marked 'expired' so the Connect page shows the Reconnect UI.
// ══════════════════════════════════════════
exports.checkPlatformTokenExpiry = onSchedule(
  {
    schedule: 'every 30 minutes',
    region: 'us-central1',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  },
  async () => {
    const cutoffShort = new Date(Date.now() + 5 * 60 * 1000);       // now + 5 min  (Google etc.)
    const cutoffFb    = new Date(Date.now() + 7 * 24 * 3600 * 1000); // now + 7 days (Facebook/Instagram)

    // Load the platform-expired email template once for the whole run
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

    for (const docSnap of snap.docs) {
      const conn = docSnap.data();

      // Skip docs with no expiresAt (pre-existing connections before this feature)
      if (!conn.expiresAt) { skipped++; continue; }

      const expiresAt = conn.expiresAt.toDate ? conn.expiresAt.toDate() : new Date(conn.expiresAt);
      const isFbOrIg  = conn.platform === 'facebook' || conn.platform === 'instagram';
      const cutoff    = isFbOrIg ? cutoffFb : cutoffShort;

      if (expiresAt > cutoff) { skipped++; continue; } // still fresh

      // Navigate to the paired Instagram doc in the same biz subcollection
      const igRef = docSnap.ref.parent.parent.collection('platformConnections').doc('instagram');

      // Facebook connections: attempt proactive token exchange (extends another ~60 days)
      if (conn.platform === 'facebook' && conn.accessToken) {
        try {
          const resp = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
              grant_type:       'fb_exchange_token',
              client_id:        process.env.FACEBOOK_APP_ID,
              client_secret:    process.env.FACEBOOK_APP_SECRET,
              fb_exchange_token: conn.accessToken,
            },
          });
          const { access_token, expires_in } = resp.data;
          const newExpiresAt = new Date(Date.now() + (expires_in || 60 * 24 * 3600) * 1000);

          // Update the Facebook doc
          await docSnap.ref.update({
            accessToken: access_token,
            expiresAt:   newExpiresAt,
            updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[checkPlatformTokenExpiry] Refreshed Facebook token for biz ${conn.businessId}`);

          // Mirror to the Instagram doc if it exists (same page token)
          const igSnap  = await igRef.get();
          if (igSnap.exists && igSnap.data().status === 'connected') {
            await igRef.update({
              accessToken: access_token,
              expiresAt:   newExpiresAt,
              updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`[checkPlatformTokenExpiry] Mirrored refreshed token to instagram for biz ${conn.businessId}`);
          }

          refreshed++;
          continue;
        } catch (e) {
          console.warn(`[checkPlatformTokenExpiry] Facebook refresh failed for biz ${conn.businessId}:`,
            e.response?.data || e.message);
          // Also mark the paired Instagram doc expired — it shares the same dead token.
          // Do this before falling through so the FB doc handler below marks both consistently.
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
          // Fall through — mark FB expired below
        }
      }

      // Instagram docs are always handled via their paired Facebook doc (refresh on success,
      // expire on failure). Skip independent Instagram expiry processing to avoid double-writes.
      if (conn.platform === 'instagram') { skipped++; continue; }

      // Google connections: attempt proactive token refresh
      if (conn.platform === 'google' && conn.refreshToken) {
        try {
          const resp = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
              client_id:     process.env.GOOGLE_CLIENT_ID,
              client_secret: process.env.GOOGLE_CLIENT_SECRET,
              refresh_token: conn.refreshToken,
              grant_type:    'refresh_token',
            },
          });
          const { access_token, expires_in } = resp.data;
          await docSnap.ref.update({
            accessToken: access_token,
            expiresAt:   new Date(Date.now() + (expires_in || 3600) * 1000),
            updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[checkPlatformTokenExpiry] Refreshed Google token for ${docSnap.id}`);
          refreshed++;
          continue;
        } catch (e) {
          console.warn(`[checkPlatformTokenExpiry] Google refresh failed for ${docSnap.id}:`,
            e.response?.data || e.message);
          // Fall through — mark expired and notify owner
        }
      }

      // Cannot refresh — mark expired so the UI shows the Reconnect button
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

      // Send reconnect notification email to the business owner
      if (!conn.uid) continue;
      try {
        const userSnap = await db.collection('users').doc(conn.uid).get();
        if (!userSnap.exists) continue;
        const userData = userSnap.data();
        if (!userData.email || userData.emailUnsubscribed) continue;

        const ownerName = userData.ownerName || userData.displayName || '';
        let businessName = '';
        try {
          const bizSnap = await userBizRef(conn.uid, conn.businessId).get();
          businessName = bizSnap.data()?.businessName || '';
        } catch(e) { /* non-fatal */ }

        const platformDisplay = conn.platform === 'google' ? 'Google Business Profile'
          : conn.platform.charAt(0).toUpperCase() + conn.platform.slice(1);

        const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(conn.uid)}&sig=${makeUnsubSig(conn.uid, process.env.RESEND_API_KEY)}`;
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
    <div style="font-family:'Arial Black',sans-serif;font-size:24px;color:#00C853">BlastyBiz</div>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:4px;font-weight:700">LOCK. LOAD. BLAST.</div>
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
        console.log(`[checkPlatformTokenExpiry] Sent expiry email to ${userData.email} for ${docSnap.id}`);
      } catch(e) {
        console.error(`[checkPlatformTokenExpiry] Email failed for ${docSnap.id}:`, e.message);
      }
    }

    console.log(`[checkPlatformTokenExpiry] Done — refreshed: ${refreshed}, expired: ${expired}, skipped: ${skipped}`);
  }
);

