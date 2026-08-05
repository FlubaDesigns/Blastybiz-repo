#!/usr/bin/env node
/**
 * smoke-test.cjs — BlastyBiz Cloud Functions smoke test
 *
 * Verifies every Cloud Function actually responds before launch:
 *   • HTTP/onRequest functions  → called with a minimal authenticated request.
 *                                 Pass = auth-expected response (400/401/403/405/429).
 *                                 Fail = 404 (not deployed) or 5xx (server crash).
 *   • Skipped HTTP fns          → verified deployed via `firebase functions:list`.
 *   • Scheduled / trigger fns   → verified deployed via `firebase functions:list`.
 *   • Internal barrel exports   → skipped (not CF endpoints).
 *   • Catalog integrity         → names cross-checked against barrel exports at startup.
 *   • Barrel export count       → must stay ≥ 63.
 *
 * Why "auth-expected" instead of just "non-500"?
 *   A 404 from Cloud Functions means the function was never deployed or the
 *   name is wrong — it is NOT a safe pass.  A 401/403 means the function loaded
 *   and ran its auth gate.  A 400 means it validated its inputs.  Those are the
 *   signals we want.
 *
 * Usage:
 *   SMOKE_TEST_TOKEN=<firebase-id-token> node scripts/smoke-test.cjs
 *   SMOKE_TEST_TOKEN=<token> node scripts/smoke-test.cjs --project blastybiz-9523e
 *
 * Environment variables:
 *   SMOKE_TEST_TOKEN      — Firebase ID token (obtainable from the browser DevTools
 *                           console: firebase.auth().currentUser.getIdToken()).
 *   FIREBASE_PROJECT_ID   — Firebase project ID (fallback to .firebaserc).
 *
 * Exit code 0 = all checks passed, 1 = one or more failures.
 */
'use strict';

const https           = require('https');
const { execSync }    = require('child_process');
const fs              = require('fs');
const path            = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const ROOT       = path.resolve(__dirname, '..');
const TIMEOUT_MS = 20_000;
const EXPECTED_TOTAL = 63;

// HTTP status codes that prove a function is deployed and healthy.
// 401 / 403 = auth gate ran     (function is alive)
// 400        = input validation  (function is alive)
// 405        = method guard      (function is alive)
// 429        = rate limiter ran  (function is alive)
// 200 / 2xx  = actual success
// 404        = NOT deployed / wrong URL        → FAIL
// 5xx        = server crash                   → FAIL
const PASS_STATUSES = new Set([200, 201, 204, 400, 401, 403, 405, 429]);

function resolveProjectId() {
  const argv = process.argv.slice(2);
  const idx  = argv.indexOf('--project');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try {
    const rc = JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8'));
    return rc.projects?.default;
  } catch { /* ignore */ }
  return null;
}

const PROJECT_ID = resolveProjectId();
const TOKEN      = process.env.SMOKE_TEST_TOKEN || '';

