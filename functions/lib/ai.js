'use strict';
const { db, admin } = require('./db');
const { getPlanConfig } = require('./plans');

// ── AI cost tracking — prices per million tokens ──────────────────────────────
const AI_COSTS = {
  'claude-haiku-4-5':           { input: 0.80,  output:  4.00 },
  'claude-sonnet-4-5-20250929': { input: 3.00,  output: 15.00 },
  'claude-opus-4-5':            { input: 15.00, output: 75.00 },
  'gpt-4o':                     { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':                { input: 0.15,  output:  0.60 },
  'gpt-5':                      { input: 2.50,  output: 10.00 },
  'gemini-flash-latest':        { input: 0.10,  output:  0.40 },
  'gemini-flash-lite-latest':   { input: 0.075, output:  0.30 },
  'gemini-3.1-flash-lite':      { input: 0.10,  output:  0.40 },
  'gemini-2.5-pro':             { input: 1.25,  output:  5.00 },
  'gemini-2.5-flash':           { input: 0.075, output:  0.30 },
  'grok-3':                     { input: 3.00,  output: 15.00 },
  'grok-3-mini':                { input: 0.30,  output:  0.50 },
};

// ── AI provider settings — admin-switchable, Firestore-backed ────────────────
// Stored in config/aiSettings: { provider, fastModel, smartModel }
// In-memory cache with 60s TTL avoids a Firestore read on every AI call.
const AI_DEFAULTS = {
  provider:   'gemini',
  fastModel:  'gemini-3.1-flash-lite',
  smartModel: 'gemini-3.1-flash-lite',
};

let _aiSettingsCache   = null;
let _aiSettingsCacheAt = 0;
const AI_SETTINGS_TTL  = 60_000;

async function getAiSettings() {
  const now = Date.now();
  if (_aiSettingsCache && now - _aiSettingsCacheAt < AI_SETTINGS_TTL) return _aiSettingsCache;
  try {
    const snap = await db.collection('config').doc('aiSettings').get();
    _aiSettingsCache = snap.exists ? { ...AI_DEFAULTS, ...snap.data() } : { ...AI_DEFAULTS };
  } catch { _aiSettingsCache = _aiSettingsCache || { ...AI_DEFAULTS }; }
  _aiSettingsCacheAt = now;
  return _aiSettingsCache;
}

// Called by adminSetAiSettings so subsequent calls pick up the new settings immediately
function resetAiSettingsCache() {
  _aiSettingsCache   = null;
  _aiSettingsCacheAt = 0;
}

// ── fetchWithTimeout — wraps fetch() with an AbortController timeout ──────────
async function fetchWithTimeout(url, options, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── callAI — provider-agnostic wrapper for every AI call ─────────────────────
// content:   string (single user prompt) OR ChatMessage[] (conversation history)
// system:    optional system/instruction prompt (string)
// tier:      'fast' or 'smart' — picks fastModel / smartModel from settings
// Returns    { text, usage: { input_tokens, output_tokens }, model }
const _OAI_BASES    = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  grok:   'https://api.x.ai/v1',
};
const _OAI_KEY_VARS = { openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', grok: 'XAI_API_KEY' };

async function callAI(content, { system = '', maxTokens = 1024, tier = 'smart', timeoutMs = 25000 } = {}) {
  const settings = await getAiSettings();
  const provider = settings.provider || 'anthropic';
  const model    = tier === 'fast' ? settings.fastModel : settings.smartModel;
  const messages = Array.isArray(content) ? content : [{ role: 'user', content }];

  if (provider === 'anthropic') {
    const body = { model, max_tokens: maxTokens, messages };
    if (system) body.system = system;
    const resp = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) },
      timeoutMs
    );
    if (!resp.ok) { const err = new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`); err._isHttpError = true; throw err; }
    const j = await resp.json();
    return { text: j.content[0].text, usage: j.usage, model };
  }

  // OpenAI-compatible providers (openai, gemini, grok)
  const baseUrl = _OAI_BASES[provider];
  const apiKey  = process.env[_OAI_KEY_VARS[provider]];
  if (!baseUrl || !apiKey) throw new Error(`Provider "${provider}" is not configured — set its API key as a Firebase secret and redeploy functions once.`);
  const oaiMsgs = system
    ? [{ role: 'system', content: system }, ...messages.filter(m => m.role !== 'system')]
    : messages;
  const resp = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model, max_tokens: maxTokens, messages: oaiMsgs }) },
    timeoutMs
  );
  if (!resp.ok) { const err = new Error(`${provider} ${resp.status}: ${(await resp.text()).slice(0, 200)}`); err._isHttpError = true; throw err; }
  const j = await resp.json();
  return { text: j.choices[0].message.content, usage: { input_tokens: j.usage?.prompt_tokens || 0, output_tokens: j.usage?.completion_tokens || 0 }, model };
}

async function trackAiUsage(uid, fnName, model, usage, opts = {}) {
  const { failureType = null, timing = null, context = null } = opts;
  if (!usage && !failureType) return;
  try {
    const rates   = AI_COSTS[model] || { input: 3.00, output: 15.00 };
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
// counter — all in one Firestore transaction.
// Throws { message: 'LIMIT_REACHED', used, cap, plan } if at cap.
async function reserveAiAction(uid) {
  return db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const snap    = await tx.get(userRef);
    const data    = snap.exists ? snap.data() : {};
    const plan    = data.plan || 'starter';
    const cfg     = await getPlanConfig();
    const cap     = cfg.aiLimits[plan] || cfg.aiLimits.starter;
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

// ── classifyAiError — maps caught errors to structured failureType strings ─────
function classifyAiError(e) {
  if (e.name === 'AbortError')                               return 'anthropic_timeout';
  if (e.name === 'SyntaxError')                              return 'json_parse';
  if (e._isHttpError)                                        return 'anthropic_http';
  if (/network|fetch/i.test(e.message))                      return 'network_error';
  if (/firebase|firestore/i.test(e.message))                 return 'firebase_error';
  return 'unknown';
}

module.exports = {
  AI_COSTS, AI_DEFAULTS,
  getAiSettings, resetAiSettingsCache,
  fetchWithTimeout, callAI,
  trackAiUsage, reserveAiAction, classifyAiError,
};
