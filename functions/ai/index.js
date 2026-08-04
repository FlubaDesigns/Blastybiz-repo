'use strict';
const { onRequest } = require('firebase-functions/v2/https');

const { db, admin }               = require('../lib/db');
const { withAuth }                = require('../lib/auth');
const { checkUidRateLimit }       = require('../lib/rateLimit');
const { callAI, trackAiUsage, reserveAiAction, classifyAiError, AI_DEFAULTS, resetAiSettingsCache } = require('../lib/ai');
const { PLATFORM_DOCS, buildPlatformBlock } = require('../lib/platforms');

// ══════════════════════════════════════════
// generateEnrichmentQuestions
// POST /generateEnrichmentQuestions
// ══════════════════════════════════════════
exports.generateEnrichmentQuestions = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] }, withAuth(async (req, res, decoded) => {

  try {
    await reserveAiAction(decoded.uid);
  } catch(e) {
    if (e.message === 'LIMIT_REACHED') return res.status(429).json({ error: `AI limit reached (${e.used}/${e.cap} this month). Upgrade your plan for more.` });
    console.error('[reserveAiAction] generateEnrichmentQuestions transaction failed:', e.message);
    return res.status(500).json({ error: 'Could not verify AI usage limit. Please try again.' });
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

  let _genModel;
  const aiStartMs = Date.now();
  try {
    const { text: aiText, usage: aiUsage, model } = await callAI(prompt, { tier: 'fast', maxTokens: 300 });
    _genModel = model;
    const parsed = JSON.parse(aiText.replace(/```json|```/g, '').trim());
    const aiElapsedMs = Date.now() - aiStartMs;
    trackAiUsage(decoded.uid, 'followUpQuestions', _genModel, aiUsage, { timing: { aiElapsedMs } });
    res.json({ questions: parsed.questions || [] });
  } catch(e) {
    const failureType = classifyAiError(e);
    if (failureType === 'anthropic_timeout') console.warn('[AI_TIMEOUT] generateEnrichmentQuestions timed out after 25s — uid:', decoded.uid);
    trackAiUsage(decoded.uid, 'followUpQuestions', _genModel || AI_DEFAULTS.fastModel, null, { failureType });
    console.error('generateEnrichmentQuestions error [' + failureType + ']:', e.message);
    res.status(500).json({ error: e.message });
  }
}));