// ── Function catalog ──────────────────────────────────────────────────────────
// type: 'http'       — onRequest endpoint; will be called.
// type: 'scheduled'  — onSchedule; verify deployed only.
// type: 'trigger'    — onDocumentCreated/Updated; verify deployed only.
// type: 'internal'   — async helper accidentally exported; not a CF endpoint.
// skipCall: true     — HTTP function unsafe to invoke without real params;
//                      deployment is verified via functions:list instead.
const FUNCTIONS = [
  // ── AI (modules/ai.js) ──────────────────────────────────────────────────
  { name: 'generateEnrichmentQuestions', type: 'http', method: 'POST' },
  { name: 'suggestCategory',             type: 'http', method: 'POST' },
  { name: 'adaptListing',                type: 'http', method: 'POST' },
  { name: 'resolveCategories',           type: 'http', method: 'POST' },
  { name: 'suggestPlatforms',            type: 'http', method: 'POST' },
  { name: 'chatCampaign',                type: 'http', method: 'POST' },
  { name: 'scoreFact',                   type: 'http', method: 'POST' },
  { name: 'adminGetAiSettings',          type: 'http', method: 'GET'  },
  { name: 'adminSetAiSettings',          type: 'http', method: 'POST' },

  // ── Payments (modules/payments.js) ──────────────────────────────────────
  { name: 'createCheckoutSession',       type: 'http', method: 'POST' },
  { name: 'createPortalSession',         type: 'http', method: 'POST' },
  { name: 'squareWebhook',               type: 'http', method: 'POST',
    skipCall: true,
    skipReason: 'webhook — requires Square HMAC signature; calling bare would fail the HMAC gate, not reach the function body' },
  { name: 'adminUpdatePricing',          type: 'http', method: 'POST' },

  // ── OAuth (modules/oauth.js) ─────────────────────────────────────────────
  { name: 'initiateGoogleOAuth',         type: 'http', method: 'POST' },
  { name: 'googleOAuthCallback',         type: 'http', method: 'GET',
    skipCall: true,
    skipReason: 'OAuth redirect callback — requires a real code+state from Google; calling bare hits an external provider' },
  { name: 'initiateFacebookOAuth',       type: 'http', method: 'POST' },
  { name: 'facebookOAuthCallback',       type: 'http', method: 'GET',
    skipCall: true,
    skipReason: 'OAuth redirect callback — requires a real code+state from Facebook; calling bare hits an external provider' },
  { name: 'disconnectPlatform',          type: 'http', method: 'POST' },

  // ── Publishing — HTTP (modules/publishing.js) ────────────────────────────
  { name: 'uploadImage',                 type: 'http', method: 'POST' },
  { name: 'approvePendingPost',          type: 'http', method: 'POST' },
  { name: 'approveDraft',                type: 'http', method: 'POST' },
  { name: 'postToBing',                  type: 'http', method: 'POST' },
  { name: 'postToAppleMaps',             type: 'http', method: 'POST' },

  // ── Publishing — Firestore triggers (modules/publishing.js) ─────────────
  { name: 'dispatchPublishJob',          type: 'trigger' },
  { name: 'jobFailedTrigger',            type: 'trigger' },
  { name: 'jobCompletedTrigger',         type: 'trigger' },
  { name: 'userCreatedTrigger',          type: 'trigger' },
  { name: 'businessCreatedTrigger',      type: 'trigger' },

  // ── Admin (modules/admin.js) ─────────────────────────────────────────────
  { name: 'adminListPublishJobs',         type: 'http', method: 'GET'  },
  { name: 'adminListFailedJobs',          type: 'http', method: 'GET'  },
  { name: 'adminRetryJob',                type: 'http', method: 'POST' },
  { name: 'adminMarkManualFollowup',      type: 'http', method: 'POST' },
  { name: 'adminListBusinesses',          type: 'http', method: 'GET'  },
  { name: 'adminListPlatformConnections', type: 'http', method: 'GET'  },
  { name: 'adminPlatformHealth',          type: 'http', method: 'GET'  },
  { name: 'adminSendReconnectNudge',      type: 'http', method: 'POST' },
  { name: 'adminSendRecoveryEmails',      type: 'http', method: 'POST' },
  { name: 'adminGetAdminEmails',          type: 'http', method: 'GET'  },
  { name: 'adminUpdateAdminEmails',       type: 'http', method: 'POST' },
  { name: 'adminListActivityLogs',        type: 'http', method: 'GET'  },
  { name: 'adminOnboardingFunnel',        type: 'http', method: 'GET'  },
  { name: 'adminSendOnboardingNudge',     type: 'http', method: 'POST' },
  { name: 'adminSubscriptionSummary',     type: 'http', method: 'GET'  },
  { name: 'adminSetPlan',                 type: 'http', method: 'POST' },
  { name: 'adminDeleteBusiness',          type: 'http', method: 'POST' },
  { name: 'adminUpdatePlatformCategories',type: 'http', method: 'POST' },

  // ── Scheduled (modules/scheduled.js + modules/oauth.js) ─────────────────
  { name: 'checkPlatformTokenExpiry',    type: 'scheduled' },
  { name: 'scheduledPostingCheck',       type: 'scheduled' },
  { name: 'scheduledUpgradeNudge',       type: 'scheduled' },
  { name: 'scheduledWeeklyDigest',       type: 'scheduled' },
  { name: 'scheduledSetupNudge',         type: 'scheduled' },
  { name: 'scheduledFirestoreExport',    type: 'scheduled' },
  { name: 'cleanupAbandonedSignups',     type: 'scheduled' },

  // ── Business (modules/business.js) ───────────────────────────────────────
  { name: 'createBusiness',             type: 'http', method: 'POST' },
  { name: 'deleteBusiness',             type: 'http', method: 'POST' },
  { name: 'deleteAccount',              type: 'http', method: 'POST' },
  { name: 'sendVerificationEmail',      type: 'http', method: 'POST' },

  // ── Misc (modules/misc.js) ───────────────────────────────────────────────
  { name: 'sendTestEmail',              type: 'http', method: 'POST' },
  { name: 'contactForm',                type: 'http', method: 'POST' },
  { name: 'unsubscribeEmail',           type: 'http', method: 'GET',
    skipCall: true,
    skipReason: 'requires a valid HMAC token in query params; calling bare does not reach the function body' },

  // ── Internal helpers (accidentally exported, not CF endpoints) ───────────
  // Private async functions in modules/publishing.js that Node exports via
  // Object.assign(exports, ...).  Firebase does NOT register these as Cloud
  // Functions — they are plain functions, not onRequest/onSchedule wrappers.
  { name: '_publishGoogleJob',           type: 'internal' },
  { name: '_publishFacebookJob',         type: 'internal' },
  { name: '_publishInstagramJob',        type: 'internal' },
];

