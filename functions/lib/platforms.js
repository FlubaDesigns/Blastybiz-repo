'use strict';

// ── Platform documentation blocks — used by AI prompts ───────────────────────
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
    tone:"Inspiring, aspirational, and helpful — write like you're sharing a great idea, not running an ad",
    dos:['Weave in 2-4 natural keywords in the first sentence — Pinterest is a search engine','Write a specific, descriptive title that tells exactly what the pin is about','Describe what the viewer will get, learn, see, or experience','Include a soft CTA (visit us, save this, try it today)','2-3 targeted hashtags at the end — specific beats generic'],
    donts:['No hashtag stuffing — 2-3 max, highly relevant only','No aggressive sales language — inspire first, sell second','Do not write a generic caption — specificity drives saves and clicks','No all-caps','Do not skip the title — it appears in search results and is your first impression'],
    images:{required:true, notes:'Image is everything on Pinterest. Vertical 2:3 ratio strongly preferred (e.g. 1000×1500px). Bright, high-quality, well-composed images dramatically outperform dark or cluttered ones. JPG or PNG.'}
  }
};

function buildPlatformBlock(p) {
  const d = p.doc || {};
  return [
    `\n=== ${(d.name || p.name).toUpperCase()} (json key: "${p.id}") — ${p.type === 'api' ? 'AUTO-POST' : 'COPY-PASTE'}${p.cat ? ' | ' + p.cat.replace(/^\s*\(category:\s*/i,'').replace(/\)\s*$/,'') : ''} ===`,
    `PURPOSE: ${d.purpose || ''}`,
    `FORMAT: ${d.format || ''} Max ${d.maxChars || 1000} characters.`,
    `TONE: ${d.tone || ''}`,
    d.dos  && d.dos.length  ? `DO: ${d.dos.join(' | ')}` : '',
    d.donts && d.donts.length ? `DON'T: ${d.donts.join(' | ')}` : '',
    d.images ? `IMAGES: ${d.images.required ? '(REQUIRED) ' : '(recommended) '}${d.images.notes}` : ''
  ].filter(Boolean).join('\n');
}

module.exports = { PLATFORM_DOCS, buildPlatformBlock };
