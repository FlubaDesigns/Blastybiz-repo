import './platforms-authority.js?v=20261002-online';
export const { PLATFORM_DEFAULTS, mergeDisplay } = globalThis.BBPlatforms;

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
    .map(d => mergeDisplay(d, overrides[d.slug]))
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


// UI readiness is derived from canonical capability, saved connection and photos.
// Delivery workers remain the authority at dispatch; no connection is invented here.
export function deliveryReadiness(platformId, connection, {business={}, images, now=Date.now()} = {}) {
  const platform=globalThis.BBPlatforms.byId[platformId];
  if (!platform) return {state:'unavailable',label:'Unavailable',detail:'Choose another destination.'};
  if (!globalThis.BBPlatforms.eligibleForBusiness(platformId,business)) return {state:'unavailable',label:'Local presence required',detail:'Google Business Profile needs an in-person customer presence.'};
  if (platform.deliveryMode !== 'auto') return {state:'manual',label:'You post it',detail:'Blasty prepares the copy and photos. You finish posting in the app.'};
  if (connection === undefined) return {state:'checking',label:'Checking connection',detail:'Connection details have not loaded. Try again before sending.'};
  // Google access tokens are refreshed by the existing worker; saved connection status owns revocation.
  const expires=connection?.expiresAt?.toMillis?.() || (connection?.expiresAt?.seconds ? connection.expiresAt.seconds*1000 : Date.parse(connection?.expiresAt));
  const destination=platformId==='google' ? connection?.accountId && connection?.locationId : platformId==='instagram' ? connection?.igUserId && connection?.pageId : connection?.pageId;
  if(connection?.status!=='connected'||!destination||(platformId!=='google'&&(!Number.isFinite(expires)||expires<=now))) return {state:'connection',label:'Connect to auto-post',detail:'Connect or reconnect this account, then return to your blast.'};
  if(platform.doc.images.required && Array.isArray(images) && !images.length) return {state:'photo',label:'Photo required',detail:'Add a photo before sending to '+platform.name+'.'};
  return {state:'ready',label:'Ready to auto-post',detail:'Blasty can send this to your connected account after you approve.'};
}
