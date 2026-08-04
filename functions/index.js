/**
 * BlastyBiz — Firebase Cloud Functions v2
 * Deploy with: firebase deploy --only functions
 * Requires Blaze (pay-as-you-go) plan
 *
 * This file is the re-export barrel only.
 * All function implementations live in their module directories:
 *   lib/         — shared helpers (db, auth, ai, email, unsub, etc.)
 *   ai/          — AI endpoints (adaptListing, suggestPlatforms, etc.)
 *   payments/    — Square checkout, webhooks, pricing
 *   oauth/       — Google & Facebook OAuth flows
 *   publishing/  — approveDraft, dispatchPublishJob, triggers
 *   admin/       — admin-only management endpoints
 *   scheduled/   — cron jobs (cleanupAbandonedSignups, scheduledFirestoreExport, etc.)
 *   user/        — user lifecycle (createBusiness, deleteAccount, triggers)
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
Object.assign(exports, require('./ai'));
Object.assign(exports, require('./payments'));
Object.assign(exports, require('./oauth'));
Object.assign(exports, require('./publishing'));
Object.assign(exports, require('./admin'));
Object.assign(exports, require('./scheduled'));
Object.assign(exports, require('./user'));
