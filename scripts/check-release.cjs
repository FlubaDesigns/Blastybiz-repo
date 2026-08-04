#!/usr/bin/env node
/**
 * check-release.js — BlastyBiz production consistency audit
 *
 * Catches mechanical problems before they reach production:
 *   1. Orphaned pages (zero incoming HTML references, not on allowlist)
 *   2. Duplicate escape-function definitions (escHtml / _esc)
 *   3. Shared-asset version mismatches (blastybiz-menu.js, global-style.css, etc.)
 *
 * Usage: node scripts/check-release.js
 * Returns exit code 0 (pass) or 1 (failures found).
 */

const fs   = require('fs');
const path = require('path');

const PUBLIC = path.resolve(__dirname, '../public');

// Pages that are intentionally not linked from any other page
const ALLOWLIST = new Set([
  'BlastyBiz-Admin.html',
  'BlastyBiz-Admin-Emails.html',
  'BlastyBiz-Admin-Failed-Jobs.html',
  'BlastyBiz-Admin-Logs.html',
  'BlastyBiz-Admin-Moods.html',
  'BlastyBiz-Admin-OnboardSteps.html',
  'BlastyBiz-Admin-Operate.html',
  'BlastyBiz-Admin-Platform-Health.html',
  'BlastyBiz-Admin-Platforms.html',
  'BlastyBiz-Admin-Queue-Manager.html',
  'BlastyBiz-Admin-Subscriptions.html',
  'BlastyBiz-Admin-Users.html',
  'BlastyBiz-TestBlasty.html',       // admin-only test console, intentionally direct-URL
  'BlastyBiz-Connected.html',        // reached via OAuth redirect from Cloud Functions
  'BlastyBiz-Chat-Onboarding.html',  // retired; redirects to Onboard2.html on load
  'BlastyBiz-Onboarding.html',       // retired; redirects to Onboard2.html on load
  'BlastyBiz-Listing-Preview.html', // opened in new tab from campaign
  'index.html',                      // root redirect
  'blastybiz-header.html',           // partial, fetched by header-loader.js
  'blastybiz-footer.html',           // partial, fetched inline
  '404.html',                        // Firebase Hosting error page — referenced in firebase.json, not HTML links
  'BlastyBiz-Businesses.html',       // multi-business switcher — future feature, linked from nav conditionally
]);

// Shared assets to check for version consistency
const VERSIONED_ASSETS = [
  'blastybiz-menu.js',
  'global-style.css',
  'header-loader.js',
  'escape-utils.js',
  'mascot.js',
  'firebase-init-v2.js',
];

// ── Load all HTML files ───────────────────────────────────────────────────────
const htmlFiles = fs.readdirSync(PUBLIC)
  .filter(f => f.endsWith('.html'))
  .sort();

const fileContents = {};
for (const f of htmlFiles) {
  fileContents[f] = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
}

let failures = 0;

// ── Check 1: Orphaned pages ───────────────────────────────────────────────────
console.log('\n── 1. Orphaned pages (zero incoming references) ─────────────────');
for (const f of htmlFiles) {
  if (ALLOWLIST.has(f)) continue;
  const basename = f; // e.g. BlastyBiz-Login.html
  let refCount = 0;
  for (const [other, content] of Object.entries(fileContents)) {
    if (other === f) continue;
    if (content.includes(basename)) refCount++;
  }
  // Also check JS files
  const jsFiles = fs.readdirSync(PUBLIC).filter(j => j.endsWith('.js'));
  for (const js of jsFiles) {
    const content = fs.readFileSync(path.join(PUBLIC, js), 'utf8');
    if (content.includes(basename)) refCount++;
  }
  if (refCount === 0) {
    console.log(`  ❌ ORPHANED: ${f}`);
    failures++;
  }
}
if (failures === 0) console.log('  ✅ No orphaned pages found');

