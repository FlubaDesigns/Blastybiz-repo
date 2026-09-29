/**
 * BlastyBiz Firebase Cloud Functions v2.
 * This barrel is the deployed entry point; implementation lives in modules/.
 * Shared authentication, provider clients, and path helpers live in lib/shared.js.
 * Ads are owned by lib/ads.js; occurrences, delivery state, and reminders by
 * lib/lifecycle.js; recurrence by lib/schedule.js; platform capability by
 * lib/platforms.js. Keep each feature in its existing owner.
 * Production releases run through the Fluba Authorization Engine.
 */

const { setGlobalOptions } = require('firebase-functions/v2');

// ── Global instance cap — prevents runaway billing from abuse or bugs ─────────
// Raise per-function if a specific endpoint genuinely needs more headroom.
setGlobalOptions({ maxInstances: 10 });

// ── Re-export all modules ─────────────────────────────────────────────────────
Object.assign(exports, require('./modules/ai'));
Object.assign(exports, require('./modules/payments'));
Object.assign(exports, require('./modules/oauth'));
Object.assign(exports, require('./modules/publishing'));
Object.assign(exports, require('./modules/admin'));
Object.assign(exports, require('./modules/scheduled'));
Object.assign(exports, require('./modules/business'));
Object.assign(exports, require('./modules/misc'));
Object.assign(exports, require('./modules/retention'));

Object.assign(exports, require('./modules/lifecycle'));
