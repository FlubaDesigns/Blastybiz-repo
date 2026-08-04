/**
 * BlastyBiz — Firebase Cloud Functions v2
 * Deploy with: firebase deploy --only functions
 * Requires Blaze (pay-as-you-go) plan
 *
 * This file is the re-export barrel only.
 * All function implementations live under:
 *
 *   lib/              — shared helpers
 *     shared.js       — db init, auth, rate-limit, cors, email, AI helpers, re-exports
 *     ai.js           — Claude/AI utilities
 *     auth.js         — verifyBearer, withAuth
 *     config.js       — app constants
 *     db.js           — Firestore ref helpers
 *     email.js        — Resend email helpers
 *     logging.js      — bbLog structured logger
 *     plans.js        — getPlanConfig(), Firestore-backed plan limits
 *     platforms.js    — PLATFORM_CAPABILITY_MAP and platform metadata
 *     publishers.js   — per-platform publish helpers
 *     rateLimit.js    — checkUidRateLimit (transactional)
 *     square.js       — Square SDK helpers
 *     unsub.js        — unsubscribe HMAC helpers
 *     yelp.js         — Yelp category cache helpers
 *
 *   modules/          — Cloud Function exports, one file per domain
 *     ai.js           — adaptListing, suggestPlatforms, suggestCategory, scoreFact, summarizeReviews
 *     payments.js     — squareCheckout, squareWebhook, getPricingPlans
 *     oauth.js        — googleOAuthStart/Callback, facebookOAuthStart/Callback, disconnectPlatform, checkPlatformTokenExpiry
 *     publishing.js   — approveDraft, dispatchPublishJob, onPublishJobCreated, onPublishJobUpdated
 *     admin.js        — all admin* endpoints, refreshYelpCategories, fetchAndCacheYelpCategories
 *     scheduled.js    — cleanupAbandonedSignups, scheduledTokenRefresh, scheduledFirestoreExport
 *     business.js     — createBusiness, deleteBusiness, deleteAccount, sendVerificationEmail
 *     misc.js         — sendTestEmail, contactForm, unsubscribeEmail
 *
 * To deploy a single group:
 *   firebase deploy --only functions:adaptListing,functions:suggestPlatforms
 *   firebase deploy --only functions:squareWebhook
 *
 * dispatchPublishJob has retry:true — use --force when deploying it:
 *   firebase deploy --only functions:dispatchPublishJob --force
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
