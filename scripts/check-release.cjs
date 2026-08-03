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

const PUBLIC = path.resolve(__dirname, '../artifacts/api-server/public');

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
  'index.html',                   // root redirect
  'blastybiz-header.html',        // partial, fetched by header-loader.js
  'blastybiz-footer.html',        // partial, fetched inline
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
const ESCAPE_PATTERNS = [
  /function escHtml\(/g,
  /function _esc\(/g,
  /function escHtmlPub\(/g,
  /const escHtml\s*=/g,
  /var escHtml\s*=/g,
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

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n── Summary ───────────────────────────────────────────────────────');
if (failures === 0) {
  console.log('  ✅ All checks passed');
  process.exit(0);
} else {
  console.log(`  ❌ ${failures} failure(s) found — fix before deploying`);
  process.exit(1);
}
