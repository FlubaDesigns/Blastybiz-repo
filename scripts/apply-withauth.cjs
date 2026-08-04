#!/usr/bin/env node
/**
 * scripts/apply-withauth.cjs   (2.2)
 *
 * Transforms all onRequest handlers in functions/index.js to use withAuth().
 * Safe to re-run: idempotent (skips already-converted handlers).
 *
 * Usage:
 *   node scripts/apply-withauth.cjs            # apply changes
 *   node scripts/apply-withauth.cjs --dry-run  # preview only
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const DRY  = process.argv.includes('--dry-run');
const FILE = path.join(__dirname, '../functions/index.js');
let src    = fs.readFileSync(FILE, 'utf8');
const orig = src;

// ── 1. Inject withAuth definition after setCors function ──────────────────────
const WITHAUTH_DEF = `
// ── 2.2: withAuth — single standard wrapper for every onRequest handler ───────
// Handles CORS preflight and authentication in one place.
//   withAuth(fn)                → requires valid Firebase bearer token (user)
//   withAuth(fn, { admin:t })   → requires admin role
//   withAuth(fn, { public:t })  → no auth (public endpoint)
function withAuth(fn, opts = {}) {
  return async (req, res) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    let decoded = null;
    if (!opts.public) {
      if (opts.admin) {
        try { decoded = await requireAdmin(req); }
        catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
      } else {
        try { decoded = await verifyBearer(req); }
        catch (e) { return res.status(401).json({ error: 'Unauthorized' }); }
      }
    }
    return fn(req, res, decoded);
  };
}
`;

if (!src.includes('function withAuth(')) {
  // Find end of setCors block via brace counting
  const idx = src.indexOf('\nfunction setCors(');
  if (idx === -1) { console.error('setCors not found'); process.exit(1); }
  let depth = 0, pos = src.indexOf('{', idx);
  while (pos < src.length) {
    if (src[pos] === '{') depth++;
    else if (src[pos] === '}') { depth--; if (depth === 0) break; }
    pos++;
  }
  src = src.slice(0, pos + 1) + WITHAUTH_DEF + src.slice(pos + 1);
  console.log('✅ Inserted withAuth() definition');
} else {
  console.log('ℹ️  withAuth() already present — skipping definition insert');
}

// ── 2. Define boilerplate patterns & their replacements ───────────────────────
// Each entry: { from, to, opts }
//   from  — regex that matches the entire handler open + boilerplate
//   to    — replacement string (the new handler open)
//   opts  — string to insert between `}` and `));` at the close: '' | ', { admin: true }' | ', { public: true }'

// Marker scheme: we embed a comment /*_WA_ADMIN_*/ or /*_WA_USER_*/ in the
// replacement so the close-fixing pass knows which opts to use.

