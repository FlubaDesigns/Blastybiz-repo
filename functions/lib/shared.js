/**
 * BlastyBiz — shared helpers for all Cloud Function modules
 * Every module does:  const { db, withAuth, bbLog, ... } = require('../lib/shared');
 */
'use strict';

const { onRequest }                             = require('firebase-functions/v2/https');
const { onSchedule }                            = require('firebase-functions/v2/scheduler');
const { onDocumentUpdated, onDocumentCreated }  = require('firebase-functions/v2/firestore');
const admin                                     = require('firebase-admin');

// ── Base URL for all web-app redirects (checkout, OAuth, emails) ──────────────
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://blastybiz-9523e.web.app';

const Anthropic = require('@anthropic-ai/sdk');
const axios     = require('axios');
const crypto    = require('crypto');

// ── Resend email helper (uses native fetch — Node 22) ─────────────────────────
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

// ── Lazy-init Square client — secret not available at module load time ─────────
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

// ── Private token subcollection helpers ───────────────────────────────────────
async function _getConnTokens(connRef) {
  const snap = await connRef.collection('private').doc('tokens').get();
  return snap.exists ? snap.data() : {};
}
async function _setConnTokens(connRef, tokens) {
  await connRef.collection('private').doc('tokens').set(tokens, { merge: true });
}

// ── AI cost tracking ──────────────────────────────────────────────────────────
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

// ── AI provider settings — admin-switchable, Firestore-backed ─────────────────
let _aiSettingsCache = null;
let _aiSettingsCacheAt = 0;
const AI_SETTINGS_TTL = 60_000;
const AI_DEFAULTS = {
  provider:   'gemini',
  fastModel:  'gemini-flash-lite-latest',
  smartModel: 'gemini-flash-lite-latest',
};

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

// Exported so adminSetAiSettings can reset this instance's cache immediately
function resetAiSettingsCache() {
  _aiSettingsCache = null;
  _aiSettingsCacheAt = 0;
}

// ── callAI — provider-agnostic wrapper ────────────────────────────────────────
const _OAI_BASES = {
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

// ── reserveAiAction — atomic AI usage gate ────────────────────────────────────
// opts.draftRef    — Firestore DocumentReference for the listing draft (optional)
// opts.isRegeneration — when true, the first regen of a draft is free (doesn't burn a credit)
async function reserveAiAction(uid, opts = {}) {
  const { draftRef, isRegeneration } = opts;
  return db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);

    // Read user doc + draft doc (if free-regen path) in one round-trip
    const reads = [tx.get(userRef)];
    if (isRegeneration && draftRef) reads.push(tx.get(draftRef));
    const [snap, draftSnap] = await Promise.all(reads);

    const data    = snap.exists ? snap.data() : {};
    const plan    = data.plan || 'starter';
    const cfg     = await getPlanConfig();
    const cap     = cfg.aiLimits[plan] || cfg.aiLimits.starter;
    const resetAt = data.aiActionsResetAt?.toDate?.() || null;
    const now     = new Date();
    const needsReset = !resetAt || now > resetAt;
    const used    = needsReset ? 0 : (data.aiActionsUsed || 0);

    // Free first-regeneration: skip the credit counter for the first regen per draft.
    // draftSnap.exists must be true — a non-existent or fabricated draftId gets no free regen.
    // Atomically mark freeRegenUsed on the draft so concurrent calls can't both get free.
    if (isRegeneration && draftRef && draftSnap && draftSnap.exists && !draftSnap.data()?.freeRegenUsed) {
      tx.set(draftRef, { freeRegenUsed: true }, { merge: true });
      return { plan, used, cap, freeRegen: true };
    }

    if (used >= cap) {
      throw Object.assign(new Error('LIMIT_REACHED'), { used, cap, plan });
    }

    // Use set+merge (not update) so this works even when users/{uid} doc is absent.
    // tx.update() throws NOT_FOUND (code 5) on a missing document; tx.set({merge:true})
    // creates it. FieldValue.increment works correctly with set+merge on missing fields.
    if (needsReset) {
      tx.set(userRef, {
        aiActionsUsed: 1,
        aiActionsResetAt: admin.firestore.Timestamp.fromDate(
          new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        ),
      }, { merge: true });
    } else {
      tx.set(userRef, {
        aiActionsUsed: admin.firestore.FieldValue.increment(1),
      }, { merge: true });
    }

    return { plan, used: used + 1, cap, freeRegen: false };
  });
}