// ══════════════════════════════════════════
// suggestCategory
// POST /suggestCategory
// ══════════════════════════════════════════
exports.suggestCategory = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] }, withAuth(async (req, res, decoded) => {
  if (!(await checkUidRateLimit('suggestCategoryRateLimit', decoded.uid, 20, 60 * 60 * 1000))) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  const { bizName } = req.body;
  if (!bizName) return res.status(400).json({ error: 'bizName required' });
  try {
    const { text } = await callAI(
      `What type of business is "${bizName}"? Reply with ONLY the business category, 1-4 words. Examples: "Hair Salon", "Mexican Restaurant", "Auto Repair Shop", "Digital Marketing Agency", "Landscaping Company", "Coffee Shop". No punctuation, no explanation — just the category.`,
      { tier: 'fast', maxTokens: 20 }
    );
    res.json({ category: text.trim().replace(/^["']+|["']+$/g, '') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

// ══════════════════════════════════════════
// adaptListing
// POST /adaptListing
// ══════════════════════════════════════════
exports.adaptListing = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'], timeoutSeconds: 120 }, withAuth(async (req, res, decoded) => {
  const fnStartMs = Date.now();

  const { listing, platforms, tone, platformCats } = req.body;

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
    console.error('[reserveAiAction] adaptListing transaction failed:', e.message);
    return res.status(500).json({ error: 'Could not verify AI usage limit. Please try again.' });
  }
  const platformList = (platforms || []).map(p => ({
    id: p.id, name: p.name, type: p.type,
    doc: PLATFORM_DOCS[p.id] || {},
    cat: (platformCats || {})[p.id] ? ` (category: ${platformCats[p.id]})` : ''
  }));

  const { aiContext, globalMemory, campaignMemory } = listing;

  const globalMemoryBlock = globalMemory
    ? '\n📋 GLOBAL BUSINESS MEMORY — Read this first. This is the authoritative briefing about this business. Weave these facts, story, personality, and differentiators naturally into every platform\'s copy. Never contradict anything stated here:\n' + globalMemory + '\n'
    : '';

  const campaignMemoryBlock = campaignMemory
    ? '\n🎯 CAMPAIGN MEMORY — Full brief for this campaign. Use the hook, specific items, urgency, and audience details to make copy feel fresh and specific — not generic:\n' + campaignMemory + '\n'
    : '';

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
${globalMemoryBlock}${campaignMemoryBlock}${aiContextBlock}${libraryDocsBlock}${campaignContextBlock}${(listing.bizInsights||[]).length ? '\n⚠️ CAMPAIGN-SPECIFIC AI FACTS — MANDATORY. These answers are specific to this campaign. Reference them directly — do NOT write generic filler:\n' + listing.bizInsights.map(i=>`- ${i.question}: ${i.answer}`).join('\n') : ''}${(listing.globalFactoids||[]).length ? '\n📌 BUSINESS FACTS — Use selectively. Include a fact only when it genuinely strengthens this specific post. Do NOT force every fact into every piece. Higher score = stronger brand signal:\n' + [...listing.globalFactoids].sort((a,b)=>(b.importance!=null?b.importance:5)-(a.importance!=null?a.importance:5)).map(f=>`- [${f.importance!=null?f.importance:5}/10] ${f.text}`).join('\n') : ''}${(listing.campaignFactoids||[]).length ? '\n📌 CAMPAIGN FACTS — Use selectively. Include only when it fits naturally for this campaign. Higher score = more likely to strengthen this copy:\n' + [...listing.campaignFactoids].sort((a,b)=>(b.importance!=null?b.importance:5)-(a.importance!=null?a.importance:5)).map(f=>`- [${f.importance!=null?f.importance:5}/10] ${f.text}`).join('\n') : ''}
PLATFORMS TO ADAPT FOR:
${platformList.map(buildPlatformBlock).join('\n')}

Return this exact JSON structure — use each platform's exact json key shown above in the section header:
{
  "adaptations": {
${platformList.map(p => `    "${p.id}": "adapted text for ${p.name}"`).join(',\n')}
  }
}`;

  let parsed;
  let _adaptModel;
  const aiStartMs = Date.now();
  try {
    const { text: aiText, usage: aiUsage, model } = await callAI(prompt, { tier: 'smart', maxTokens: 4096, timeoutMs: 110000 });
    _adaptModel = model;
    parsed = JSON.parse(aiText.replace(/```json|```/g, '').trim());
    const aiElapsedMs = Date.now() - aiStartMs;
    trackAiUsage(decoded.uid, 'adaptListing', _adaptModel, aiUsage, {
      timing:  { aiElapsedMs, fnElapsedMs: Date.now() - fnStartMs },
      context: { businessId: listing.businessId || null, campaignId: listing.campaignId || null },
    });
  } catch(e) {
    const failureType = classifyAiError(e);
    if (failureType === 'anthropic_timeout') console.warn('[AI_TIMEOUT] adaptListing timed out after 110s — uid:', decoded.uid);
    trackAiUsage(decoded.uid, 'adaptListing', _adaptModel || AI_DEFAULTS.smartModel, null, { failureType });
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
}));

// ══════════════════════════════════════════
// resolveCategories
// POST /resolveCategories
// ══════════════════════════════════════════
exports.resolveCategories = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] }, withAuth(async (req, res, decoded) => {
  const fnStartMs = Date.now();

  const { businessName, ownerName, city, state, description, specialNotes, followUpAnswers, platformCatLists, locationType, requestId: rcRequestId } = req.body;

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
    console.error('[reserveAiAction] resolveCategories transaction failed:', e.message);
    return res.status(500).json({ error: 'Could not verify AI usage limit. Please try again.' });
  }

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
  let _rcModel;
  const aiStartMs = Date.now();
  try {
    const { text: aiText, usage: aiUsage, model } = await callAI(prompt, { tier: 'smart', maxTokens: 1024 });
    _rcModel = model;
    parsed = JSON.parse(aiText.replace(/```json|```/g, '').trim());
    const aiElapsedMs = Date.now() - aiStartMs;
    trackAiUsage(decoded.uid, 'resolveCategories', _rcModel, aiUsage, {
      timing: { aiElapsedMs, fnElapsedMs: Date.now() - fnStartMs },
    });
  } catch(e) {
    const failureType = classifyAiError(e);
    if (failureType === 'anthropic_timeout') console.warn('[AI_TIMEOUT] resolveCategories timed out after 25s — uid:', decoded.uid);
    trackAiUsage(decoded.uid, 'resolveCategories', _rcModel || AI_DEFAULTS.smartModel, null, { failureType });
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
}));

// ══════════════════════════════════════════
// suggestPlatforms
// POST /suggestPlatforms
// ══════════════════════════════════════════
exports.suggestPlatforms = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] }, withAuth(async (req, res, decoded) => {

  const { name, category, description, locationType, website, requestId: spRequestId } = req.body;

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
    console.error('[reserveAiAction] suggestPlatforms transaction failed:', e.message);
    return res.status(500).json({ error: 'Could not verify AI usage limit. Please try again.' });
  }
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

  let _spModel;
  const aiStartMs = Date.now();
  try {
    const { text: aiText, usage: aiUsage, model } = await callAI(prompt, { tier: 'smart', maxTokens: 600 });
    _spModel = model;
    const parsed = JSON.parse(aiText.replace(/```json|```/g, '').trim());
    const aiElapsedMs = Date.now() - aiStartMs;
    trackAiUsage(decoded.uid, 'suggestPlatforms', _spModel, aiUsage, {
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
    trackAiUsage(decoded.uid, 'suggestPlatforms', _spModel || AI_DEFAULTS.smartModel, null, { failureType });
    console.error('suggestPlatforms error [' + failureType + ']:', e.message);
    res.status(500).json({ error: 'AI suggestion failed: ' + e.message });
  }
}));

// ══════════════════════════════════════════
// chatCampaign
// POST /chatCampaign
// ══════════════════════════════════════════
exports.chatCampaign = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] }, withAuth(async (req, res, decoded) => {

  const { conversationHistory, businessProfile, collectedData } = req.body;
  if (!Array.isArray(conversationHistory)) return res.status(400).json({ error: 'conversationHistory array required' });

  const bp = businessProfile || {};
  const cd = collectedData  || {};

  const campaignBasics = [
    cd.campaignName ? `Campaign Name: ${cd.campaignName}` : null,
    cd.offer        ? `Offer/Message: ${cd.offer}`        : null,
    cd.price        ? `Price/Range: ${cd.price}`          : null,
    cd.dates        ? `Dates: ${cd.dates}`                : null,
  ].filter(Boolean).join('\n');

  const systemPrompt = `You are a campaign briefing assistant for BlastyBiz. You already know this business well. Your job is to gather campaign-specific details that make this campaign's marketing copy feel fresh, specific, and compelling — never generic.

BUSINESS PROFILE (you know this business):
${bp.globalMemory || bp.description || bp.name || 'Business profile not provided'}

CAMPAIGN BASICS ALREADY COLLECTED:
${campaignBasics || '(none yet)'}

CAMPAIGN INTERVIEW SCRIPT — one question at a time, conversationally. Reference what you know about the business to make questions feel tailored. Stop when you have enough for specific copy:
1. What's the main hook — what should customers get excited about?
2. Any specific products, services, or items featured in this campaign?
3. Any in-store experience, decorations, events, or atmosphere customers will encounter?
4. Any story or tradition behind this campaign?
5. Any urgency — limited time, limited stock, exclusive deal, or hard deadline?
6. Who are you specifically trying to reach with this campaign?
7. Anything that makes this campaign feel different from your usual marketing?

WHEN TO STOP: Stop when you have the hook, at least one specific detail, and any urgency or uniqueness. 3–6 exchanges is typically enough.

Return ONLY valid JSON. No markdown.
If continuing: {"done":false,"message":"your next conversational question"}
If finished: {"done":true,"message":"brief warm wrap-up line","campaignMemory":"rich paragraph(s) capturing everything specific to this campaign — the hook, featured items, atmosphere or experience, story or tradition, urgency, target audience, and what makes it feel unique. Written as a briefing for a copywriter who will write platform-specific posts."}`;

  const messages = conversationHistory.length ? conversationHistory
    : [{ role: 'user', content: `Start the campaign brief for "${cd.campaignName || 'this campaign'}".` }];

  try {
    const { text: aiText, usage: aiUsage, model: aiModel } = await callAI(messages, { tier: 'fast', maxTokens: 600, system: systemPrompt, timeoutMs: 30000 });
    const raw = aiText.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch(e) { parsed = { done: false, message: raw.slice(0, 300) }; }
    trackAiUsage(decoded.uid, 'chatCampaign', aiModel, aiUsage, {});
    return res.json(parsed);
  } catch(e) {
    console.error('[chatCampaign] error:', e.message);
    return res.status(500).json({ error: 'Campaign interview failed. Please try again.' });
  }
}));

// ══════════════════════════════════════════
// adminGetAiSettings
// GET /adminGetAiSettings  (admin only)
// ══════════════════════════════════════════
exports.adminGetAiSettings = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  const { AI_DEFAULTS: defaults, getAiSettings } = require('../lib/ai');
  try {
    const snap = await db.collection('config').doc('aiSettings').get();
    const data = snap.exists ? snap.data() : {};
    return res.json({
      provider:   data.provider   || defaults.provider,
      fastModel:  data.fastModel  || defaults.fastModel,
      smartModel: data.smartModel || defaults.smartModel,
    });
  } catch(e) {
    console.error('[adminGetAiSettings]', e.message);
    return res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ══════════════════════════════════════════
// adminSetAiSettings
// POST /adminSetAiSettings  (admin only)
// Resets in-memory cache so new calls pick up the change within seconds.
// ══════════════════════════════════════════
exports.adminSetAiSettings = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {

  const VALID_PROVIDERS = ['anthropic', 'openai', 'gemini', 'grok'];
  const { provider, fastModel, smartModel } = req.body;
  if (!provider || !fastModel || !smartModel) return res.status(400).json({ error: 'provider, fastModel, and smartModel are required' });
  if (!VALID_PROVIDERS.includes(provider)) return res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });

  try {
    await db.collection('config').doc('aiSettings').set({ provider, fastModel, smartModel }, { merge: true });
    resetAiSettingsCache();
    console.log(`[adminSetAiSettings] Updated to provider=${provider} fast=${fastModel} smart=${smartModel}`);
    return res.json({ ok: true, provider, fastModel, smartModel });
  } catch(e) {
    console.error('[adminSetAiSettings]', e.message);
    return res.status(500).json({ error: e.message });
  }
}, { admin: true }));

// ══════════════════════════════════════════
// scoreFact
// POST /scoreFact
// ══════════════════════════════════════════
exports.scoreFact = onRequest({ invoker: 'public', secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] }, async (req, res) => {
  const { setCors } = require('../lib/auth');
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const { admin: fbAdmin } = require('../lib/db');
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try { await fbAdmin.auth().verifyIdToken(authHeader.slice(7)); } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' });

  try {
    const { text: aiText } = await callAI(
      `You are a marketing intelligence assistant. A local business owner added this fact to their AI memory bank.\n\nScore it 1–10 for marketing importance:\n10 = foundational brand identity that should appear in most marketing copy (e.g. "family-owned since 1905", "fastest response in the city")\n5 = useful context used when relevant\n1 = very temporary or highly specific detail rarely relevant to copy\n\nFact: "${text.slice(0, 500)}"\n\nReturn ONLY valid JSON with no explanation: {"score": N}`,
      { tier: 'fast', maxTokens: 20, timeoutMs: 10000 }
    );
    let score = 5;
    try {
      const parsed = JSON.parse(aiText.trim());
      score = Math.min(10, Math.max(1, Math.round(Number(parsed.score)) || 5));
    } catch(_) {
      const m = aiText.match(/\d+/);
      if (m) score = Math.min(10, Math.max(1, parseInt(m[0])));
    }
    res.json({ score });
  } catch(e) {
    console.error('[scoreFact]', e.message);
    res.json({ score: 5 }); // graceful fallback — scoring is non-critical
  }
});