const PATTERNS = [
  // ── Admin, no captured variable ───────────────────────────────────────────
  {
    from: /,\s*async\s*\(req,\s*res\)\s*=>\s*\{\n  setCors\(req, res\);\n  if \(req\.method === 'OPTIONS'\) return res\.sendStatus\(204\);\n  try \{ await requireAdmin\(req\); \} catch\(e\) \{ return res\.status\(e\.status \|\| 403\)\.json\(\{ error: e\.message \}\); \}\n/g,
    to:   ', withAuth(async (req, res, decoded) => { /*_WA_ADMIN_*/\n',
    opts: ', { admin: true }',
  },
  // ── Admin, with `let adminDecoded` capture ────────────────────────────────
  {
    from: /,\s*async\s*\(req,\s*res\)\s*=>\s*\{\n  setCors\(req, res\);\n  if \(req\.method === 'OPTIONS'\) return res\.sendStatus\(204\);\n  let adminDecoded;?\n  try \{ adminDecoded = await requireAdmin\(req\); \} catch\(e\) \{ return res\.status\(e\.status \|\| 403\)\.json\(\{ error: e\.message \}\); \}\n/g,
    to:   ', withAuth(async (req, res, decoded) => { /*_WA_ADMIN_*/\n  const adminDecoded = decoded;\n',
    opts: ', { admin: true }',
  },
  // ── User, OPTIONS variant { res.status(204).send }  + let decoded ─────────
  {
    from: /,\s*async\s*\(req,\s*res\)\s*=>\s*\{\n  setCors\(req, res\);\n  if \(req\.method === 'OPTIONS'\) \{ res\.status\(204\)\.send\(''\); return; \}\n  let decoded;\n  try \{ decoded = await verifyBearer\(req\); \} catch\(e\) \{ return res\.status\(401\)\.json\(\{ error: 'Unauthorized' \}\); \}\n/g,
    to:   ', withAuth(async (req, res, decoded) => { /*_WA_USER_*/\n',
    opts: '',
  },
  // ── User, OPTIONS sendStatus(204) + let decoded ───────────────────────────
  {
    from: /,\s*async\s*\(req,\s*res\)\s*=>\s*\{\n  setCors\(req, res\);\n  if \(req\.method === 'OPTIONS'\) return res\.sendStatus\(204\);\n  let decoded;\n  try \{ decoded = await verifyBearer\(req\); \} catch\(e\) \{ return res\.status\(401\)\.json\(\{ error: 'Unauthorized' \}\); \}\n/g,
    to:   ', withAuth(async (req, res, decoded) => { /*_WA_USER_*/\n',
    opts: '',
  },
  // ── User, OPTIONS { 204.send } + `let uid` + decoded.uid ─────────────────
  {
    from: /,\s*async\s*\(req,\s*res\)\s*=>\s*\{\n  setCors\(req, res\);\n  if \(req\.method === 'OPTIONS'\) \{ res\.status\(204\)\.send\(''\); return; \}\n  let uid;\n  try \{ const decoded = await verifyBearer\(req\); uid = decoded\.uid; \} catch\(e\) \{ return res\.status\(401\)\.json\(\{ error: 'Unauthorized' \}\); \}\n/g,
    to:   ', withAuth(async (req, res, decoded) => { /*_WA_USER_*/\n  const uid = decoded.uid;\n',
    opts: '',
  },
  // ── User, OPTIONS sendStatus(204) + `let uid` + decoded.uid ──────────────
  {
    from: /,\s*async\s*\(req,\s*res\)\s*=>\s*\{\n  setCors\(req, res\);\n  if \(req\.method === 'OPTIONS'\) return res\.sendStatus\(204\);\n  let uid;\n  try \{ const decoded = await verifyBearer\(req\); uid = decoded\.uid; \} catch\(e\) \{ return res\.status\(401\)\.json\(\{ error: 'Unauthorized' \}\); \}\n/g,
    to:   ', withAuth(async (req, res, decoded) => { /*_WA_USER_*/\n  const uid = decoded.uid;\n',
    opts: '',
  },
];

// Apply each pattern
let totalOpens = 0;
for (const p of PATTERNS) {
  const before = (src.match(p.from) || []).length;
  src = src.replace(p.from, p.to);
  console.log(`Pattern "${p.to.slice(0, 40).trim()}...": ${before} matches`);
  totalOpens += before;
}
console.log(`\nTotal opens transformed: ${totalOpens}`);

// ── 3. Fix closes using brace counting ───────────────────────────────────────
// Find each /*_WA_ADMIN_*/ or /*_WA_USER_*/ marker.  Count braces from the
// handler `{` to find its matching `}`, then fix the close.

/**
 * Find the matching closing brace for the `{` at `openBracePos` in `str`.
 * Returns the index of the matching `}`, or -1.
 */
function matchingClose(str, openBracePos) {
  let depth = 0;
  for (let i = openBracePos; i < str.length; i++) {
    // Skip string literals crudely (good enough since braces in strings are balanced)
    if (str[i] === '{') depth++;
    else if (str[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Collect all marker positions (after the regex replacements above)
const MARKER_RE = /withAuth\(async \(req, res, decoded\) => \{ \/\*_WA_(ADMIN|USER|PUBLIC)_\*\//g;
const markers = [];
let mm;
while ((mm = MARKER_RE.exec(src)) !== null) {
  // The `{` of the handler body is just before the marker comment
  const openBraceIdx = mm.index + mm[0].indexOf('{'); // the `{` in `=> {`
  markers.push({ idx: openBraceIdx, type: mm[1] });
}
console.log(`\nFound ${markers.length} markers for close-fixing`);

// Process in REVERSE order so earlier positions remain valid after mutation
markers.sort((a, b) => b.idx - a.idx);

let closeFixed = 0;
for (const { idx: openIdx, type } of markers) {
  const closeIdx = matchingClose(src, openIdx);
  if (closeIdx === -1) { console.warn(`  ⚠️  No close found for handler at ${openIdx}`); continue; }

  // After the `}` at closeIdx, we expect `);` immediately (the `});` pattern)
  // or possibly whitespace then `);`
  let p = closeIdx + 1;
  while (p < src.length && src[p] === ' ' || src[p] === '\t') p++;

  const optsStr = type === 'ADMIN' ? ', { admin: true }' : (type === 'PUBLIC' ? ', { public: true }' : '');

  if (src[p] === ')' && src[p + 1] === ';') {
    // Normal close: `});` → `}opts));`
    // We consume the original `)` and `;` and replace with `opts));`
    src = src.slice(0, closeIdx + 1) + optsStr + '));' + src.slice(p + 2);
    closeFixed++;
  } else if (src[p] === ';' && src[p - 1] === ')') {
    // Already has the right structure? Skip.
    console.warn(`  ⚠️  Unexpected structure at ${closeIdx}: '${src.slice(closeIdx, closeIdx + 20)}'`);
  } else {
    console.warn(`  ⚠️  Unexpected char at ${p}: '${src.slice(p, p + 10)}'`);
  }
}

console.log(`Close braces fixed: ${closeFixed}`);

// ── 4. Clean up marker comments ───────────────────────────────────────────────
src = src.replace(/ \/\*_WA_(ADMIN|USER|PUBLIC)_\*\//g, '');

// ── 5. Handle remaining "public" endpoints ────────────────────────────────────
// Public endpoints have only setCors + OPTIONS and no auth block.
// They are NOT caught by the patterns above since there's no auth boilerplate.
// List the known public endpoints so we can convert them safely.
const PUBLIC_OPENS = [
  // contactForm, scoreFact, unsubscribeEmail, squareWebhook (skip — special)
  // These have setCors + OPTIONS but no auth check
  // We'll just leave them as-is for now with a note.
];
// (Intentionally not auto-converting public endpoints to avoid changing security-sensitive behaviour)

// ── 6. Verify ─────────────────────────────────────────────────────────────────
const totalWrapped = (src.match(/withAuth\(/g) || []).length - 1; // minus the definition
const setCorsRemaining = (src.match(/^\s+setCors\(req, res\);/gm) || []).length;
const optionsRemaining = (src.match(/if \(req\.method === 'OPTIONS'\)/g) || []).length;
// OPTIONS in withAuth itself counts as 1
console.log(`\n── Summary ──────────────────────────────────────────────────────`);
console.log(`  withAuth-wrapped handlers : ${totalWrapped}`);
console.log(`  setCors() calls in handlers remaining : ${setCorsRemaining}`);
console.log(`  OPTIONS checks remaining  : ${optionsRemaining} (1 is withAuth itself)`);

if (DRY) {
  console.log('\n[DRY RUN] No changes written. Showing first diff ...');
  const origLines = orig.split('\n');
  const newLines  = src.split('\n');
  let shown = 0;
  for (let i = 0; i < Math.min(origLines.length, newLines.length) && shown < 60; i++) {
    if (origLines[i] !== newLines[i]) {
      console.log(`L${i + 1}  - ${origLines[i]}`);
      console.log(`L${i + 1}  + ${newLines[i]}`);
      shown++;
    }
  }
} else {
  fs.writeFileSync(FILE, src);
  console.log(`\n✅ Written to ${FILE}`);
}