// ── fetchWithTimeout ──────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── safeFetchUrl — SSRF-safe URL fetch for user-supplied URLs ─────────────────
// Use this (not fetchWithTimeout) whenever the URL comes from user input.
// Validates scheme, resolves hostname against private/reserved ranges, caps
// response size to 2 MB, caps redirects at 3, and re-validates after each.
// Throws a typed Error with e.code starting with 'SSRF_' on any violation.
// Never returns the raw body to a client — callers extract structured data only.
function _isPrivateAddress(ip) {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [, a, b] = v4.map(Number);
    return (
      a === 10 ||                                // 10.0.0.0/8
      a === 127 ||                               // 127.0.0.0/8
      a === 0 ||                                 // 0.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) ||       // 172.16.0.0/12
      (a === 192 && b === 168) ||                // 192.168.0.0/16
      (a === 169 && b === 254) ||                // 169.254.0.0/16 link-local
      (a === 100 && b >= 64 && b <= 127)         // 100.64.0.0/10 shared
    );
  }
  const lc = ip.toLowerCase();
  if (lc.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — check the embedded IPv4 part
    const embedded = lc.slice(7);
    if (embedded.includes('.')) return _isPrivateAddress(embedded);
  }
  return (
    lc === '::1' ||            // loopback
    lc === '::' ||             // unspecified
    lc.startsWith('fc') ||     // fc00::/7
    lc.startsWith('fd') ||     // fd00::/8
    lc.startsWith('fe80:')     // link-local
  );
}

async function safeFetchUrl(url) {
  const dns = require('dns');

  async function validateHost(hostname) {
    let entries;
    try {
      entries = await dns.promises.lookup(hostname, { all: true });
    } catch {
      throw Object.assign(new Error('SSRF_DNS_FAILED'), { code: 'SSRF_DNS_FAILED' });
    }
    for (const { address } of entries) {
      if (_isPrivateAddress(address)) {
        throw Object.assign(new Error('SSRF_PRIVATE_IP'), { code: 'SSRF_PRIVATE_IP', address });
      }
    }
  }

  let parsed;
  try { parsed = new URL(url); } catch {
    throw Object.assign(new Error('SSRF_INVALID_URL'), { code: 'SSRF_INVALID_URL' });
  }
  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error('SSRF_NOT_HTTPS'), { code: 'SSRF_NOT_HTTPS' });
  }
  await validateHost(parsed.hostname);

  const MAX_SIZE   = 2 * 1024 * 1024; // 2 MB
  let currentUrl   = url;
  let redirectCount = 0;

  while (redirectCount <= 3) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let resp;
    try {
      resp = await fetch(currentUrl, {
        signal:   controller.signal,
        redirect: 'manual',
        headers:  { 'User-Agent': 'BlastyBiz/1.0 (business-context-extractor)' },
      });
    } finally {
      clearTimeout(timer);
    }

    if (resp.status >= 300 && resp.status < 400) {
      redirectCount++;
      if (redirectCount > 3) throw Object.assign(new Error('SSRF_TOO_MANY_REDIRECTS'), { code: 'SSRF_TOO_MANY_REDIRECTS' });
      const location = resp.headers.get('location');
      if (!location) throw Object.assign(new Error('SSRF_REDIRECT_NO_LOCATION'), { code: 'SSRF_REDIRECT_NO_LOCATION' });
      let redir;
      try { redir = new URL(location, currentUrl); } catch {
        throw Object.assign(new Error('SSRF_INVALID_REDIRECT'), { code: 'SSRF_INVALID_REDIRECT' });
      }
      if (redir.protocol !== 'https:') throw Object.assign(new Error('SSRF_NOT_HTTPS'), { code: 'SSRF_NOT_HTTPS' });
      await validateHost(redir.hostname);
      currentUrl = redir.href;
      continue;
    }

    if (!resp.ok) throw Object.assign(new Error('SSRF_HTTP_ERROR'), { code: 'SSRF_HTTP_ERROR', status: resp.status });

    const clHeader = parseInt(resp.headers.get('content-length') || '0', 10);
    if (clHeader > MAX_SIZE) throw Object.assign(new Error('SSRF_TOO_LARGE'), { code: 'SSRF_TOO_LARGE' });

    const reader = resp.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_SIZE) { await reader.cancel(); throw Object.assign(new Error('SSRF_TOO_LARGE'), { code: 'SSRF_TOO_LARGE' }); }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
  }
  throw Object.assign(new Error('SSRF_TOO_MANY_REDIRECTS'), { code: 'SSRF_TOO_MANY_REDIRECTS' });
}

// ── classifyAiError ───────────────────────────────────────────────────────────
function classifyAiError(e) {
  if (e.name === 'AbortError')                               return 'anthropic_timeout';
  if (e.name === 'SyntaxError')                              return 'json_parse';
  if (e._isHttpError)                                        return 'anthropic_http';
  if (/network|fetch/i.test(e.message))                      return 'network_error';
  if (/firebase|firestore/i.test(e.message))                 return 'firebase_error';
  return 'unknown';
}