// ── Check 2: Duplicate escape-function definitions ────────────────────────────
console.log('\n── 2. Duplicate escape-function definitions ─────────────────────');
// Only flag actual function body definitions — not `const escHtml = window.escHtml;` delegations
const ESCAPE_PATTERNS = [
  /function escHtml\(/g,
  /function _esc\(/g,
  /function escHtmlPub\(/g,
];
const escDefs = {};
for (const [f, content] of Object.entries(fileContents)) {
  for (const pat of ESCAPE_PATTERNS) {
    const matches = content.match(pat);
    if (matches) {
      escDefs[f] = (escDefs[f] || 0) + matches.length;
    }
  }
}
if (Object.keys(escDefs).length > 0) {
  console.log(`  ⚠️  Local escape definitions found in ${Object.keys(escDefs).length} files:`);
  for (const [f, count] of Object.entries(escDefs)) {
    console.log(`     ${f}: ${count} definition(s)`);
  }
  console.log('  (These should delegate to escape-utils.js — not a failure if bodies are canonical)');
} else {
  console.log('  ✅ No local escape definitions found');
}

// ── Check 3: Shared-asset version mismatches ──────────────────────────────────
console.log('\n── 3. Shared-asset version mismatches ───────────────────────────');
let versionFailures = 0;
for (const asset of VERSIONED_ASSETS) {
  const versions = new Set();
  const files = [];
  for (const [f, content] of Object.entries(fileContents)) {
    const re = new RegExp(asset.replace('.', '\\.') + '\\?v=([^\\s"\']+)', 'g');
    let m;
    while ((m = re.exec(content)) !== null) {
      versions.add(m[1]);
      files.push(`${f}@v=${m[1]}`);
    }
  }
  if (versions.size > 1) {
    console.log(`  ❌ VERSION MISMATCH: ${asset} has ${versions.size} different versions: ${[...versions].join(', ')}`);
    versionFailures++;
    failures++;
  } else if (versions.size === 1) {
    console.log(`  ✅ ${asset}?v=${[...versions][0]} — consistent across ${files.length} references`);
  } else {
    console.log(`  — ${asset} — no versioned references found`);
  }
}

// ── Check 4: Unescaped innerHTML interpolations ───────────────────────────────
console.log('\n── 4. Unescaped innerHTML interpolations ────────────────────────');
// Flag any line that writes to innerHTML AND contains ${ but lacks escHtml( or _esc( on the same line.
// This catches the class of XSS bugs documented in finding 3.1 of the enterprise audit.
const INNER_RE = /innerHTML\s*[+]?=\s*[^;]*?\$\{/;
const SAFE_RE  = /escHtml\(|_esc\(/;
let innerHtmlFailures = 0;
for (const [f, content] of Object.entries(fileContents)) {
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (INNER_RE.test(line) && !SAFE_RE.test(line)) {
      console.log(`  ❌ UNESCAPED innerHTML: ${f}:${idx + 1} — ${line.trim().slice(0, 100)}`);
      innerHtmlFailures++;
      failures++;
    }
  });
}
if (innerHtmlFailures === 0) console.log('  ✅ No unescaped innerHTML interpolations found');

// ── Check 5: session.js included on pages that DEFINE doSignOut ──────────────
// Pages that only CALL doSignOut (e.g. blastybiz-header.html via onclick) are
// excluded — they rely on the including page to have already loaded session.js.
console.log('\n── 5. session.js missing from pages that define doSignOut ────────');
const DEFINE_DO_SIGN_OUT = /window\.doSignOut\s*=/;
let sessionFailures = 0;
for (const [f, content] of Object.entries(fileContents)) {
  if (DEFINE_DO_SIGN_OUT.test(content) && !content.includes('session.js')) {
    console.log(`  ❌ MISSING session.js: ${f}`);
    sessionFailures++;
    failures++;
  }
}
if (sessionFailures === 0) console.log('  ✅ All doSignOut-defining pages include session.js');

// ── Check 6: Functions barrel exports expected count ─────────────────────────
// Catches MODULE_NOT_FOUND in the barrel (missing ./modules/ prefix, dropped
// module, etc.) that would abort the entire deploy silently in production.
console.log('\n── 6. Cloud Functions barrel export count ─────────────────────────');
const EXPECTED_EXPORTS = 65;
try {
  const barrelPath = path.resolve(__dirname, '../functions/index.js');
  const exported = Object.keys(require(barrelPath)).length;
  if (exported < EXPECTED_EXPORTS) {
    console.log(`  ❌ Barrel exports ${exported} functions — expected ≥${EXPECTED_EXPORTS}. A module is missing or a require path is wrong.`);
    failures++;
  } else {
    console.log(`  ✅ Barrel exports ${exported} functions (≥${EXPECTED_EXPORTS})`);
  }
} catch (e) {
  console.log(`  ❌ Barrel failed to load: ${e.message}`);
  failures++;
}

// ── Check 7: No dead files in functions/lib/ ─────────────────────────────────
// Every file in lib/ must be imported by at least one module. A dead file means
// edits to it silently have no effect — wrong-file fixes are the dominant agent
// failure mode in this codebase.
console.log('\n── 7. Dead files in functions/lib/ ────────────────────────────────');
const LIB_DIR = path.resolve(__dirname, '../functions/lib');
const MODULES_DIR = path.resolve(__dirname, '../functions/modules');
const libFiles = fs.readdirSync(LIB_DIR).filter(f => f.endsWith('.js'));
// Collect all require() calls across modules/ and index.js
const scanDirs = [MODULES_DIR, path.resolve(__dirname, '../functions')];
let allFunctionSrc = '';
for (const dir of scanDirs) {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    allFunctionSrc += fs.readFileSync(path.join(dir, f), 'utf8');
  }
}
let deadLibFiles = 0;
for (const f of libFiles) {
  const base = path.basename(f, '.js');
  // Match require('../lib/X') or require('./lib/X') or require('../lib/X.js')
  const pattern = new RegExp(`require\\(['"]\\.\\./lib/${base}(?:\\.js)?['"]\\)`);
  if (!pattern.test(allFunctionSrc)) {
    console.log(`  ❌ Dead file: functions/lib/${f} — imported by nothing`);
    deadLibFiles++;
    failures++;
  }
}
if (deadLibFiles === 0) console.log(`  ✅ All ${libFiles.length} lib/ file(s) are imported`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n── Summary ───────────────────────────────────────────────────────');
if (failures === 0) {
  console.log('  ✅ All checks passed');
  process.exit(0);
} else {
  console.log(`  ❌ ${failures} failure(s) found — fix before deploying`);
  process.exit(1);
}
