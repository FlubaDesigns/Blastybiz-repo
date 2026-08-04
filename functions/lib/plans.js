'use strict';
const { db } = require('./db');

// ── getPlanConfig — single source of truth for all plan entitlements ──────────
// Reads config/plans from Firestore; falls back to hardcoded defaults.
// Cached for 5 minutes so every endpoint doesn't pay a Firestore read.
// To change limits without a redeploy: update config/plans in Firestore.
// Schema: { aiLimits: {trial,starter,pro,agency}, bizLimits: {…}, prices: {…} }
const _PLAN_CONFIG_DEFAULTS = {
  aiLimits:  { trial: 10, starter: 10, pro: 100, agency: 500 },
  bizLimits: { trial: 1,  starter: 1,  pro: 3,   agency: 10  },
  prices:    { proMonthly: null, agencyMonthly: null, proAnnual: null, agencyAnnual: null },
};
let _planConfigCache    = null;
let _planConfigCachedAt = 0;
const _PLAN_CONFIG_TTL  = 5 * 60 * 1000;

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

module.exports = { _PLAN_CONFIG_DEFAULTS, getPlanConfig };