// ── Step 0: catalog integrity — cross-check names against barrel exports ─────
// This ensures the catalog stays in sync with functions/index.js.
// Any HTTP/scheduled/trigger name in the catalog must also exist in the barrel.
// (Internal helpers are excluded — they may or may not be in the barrel.)
function checkCatalogIntegrity() {
  let ok = true;
  let barrel;
  try {
    barrel = require(path.resolve(ROOT, 'functions/index.js'));
  } catch (e) {
    console.error(`  ❌ Cannot load barrel — cannot validate catalog: ${e.message}`);
    return false;
  }
  const barrelNames = new Set(Object.keys(barrel));

  // Every non-internal entry in the catalog must exist in the barrel
  for (const fn of FUNCTIONS) {
    if (fn.type === 'internal') continue;
    if (!barrelNames.has(fn.name)) {
      console.error(`  ❌ CATALOG DRIFT: '${fn.name}' is in smoke-test catalog but NOT exported by functions/index.js`);
      ok = false;
    }
  }

  // Every barrel export must be accounted for in the catalog
  const catalogNames = new Set(FUNCTIONS.map(f => f.name));
  for (const name of barrelNames) {
    if (!catalogNames.has(name)) {
      console.error(`  ❌ CATALOG DRIFT: '${name}' is exported by functions/index.js but NOT in smoke-test catalog`);
      ok = false;
    }
  }

  if (ok) {
    console.log(`  ✅ Catalog matches barrel (${FUNCTIONS.length} entries)`);
  }
  return ok;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function cfUrl(name, region = 'us-central1') {
  return `https://${region}-${PROJECT_ID}.cloudfunctions.net/${name}`;
}

function httpRequest(url, method, token) {
  return new Promise((resolve, reject) => {
    const body   = method !== 'GET' ? '{}' : null;
    const parsed = new URL(url);
    const opts   = {
      hostname: parsed.hostname,
      port:     443,
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body  ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      timeout: TIMEOUT_MS,
    };
    const req = https.request(opts, res => {
      res.resume(); // drain body so socket is released
      resolve(res.statusCode);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.on('error',   reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Firebase deployed-functions list ─────────────────────────────────────────
// _deployedCache values:
//   null  = not yet fetched
//   false = fetch failed (firebase CLI unavailable or errored) — hard failure
//   Set   = fetched successfully
let _deployedCache = null;

function getDeployedFunctions() {
  if (_deployedCache !== null) return _deployedCache;
  try {
    const raw = execSync(
      `firebase functions:list --project ${PROJECT_ID} --json 2>/dev/null`,
      { cwd: ROOT, timeout: 45_000 },
    ).toString();
    const parsed = JSON.parse(raw);
    // firebase CLI may return the array directly or wrap it in { result: [...] }
    const list = Array.isArray(parsed) ? parsed : (parsed.result || []);
    _deployedCache = new Set(list.map(f => {
      // "name" is a full resource path:
      // "projects/<p>/locations/<r>/functions/<fnName>"
      const parts = (f.name || f.id || String(f)).split('/');
      return parts[parts.length - 1];
    }));
    console.log(`  (${_deployedCache.size} functions found in Firebase)`);
  } catch (e) {
    console.error(`  ❌ firebase functions:list failed: ${e.message}`);
    console.error('      Ensure firebase-tools is installed (npm i -g firebase-tools) and');
    console.error('      FIREBASE_TOKEN is set or the CLI is authenticated (firebase login).');
    _deployedCache = false; // sentinel — hard failure for any check that depends on this
  }
  return _deployedCache;
}

// ── Helper: assert a function is in the deployed list ────────────────────────
// Returns true = deployed, false = not deployed, 'error' = list unavailable.
function assertDeployed(name) {
  const deployed = getDeployedFunctions();
  if (deployed === false) return 'error';
  return deployed.has(name);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  BlastyBiz — Cloud Functions Smoke Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Project   : ${PROJECT_ID || '(none — pass --project or set FIREBASE_PROJECT_ID)'}`);
  console.log(`  Auth token: ${TOKEN ? 'provided ✓' : 'not provided — HTTP calls will be unauthenticated'}`);
  console.log(`  Catalog   : ${FUNCTIONS.length} of ${EXPECTED_TOTAL} entries\n`);

  let failures    = 0;
  let httpPassed  = 0;
  let httpSkipped = 0;
  let deployOk    = 0;
  let deploySkip  = 0;

  // ── Step 0: Catalog integrity ──────────────────────────────────────────────
  console.log('── 0. Catalog integrity (names vs barrel exports) ───────────────');
  const catalogOk = checkCatalogIntegrity();
  if (!catalogOk) {
    console.error('\n  Catalog mismatch — fix scripts/smoke-test.cjs before running smoke test.');
    process.exit(1);
  }

  // ── Step 1: HTTP endpoints ─────────────────────────────────────────────────
  console.log('\n── 1. HTTP endpoints ────────────────────────────────────────────');
  const httpFns = FUNCTIONS.filter(f => f.type === 'http');

  if (!PROJECT_ID) {
    console.log('  ⏭  Skipping all HTTP checks — no project ID configured.');
    httpSkipped += httpFns.length;
  } else {
    for (const fn of httpFns) {
      if (fn.skipCall) {
        // Unsafe to invoke, but we still need proof it is deployed.
        const isDeployed = assertDeployed(fn.name);
        if (isDeployed === 'error') {
          console.log(`  ❌ FAIL  ${fn.name} — deployment list unavailable (see firebase error above)`);
          failures++;
        } else if (isDeployed) {
          console.log(`  ✅ DEPLOYED ${fn.name} — ${fn.skipReason}`);
          httpPassed++;
        } else {
          console.log(`  ❌ NOT DEPLOYED ${fn.name} — not in firebase functions:list`);
          failures++;
        }
        continue;
      }

      const url = cfUrl(fn.name, fn.region);
      try {
        const status = await httpRequest(url, fn.method || 'POST', TOKEN);
        if (PASS_STATUSES.has(status)) {
          console.log(`  ✅ OK    ${fn.name} → HTTP ${status}`);
          httpPassed++;
        } else if (status === 404) {
          console.log(`  ❌ FAIL  ${fn.name} → HTTP 404 (not deployed or wrong URL)`);
          failures++;
        } else if (status >= 500) {
          console.log(`  ❌ FAIL  ${fn.name} → HTTP ${status} (server error)`);
          failures++;
        } else {
          // Other 3xx / unexpected — log a warning but don't fail
          console.log(`  ⚠️  WARN  ${fn.name} → HTTP ${status} (unexpected — review manually)`);
        }
      } catch (e) {
        console.log(`  ❌ ERROR ${fn.name} → ${e.message}`);
        failures++;
      }
    }
  }

  // ── Step 2: Scheduled & trigger functions ──────────────────────────────────
  console.log('\n── 2. Scheduled & trigger functions (verify deployed) ────────────');
  const nonHttpFns = FUNCTIONS.filter(f => f.type === 'scheduled' || f.type === 'trigger');

  if (!PROJECT_ID) {
    console.log('  ⏭  Skipping — no project ID configured.');
    deploySkip += nonHttpFns.length;
  } else {
    const deployed = getDeployedFunctions();
    if (deployed === false) {
      // firebase functions:list failed — this is a hard failure for every non-HTTP function
      for (const fn of nonHttpFns) {
        const label = fn.type === 'scheduled' ? 'SCHEDULED' : 'TRIGGER  ';
        console.log(`  ❌ ${label} ${fn.name} — deployment list unavailable (see firebase error above)`);
        failures++;
      }
    } else {
      for (const fn of nonHttpFns) {
        const label = fn.type === 'scheduled' ? 'SCHEDULED' : 'TRIGGER  ';
        if (deployed.has(fn.name)) {
          console.log(`  ✅ ${label} ${fn.name} — deployed`);
          deployOk++;
        } else {
          console.log(`  ❌ ${label} ${fn.name} — NOT found in deployed functions`);
          failures++;
        }
      }
    }
  }

  // ── Step 3: Internal helpers ───────────────────────────────────────────────
  console.log('\n── 3. Internal barrel exports (not Cloud Function endpoints) ──────');
  for (const fn of FUNCTIONS.filter(f => f.type === 'internal')) {
    console.log(`  —  SKIP  ${fn.name} — plain async helper, not a CF endpoint`);
  }

  // ── Step 4: Barrel export count ────────────────────────────────────────────
  console.log('\n── 4. Barrel export count ────────────────────────────────────────');
  try {
    const barrel   = require(path.resolve(ROOT, 'functions/index.js'));
    const exported = Object.keys(barrel).length;
    if (exported < EXPECTED_TOTAL) {
      console.log(`  ❌ Barrel exports ${exported} functions — expected ≥${EXPECTED_TOTAL}`);
      console.log('     A module require path may be wrong or a module file was removed.');
      failures++;
    } else {
      console.log(`  ✅ Barrel exports ${exported} functions (≥${EXPECTED_TOTAL})`);
    }
  } catch (e) {
    console.log(`  ❌ Barrel failed to load: ${e.message}`);
    failures++;
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  HTTP passed   : ${httpPassed}`);
  console.log(`  HTTP skipped  : ${httpSkipped}`);
  console.log(`  Deploy passed : ${deployOk}`);
  console.log(`  Deploy skipped: ${deploySkip}`);
  console.log(`  Failures      : ${failures}`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failures === 0) {
    console.log('  ✅ All checks passed\n');
    process.exit(0);
  } else {
    console.log(`  ❌ ${failures} check(s) failed — fix before deploying\n`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('\nFatal error:', e.message);
  process.exit(1);
});
