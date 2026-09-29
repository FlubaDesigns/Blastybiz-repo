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
    if (snap.exists) {
      _aiSettingsCache = { ...AI_DEFAULTS, ...snap.data() };
    } else {
      // The config doc is the source of truth — falling back to code defaults is
      // exactly what made the 2026-08 Gemini retirement invisible. Make it loud.
      bbLog('WARNING', 'getAiSettings', { event: 'ai_settings_doc_missing', msg: 'config/aiSettings missing — using hardcoded AI_DEFAULTS. Create the doc via the admin AI settings panel.' });
      _aiSettingsCache = { ...AI_DEFAULTS };
    }
  } catch (e) {
    bbLog('WARNING', 'getAiSettings', { event: 'ai_settings_read_failed', msg: e.message });
    _aiSettingsCache = _aiSettingsCache || { ...AI_DEFAULTS };
  }
  _aiSettingsCacheAt = now;
  return _aiSettingsCache;
}

// Exported so adminSetAiSettings can reset this instance's cache immediately
function resetAiSettingsCache() {
  _aiSettingsCache = null;
  _aiSettingsCacheAt = 0;
}

// ── AI health reporting — makes a rejected model visible to admins ───────────
// Writes the most recent provider rejection to config/aiHealth so the admin
// dashboard can surface it. Throttled per instance to avoid write storms when
// every AI call is failing at once.
let _lastAiFailureWriteAt = 0;
const AI_FAILURE_WRITE_THROTTLE = 60_000;
function recordAiFailure(provider, model, status, message) {
  bbLog('ERROR', 'callAI', { event: 'ai_provider_rejected', provider, model, status, msg: (message || '').slice(0, 300) });
  const now = Date.now();
  if (now - _lastAiFailureWriteAt < AI_FAILURE_WRITE_THROTTLE) return;
  _lastAiFailureWriteAt = now;
  db.collection('config').doc('aiHealth').set({
    lastError: {
      provider, model,
      status:  status || null,
      message: (message || '').slice(0, 500),
      at:      admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true }).catch(e => console.warn('[recordAiFailure] write failed:', e.message));
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
    if (!resp.ok) {
      const bodyText = (await resp.text()).slice(0, 300);
      await recordAiFailure(provider, model, resp.status, bodyText);
      const err = new Error(`Anthropic ${resp.status}: ${bodyText.slice(0, 200)}`); err._isHttpError = true; throw err;
    }
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
  if (!resp.ok) {
    const bodyText = (await resp.text()).slice(0, 300);
    await recordAiFailure(provider, model, resp.status, bodyText);
    const err = new Error(`${provider} ${resp.status}: ${bodyText.slice(0, 200)}`); err._isHttpError = true; throw err;
  }
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
    const grantRef = isRegeneration && draftRef ? draftRef.collection('private').doc('aiAllowance') : null;
    if (grantRef) reads.push(tx.get(draftRef), tx.get(grantRef));
    const [snap, draftSnap, grantSnap] = await Promise.all(reads);

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
    if (grantRef && draftSnap?.exists && grantSnap?.exists && grantSnap.data().uid === uid && grantSnap.data().freeRegenUsed === false) {
      tx.update(grantRef, { freeRegenUsed: true, usedAt: admin.firestore.FieldValue.serverTimestamp() });
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
  } catch(e) { return true; }
}

function setCors(req, res) {
  const origin = req && req.headers && req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
    // Any authenticated call is proof the account is in use. Fire and forget,
    // throttled per instance, so it costs nothing on the hot path.
    if (decoded && decoded.uid) touchLastActive(decoded.uid);
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
// V2 binds the account, business, draft, action and scheduled occurrence.
// Old links intentionally fail validation: they did not bind the business/cycle.
function makeActionSig(uid, bizId, draftId, action, cycle, key) {
  return crypto.createHmac('sha256', key).update(JSON.stringify(['v2', uid, bizId, draftId, action, cycle])).digest('hex');
}
function _actionSecret() {
  return process.env.ACTION_SIGNING_KEY || process.env.UNSUB_SIGNING_KEY || process.env.RESEND_API_KEY;
}

// ── Shared schedule helper ────────────────────────────────────────────────────
const { computeNextRunAt, normalizeSchedule } = require('./schedule');

// ── getPlanConfig — single source of truth for all plan entitlements (4.4) ────
const _PLAN_CONFIG_DEFAULTS = {
  aiLimits:  { trial: 10, starter: 10, pro: 100, agency: 500 },
  bizLimits: { trial: 1,  starter: 1,  pro: 3,   agency: 10  },
  prices:    { proMonthly: null, agencyMonthly: null, proAnnual: null, agencyAnnual: null },
  // Free-account data retention. Editable in config/plans — never hardcode these
  // numbers at a call site, they are a business decision and a privacy promise.
  //   mode 'report' — count only, send nothing, delete nothing (the safe default)
  //   mode 'warn'   — send warning emails, still delete nothing
  //   mode 'purge'  — warn AND delete accounts whose warning window has expired
  retention: {
    mode: 'report',
    dormantDays: 365,
    warningDays: 14,
    finalReminderDays: 3,
    maxWarnPerRun: 100,
    maxPurgePerRun: 25,
  },
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
      retention: { ..._PLAN_CONFIG_DEFAULTS.retention, ...(d.retention || {}) },
    };
  } catch(e) {
    console.warn('[getPlanConfig] Firestore read failed, using defaults:', e.message);
    _planConfigCache = {
      aiLimits:  { ..._PLAN_CONFIG_DEFAULTS.aiLimits  },
      bizLimits: { ..._PLAN_CONFIG_DEFAULTS.bizLimits },
      prices:    { ..._PLAN_CONFIG_DEFAULTS.prices    },
      // Falling back to defaults means falling back to 'report' — a config read
      // failure must never be able to start deleting accounts.
      retention: { ..._PLAN_CONFIG_DEFAULTS.retention },
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
  NEEDS_CONNECTION:   'needs_connection',
  MANUAL_REQUIRED:    'manual_required',
  MANUAL_FOLLOWUP:    'manual_followup',
  MANUAL_COMPLETED:   'manual_completed',
  CLOSED:             'closed',
};

// Shared delivery and writing facts; public/platforms-authority.js is generated
// from this same module. Admin presentation overrides cannot invent publishers.
const { PLATFORM_CAPABILITY_MAP, PLATFORM_DOCS, AUTO_POST_PLATFORMS } = require('./platforms');

function buildPlatformBlock(p) {
  const d = p.doc || {};
  return [
    `\n=== ${(d.name || p.name).toUpperCase()} (json key: "${p.id}") — ${PLATFORM_CAPABILITY_MAP[p.id]?.deliveryMode === 'auto' ? 'Blasty Posts It' : 'Ready for You to Post'}${p.cat ? ' | ' + p.cat.replace(/^\s*\(category:\s*/i,'').replace(/\)\s*$/,'') : ''} ===`,
    `PURPOSE: ${d.purpose || ''}`,
    `FORMAT: ${d.format || ''} Max ${d.maxChars || 1000} characters.`,
    `TONE: ${d.tone || ''}`,
    d.dos  && d.dos.length  ? `DO: ${d.dos.join(' | ')}` : '',
    d.donts && d.donts.length ? `DON'T: ${d.donts.join(' | ')}` : '',
    d.images ? `IMAGES: ${d.images.required ? '(REQUIRED) ' : '(recommended) '}${d.images.notes}` : ''
  ].filter(Boolean).join('\n');
}

// ── Account activity signal ───────────────────────────────────────────────────
// `lastActiveAt` on users/{uid} is what the retention sweep measures dormancy
// against. Getting it wrong deletes a live owner's data, so it is written from
// two independent places: here (any authenticated Cloud Function call) and from
// the client on app load. Either one alone is enough to keep an account alive.
//
// A missing lastActiveAt is deliberately NOT treated as dormant — Firestore
// range queries skip documents without the field, so accounts that predate this
// or somehow lose it can never be swept. Backfill sets it from real evidence.
const _LAST_ACTIVE_THROTTLE_MS = 6 * 60 * 60 * 1000;
const _lastActiveTouched = new Map();

function touchLastActive(uid) {
  if (!uid) return;
  const now = Date.now();
  const prev = _lastActiveTouched.get(uid);
  if (prev && now - prev < _LAST_ACTIVE_THROTTLE_MS) return;
  _lastActiveTouched.set(uid, now);
  // Instances are ephemeral and this map is per-instance, so the throttle is
  // best-effort — worst case is a few redundant writes, never a missed one.
  if (_lastActiveTouched.size > 5000) _lastActiveTouched.clear();

  // Fire and forget: activity tracking must never fail or slow a real request.
  // Coming back also cancels any pending purge — clearing the warning markers in
  // the same write costs nothing and means an owner who returns after a warning
  // email is safe immediately, not merely at the next sweep.
  db.collection('users').doc(uid)
    .set({
      lastActiveAt:        admin.firestore.FieldValue.serverTimestamp(),
      dormancyWarnedAt:    admin.firestore.FieldValue.delete(),
      dormancyPurgeAt:     admin.firestore.FieldValue.delete(),
      dormancyReminderAt:  admin.firestore.FieldValue.delete(),
    }, { merge: true })
    .catch(e => console.warn('[touchLastActive]', uid, e.message));
}

// Best available evidence that an account was genuinely used, for backfilling
// lastActiveAt onto accounts that predate the field. Walks the owner's real
// work — drafts, publish jobs, campaigns — not just the signup date, so a
// long-standing account that has been in use is never mistaken for dormant.
async function resolveLastActive(uid, userData = null) {
  let best = 0;
  const consider = (ts) => {
    if (!ts) return;
    const ms = typeof ts.toMillis === 'function' ? ts.toMillis()
             : (ts instanceof Date ? ts.getTime() : 0);
    if (ms > best) best = ms;
  };

  const data = userData || (await db.collection('users').doc(uid).get()).data() || {};
  consider(data.lastActiveAt);
  consider(data.createdAt);
  consider(data.updatedAt);

  try {
    const bizSnap = await userBizCol(uid).get();
    for (const bizDoc of bizSnap.docs) {
      const b = bizDoc.data() || {};
      consider(b.createdAt); consider(b.updatedAt);

      const [drafts, jobs, camps] = await Promise.all([
        userBizDraftsRef(uid, bizDoc.id).orderBy('updatedAt', 'desc').limit(1).get().catch(() => null),
        userBizJobsRef(uid, bizDoc.id).orderBy('createdAt', 'desc').limit(1).get().catch(() => null),
        userBizRef(uid, bizDoc.id).collection('campaigns').get().catch(() => null),
      ]);
      if (drafts && !drafts.empty) consider(drafts.docs[0].data().updatedAt);
      if (jobs   && !jobs.empty)   consider(jobs.docs[0].data().createdAt);
      if (camps) camps.docs.forEach(c => {
        const cd = c.data() || {};
        consider(cd.lastUsedAt); consider(cd.updatedAt); consider(cd.createdAt);
      });
    }
  } catch (e) {
    console.warn('[resolveLastActive] partial scan for', uid, e.message);
  }

  return best ? admin.firestore.Timestamp.fromMillis(best) : null;
}

// ── purgeUserData ─────────────────────────────────────────────────────────────
// The single deletion walker, shared by the owner-initiated account deletion and
// the dormancy sweep. Firestore does NOT cascade-delete subcollections, so every
// nested path has to be walked explicitly — deleting users/{uid} alone silently
// orphans every business, campaign, draft and job underneath it.
//
// Pass dryRun to get the exact same counts without deleting anything.
async function purgeUserData(uid, opts = {}) {
  const {
    dryRun = false,
    cancelSubscription = true,
    revokeOAuth = true,
    deleteAuthUser = true,
  } = opts;

  const result = {
    uid, dryRun,
    businesses: 0, docsDeleted: 0, storagePrefixes: [],
    subscriptionCancelled: false, authUserDeleted: false, errors: [],
  };

  if (cancelSubscription && !dryRun) {
    try {
      const subSnap = await db.collection('subscriptions').doc(uid).get();
      const squareSubscriptionId = subSnap.exists ? subSnap.data().squareSubscriptionId : null;
      if (squareSubscriptionId) {
        try {
          await getSquare().subscriptions.cancel({ subscriptionId: squareSubscriptionId });
          result.subscriptionCancelled = true;
        } catch (e) { result.errors.push('square:' + e.message); }
      }
    } catch (e) { result.errors.push('subscription-read:' + e.message); }
  }

  const [bizSnap, activitySnap] = await Promise.all([
    userBizCol(uid).get(),
    db.collection('activityLogs').where('uid', '==', uid).get(),
  ]);
  result.businesses = bizSnap.size;

  const bizSubRefs = [];
  for (const bizDoc of bizSnap.docs) {
    const bizId = bizDoc.id;
    const [draftsSnap, jobsSnap, connsSnap, pendingSnap, libSnap,
           bizFactsSnap, bizImagesSnap] = await Promise.all([
      userBizDraftsRef(uid, bizId).get(),
      userBizJobsRef(uid, bizId).get(),
      userBizConnsRef(uid, bizId).get(),
      userBizPostsRef(uid, bizId).get(),
      userBizRef(uid, bizId).collection('documents').get(),
      userBizRef(uid, bizId).collection('facts').get(),
      userBizRef(uid, bizId).collection('images').get(),
    ]);
    [draftsSnap, jobsSnap, connsSnap, pendingSnap, libSnap, bizFactsSnap, bizImagesSnap]
      .forEach(snap => snap.docs.forEach(d => bizSubRefs.push(d.ref)));

    // Revoke OAuth at the provider BEFORE deleting the tokens — once the docs are
    // gone the tokens are unreadable here but still valid at Google/Facebook.
    for (const connDoc of connsSnap.docs) {
      const platformId = connDoc.id;
      const privSnap = await connDoc.ref.collection('private').get();
      privSnap.docs.forEach(d => bizSubRefs.push(d.ref));
      if (!revokeOAuth || dryRun) continue;

      const { accessToken, refreshToken } = privSnap.docs[0]?.data() || {};
      if (platformId === 'google') {
        for (const tok of [accessToken, refreshToken].filter(Boolean)) {
          try {
            await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: 'POST' });
          } catch (e) { console.warn('[purgeUserData] Google revoke failed:', e.message); }
        }
      }
      if ((platformId === 'facebook' || platformId === 'instagram') && accessToken) {
        try {
          await fetch(`https://graph.facebook.com/v20.0/me/permissions?access_token=${encodeURIComponent(accessToken)}`, { method: 'DELETE' });
        } catch (e) { console.warn('[purgeUserData] Facebook revoke failed:', e.message); }
      }
    }

    const campSnap = await userBizRef(uid, bizId).collection('campaigns').get();
    for (const campDoc of campSnap.docs) {
      const campRef = userBizRef(uid, bizId).collection('campaigns').doc(campDoc.id);
      const subs = await Promise.all(
        ['facts', 'images', 'documents', 'copy', 'advertising', 'ads'].map(c => campRef.collection(c).get())
      );
      subs.forEach(snap => snap.docs.forEach(d => bizSubRefs.push(d.ref)));
      bizSubRefs.push(campDoc.ref);
    }
  }

  const allRefs = [
    db.collection('users').doc(uid),
    db.collection('subscriptions').doc(uid),
    ...bizSnap.docs.map(d => d.ref),
    ...bizSubRefs,
    ...activitySnap.docs.map(d => d.ref),
  ];
  result.docsDeleted = allRefs.length;

  const storagePrefixes = [`users/${uid}/images/`, `photos/${uid}/`,
    ...bizSnap.docs.map(d => `businesses/${d.id}/`)];
  result.storagePrefixes = storagePrefixes;

  if (dryRun) return result;

  const CHUNK = 450;
  for (let i = 0; i < allRefs.length; i += CHUNK) {
    const batch = db.batch();
    allRefs.slice(i, i + CHUNK).forEach(ref => batch.delete(ref));
    await batch.commit();
  }

  try {
    const bucket = admin.storage().bucket();
    await Promise.allSettled(storagePrefixes.map(prefix => bucket.deleteFiles({ prefix })));
  } catch (e) {
    result.errors.push('storage:' + e.message);
    console.error('[purgeUserData] Storage cleanup failed:', e.message);
  }

  if (deleteAuthUser) {
    try {
      await admin.auth().deleteUser(uid);
      result.authUserDeleted = true;
    } catch (e) {
      // A already-missing auth user is not a failure.
      if (e.code !== 'auth/user-not-found') result.errors.push('auth:' + e.message);
    }
  }

  return result;
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
  computeNextRunAt, normalizeSchedule,
  // plans
  getPlanConfig,
  // constants
  JOB_STATUS, PLATFORM_DOCS, buildPlatformBlock,
  PLATFORM_CAPABILITY_MAP, AUTO_POST_PLATFORMS,
  // retention / account lifecycle
  touchLastActive, resolveLastActive, purgeUserData,
};
