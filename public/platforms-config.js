// platforms-config.js — canonical platform display defaults + Firestore loader
// Imported by: BlastyBiz-Admin-Platforms.html, BlastyBiz-Onboard2.html, BlastyBiz-CreateBiz.html
// Public page (BlastyBiz-Platforms.html) uses the REST API helper below instead.

export const PLATFORM_DEFAULTS = [
  { slug: 'google',     name: 'Google Business Profile', icon: '🔍', capabilityLevel: 'full_auto',       order: 1,  enabled: true, proOnly: false },
  { slug: 'facebook',   name: 'Facebook Page',           icon: '📘', capabilityLevel: 'partial_auto',    order: 2,  enabled: true, proOnly: false },
  { slug: 'instagram',  name: 'Instagram',               icon: '📸', capabilityLevel: 'partial_auto',    order: 3,  enabled: true, proOnly: false },
  { slug: 'fbmarket',   name: 'Facebook Marketplace',    icon: '🛒', capabilityLevel: 'manual_assisted', order: 4,  enabled: true, proOnly: true  },
  { slug: 'yelp',       name: 'Yelp',                    icon: '⭐', capabilityLevel: 'manual_assisted', order: 5,  enabled: true, proOnly: true  },
  { slug: 'craigslist', name: 'Craigslist',              icon: '📋', capabilityLevel: 'manual_assisted', order: 6,  enabled: true, proOnly: true  },
  { slug: 'nextdoor',   name: 'Nextdoor',                icon: '🏘️',  capabilityLevel: 'manual_assisted', order: 7,  enabled: true, proOnly: true  },
  { slug: 'linkedin',   name: 'LinkedIn',                icon: '💼', capabilityLevel: 'manual_assisted', order: 8,  enabled: true, proOnly: true  },
  { slug: 'pinterest',  name: 'Pinterest',               icon: '📌', capabilityLevel: 'manual_assisted', order: 9,  enabled: true, proOnly: true  },
  { slug: 'x',          name: 'X (Twitter)',             icon: '𝕏',  capabilityLevel: 'manual_assisted', order: 10, enabled: true, proOnly: true  },
  { slug: 'bing',       name: 'Bing Places',             icon: '🔵', capabilityLevel: 'manual_assisted', order: 11, enabled: true, proOnly: true  },
  { slug: 'applemaps',  name: 'Apple Maps',              icon: '🍎', capabilityLevel: 'manual_assisted', order: 12, enabled: true, proOnly: true  },
  { slug: 'alignable',  name: 'Alignable',               icon: '🤝', capabilityLevel: 'manual_assisted', order: 13, enabled: true, proOnly: true  },
  { slug: 'thumbtack',  name: 'Thumbtack',               icon: '📌', capabilityLevel: 'manual_assisted', order: 14, enabled: true, proOnly: true  },
  { slug: 'angi',       name: 'Angi',                    icon: '🔧', capabilityLevel: 'manual_assisted', order: 15, enabled: true, proOnly: true  },
];

/**
 * Load platforms from Firestore config/platforms, merged with PLATFORM_DEFAULTS.
 * Falls back gracefully to PLATFORM_DEFAULTS if Firestore is unavailable.
 *
 * @param {object} db       - Firestore instance
 * @param {Function} getDocFn - Firestore getDoc
 * @param {Function} docFn    - Firestore doc
 * @returns {Promise<Array>}  Sorted, enabled platform objects
 */
export async function loadPlatforms(db, getDocFn, docFn) {
  let overrides = {};
  try {
    const snap = await getDocFn(docFn(db, 'config', 'platforms'));
    if (snap.exists()) overrides = snap.data();
  } catch (e) {
    console.warn('[platforms-config] Firestore load failed, using defaults:', e.message);
  }
  return _merge(overrides);
}

/** Merge Firestore overrides with PLATFORM_DEFAULTS (shared util). */
export function _merge(overrides) {
  return PLATFORM_DEFAULTS
    .map(d => Object.assign({}, d, overrides[d.slug] || {}))
    .filter(p => p.enabled !== false)
    .sort((a, b) => (a.order || 99) - (b.order || 99));
}

// ── REST API helpers (no Firebase SDK needed — for public/unauthenticated pages) ──

const _FS_REST = 'https://firestore.googleapis.com/v1/projects/blastybiz-9523e/databases/(default)/documents';

function _parseFSValue(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('mapValue'     in v) {
    const out = {};
    for (const [k, fv] of Object.entries(v.mapValue.fields || {})) out[k] = _parseFSValue(fv);
    return out;
  }
  return null;
}

/**
 * Load platforms via Firestore REST API (no auth required — config/platforms is public-read).
 * @returns {Promise<Array>} Sorted, enabled platform objects
 */
export async function loadPlatformsREST() {
  let overrides = {};
  try {
    const res = await fetch(`${_FS_REST}/config/platforms`);
    if (res.ok) {
      const data = await res.json();
      for (const [slug, val] of Object.entries(data.fields || {})) {
        overrides[slug] = _parseFSValue(val);
      }
    }
  } catch (e) {
    console.warn('[platforms-config] REST load failed, using defaults:', e.message);
  }
  return _merge(overrides);
}