const ALLOWED_ORIGINS = new Set([
  'https://blastybiz.com',
  'https://www.blastybiz.com',
  'https://blastybiz-9523e.web.app',
  'https://blastybiz-9523e.firebaseapp.com',
]);

// ── Per-uid rate limiter (Firestore-backed, transactional) ────────────────────
async function checkUidRateLimit(collectionName, uid, maxCount, windowMs) {
  try {
    const rlRef = db.collection(collectionName).doc(uid);
    const now = Date.now();
    const allowed = await db.runTransaction(async (txn) => {
      const rlSnap = await txn.get(rlRef);
      if (rlSnap.exists) {
        const { count, windowStart } = rlSnap.data();
        if (now - windowStart < windowMs) {
          if (count >= maxCount) return false;
          txn.update(rlRef, { count: admin.firestore.FieldValue.increment(1) });
        } else {
          txn.set(rlRef, { count: 1, windowStart: now, expiresAt: admin.firestore.Timestamp.fromMillis(now + windowMs) });
        }
      } else {
        txn.set(rlRef, { count: 1, windowStart: now, expiresAt: admin.firestore.Timestamp.fromMillis(now + windowMs) });
      }
      return true;
    });
    return allowed;
  } catch(e) { return false; }
}

function setCors(req, res) {
  const origin = req && req.headers && req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
}

// ── withAuth ──────────────────────────────────────────────────────────────────
function withAuth(fn, opts = {}) {
  return async (req, res) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    let decoded = null;
    if (!opts.public) {
      if (opts.admin) {
        try { decoded = await requireAdmin(req); }
        catch (e) {
          bbLog('WARNING', 'withAuth', { event: 'admin_auth_failed', status: e.status || 403, msg: e.message });
          return res.status(e.status || 403).json({ error: e.message });
        }
      } else {
        try { decoded = await verifyBearer(req); }
        catch (e) {
          bbLog('WARNING', 'withAuth', { event: 'user_auth_failed', status: 401 });
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }
    }
    return fn(req, res, decoded);
  };
}

// ── bbLog — structured logging helper (4.8) ───────────────────────────────────
function bbLog(severity, fn, data = {}) {
  const entry = JSON.stringify({ severity, fn, ...data });
  if (severity === 'ERROR' || severity === 'WARNING') {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
async function verifyBearer(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing Authorization header'), { status: 401 });
  }
  const token = authHeader.slice(7);
  return await admin.auth().verifyIdToken(token);
}

// Single permanent bootstrap — only appears in code as a lockout-prevention last resort.
// All other admins (including perceys@gmail.com) live exclusively in config/admins Firestore doc.
const PERMANENT_ADMIN_EMAIL = 'info@blastybiz.com';

async function getAdminEmails() {
  try {
    const ref = db.collection('config').doc('admins');
    const snap = await ref.get();
    if (snap.exists) {
      const emails = snap.data().emails || [];
      // Self-heal: permanent admin must always be in the list
      if (!emails.includes(PERMANENT_ADMIN_EMAIL)) {
        const healed = [PERMANENT_ADMIN_EMAIL, ...emails];
        await ref.update({ emails: healed }).catch(() => {});
        return healed;
      }
      return emails;
    }
    // First boot — seed Firestore with founder emails so rules and functions share one list
    const seed = ['info@blastybiz.com', 'perceys@gmail.com'];
    await ref.set({ emails: seed }).catch(() => {});
    return seed;
  } catch(e) { /* fall through */ }
  return [PERMANENT_ADMIN_EMAIL]; // ultimate fallback
}

async function requireAdmin(req) {
  const decoded = await verifyBearer(req);
  if (!decoded.email_verified) {
    throw Object.assign(new Error('Email not verified'), { status: 403 });
  }
  const adminEmails = await getAdminEmails();
  if (!adminEmails.includes(decoded.email)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  return decoded;
}

// ── HMAC-signed unsubscribe tokens ────────────────────────────────────────────
function makeUnsubSig(uid, secret) {
  return crypto.createHmac('sha256', secret).update(uid).digest('hex');
}
function _unsubSecret() {
  return process.env.UNSUB_SIGNING_KEY || process.env.RESEND_API_KEY;
}

// ── HMAC-signed draft action tokens (approve / skip / change / pause) ─────────
// Signature covers uid + draftId + action + cycle so that none of those params
// can be tampered with without invalidating the link. cycle is the epoch-ms
// timestamp embedded in the URL; its integrity is enforced by the signature,
// and expiry is verified against the same signed value.
function makeActionSig(uid, draftId, action, cycle, key) {
  return crypto.createHmac('sha256', key).update(`${uid}:${draftId}:${action}:${cycle}`).digest('hex');
}
function _actionSecret() {
  return process.env.ACTION_SIGNING_KEY || process.env.UNSUB_SIGNING_KEY || process.env.RESEND_API_KEY;
}

// ── Shared schedule helper ────────────────────────────────────────────────────
function computeNextRunAt(schedule, now) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const freq = (schedule && schedule.frequency) || 'weekly';
  if (freq === 'daily')   return new Date(now.getTime() + DAY_MS);
  if (freq === 'monthly') return new Date(now.getTime() + 30 * DAY_MS);
  return new Date(now.getTime() + 7 * DAY_MS); // weekly default
}

// ── getPlanConfig — single source of truth for all plan entitlements (4.4) ────
const _PLAN_CONFIG_DEFAULTS = {
  aiLimits:  { trial: 10, starter: 10, pro: 100, agency: 500 },
  bizLimits: { trial: 1,  starter: 1,  pro: 3,   agency: 10  },
  prices:    { proMonthly: null, agencyMonthly: null, proAnnual: null, agencyAnnual: null },
};
let _planConfigCache = null;
let _planConfigCachedAt = 0;
const _PLAN_CONFIG_TTL = 5 * 60 * 1000;

async function getPlanConfig() {
  const now = Date.now();
  if (_planConfigCache && now - _planConfigCachedAt < _PLAN_CONFIG_TTL) return _planConfigCache;
  try {
    const snap = await db.collection('config').doc('plans').get();
    const d = snap.exists ? snap.data() : {};
    _planConfigCache = {
      aiLimits:  { ..._PLAN_CONFIG_DEFAULTS.aiLimits,  ...(d.aiLimits  || {}) },
      bizLimits: { ..._PLAN_CONFIG_DEFAULTS.bizLimits, ...(d.bizLimits || {}) },
      prices:    { ..._PLAN_CONFIG_DEFAULTS.prices,    ...(d.prices    || {}) },
    };
  } catch(e) {
    console.warn('[getPlanConfig] Firestore read failed, using defaults:', e.message);
    _planConfigCache = {
      aiLimits:  { ..._PLAN_CONFIG_DEFAULTS.aiLimits  },
      bizLimits: { ..._PLAN_CONFIG_DEFAULTS.bizLimits },
      prices:    { ..._PLAN_CONFIG_DEFAULTS.prices    },
    };
  }
  _planConfigCachedAt = now;
  return _planConfigCache;
}

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
    `\n=== ${(d.name || p.name).toUpperCase()} (json key: "${p.id}") — ${p.type === 'api' ? 'AUTO-POST' : 'COPY-PASTE'}${p.cat ? ' | ' + p.cat.replace(/^\s*\(category:\s*/i,'').replace(/\)\s*$/,'') : ''} ===`,
    `PURPOSE: ${d.purpose || ''}`,
    `FORMAT: ${d.format || ''} Max ${d.maxChars || 1000} characters.`,
    `TONE: ${d.tone || ''}`,
    d.dos  && d.dos.length  ? `DO: ${d.dos.join(' | ')}` : '',
    d.donts && d.donts.length ? `DON'T: ${d.donts.join(' | ')}` : '',
    d.images ? `IMAGES: ${d.images.required ? '(REQUIRED) ' : '(recommended) '}${d.images.notes}` : ''
  ].filter(Boolean).join('\n');
}

module.exports = {
  // firebase-functions v2
  onRequest, onSchedule, onDocumentUpdated, onDocumentCreated,
  // firebase-admin
  admin, db,
  // utilities
  APP_BASE_URL, Anthropic, axios, crypto,
  // email
  sendResendEmail,
  // square
  getSquare,
  // path helpers
  userBizRef, userBizCol, userBizDraftsRef, userBizJobsRef, userBizPostsRef, userBizConnsRef,
  // token helpers
  _getConnTokens, _setConnTokens,
  // AI
  AI_COSTS, AI_DEFAULTS, trackAiUsage, getAiSettings, resetAiSettingsCache, callAI,
  reserveAiAction, fetchWithTimeout, safeFetchUrl, classifyAiError,
  // CORS / auth
  ALLOWED_ORIGINS, checkUidRateLimit, setCors, withAuth,
  bbLog, verifyBearer,
  PERMANENT_ADMIN_EMAIL, getAdminEmails, requireAdmin,
  // unsub
  makeUnsubSig, _unsubSecret,
  // action signing
  makeActionSig, _actionSecret,
  // schedule helper
  computeNextRunAt,
  // plans
  getPlanConfig,
  // constants
  JOB_STATUS, PLATFORM_DOCS, buildPlatformBlock,
};
