#!/usr/bin/env node
/**
 * check-cf-endpoints.cjs — verify every Cloud Function URL referenced from
 * public/ is actually deployed at its cloudfunctions.net address.
 *
 * Why: previewAds and extractBizContext once existed in code (and at their
 * run.app URLs) while their us-central1-<project>.cloudfunctions.net/<name>
 * URLs returned 404 — live pages silently broke. This script greps public/
 * for every `cloudfunctions.net/<name>` reference and asserts each URL
 * answers an OPTIONS preflight with 204.
 *
 * Usage: node scripts/check-cf-endpoints.cjs
 * Exit code 0 = all endpoints answered 204, 1 = one or more failed.
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const ROOT       = path.resolve(__dirname, '..');
const PUBLIC     = path.join(ROOT, 'public');
const TIMEOUT_MS = 15_000;
const REGION     = 'us-central1';

function projectId() {
  if (process.env.FIREBASE_PROJECT_ID) return process.env.FIREBASE_PROJECT_ID;
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default;
  } catch {
    return null;
  }
}

// ── Collect referenced function names from public/ ──────────────────────────
// Covers every URL-construction pattern used in public/:
//   1. Full literal URLs:            https://...cloudfunctions.net/name
//   2. Template-literal on a base:   `${CF}/name`, `${CF_BASE}/name`, ...
//   3. String concatenation:         CF_BASE + '/name'
//   4. Dynamic suffixes:             cloudfunctions.net/${endpoint} or
//      `${CF}/${x}` — resolved via callAdminCF('name', ...) callers where
//      possible, otherwise reported so a human can review.
// Base constants are discovered per file (any identifier assigned a string
// ending in cloudfunctions.net), not hardcoded to specific variable names.
function collectReferencesFromSources(sources) {
  const names      = new Map();  // name -> Set of files referencing it
  const resolved   = [];         // dynamic refs resolved statically (informational)
  const unresolved = [];         // dynamic refs we could NOT resolve — audit failure

  const add = (name, file) => {
    if (!names.has(name)) names.set(name, new Set());
    names.get(name).add(file);
  };

  // Resolve a `${varName}` endpoint expression within one file's source.
  // Returns the list of possible literal function names, or [] if unresolvable.
  //   a) local assignment: const x = cond ? 'fnA' : 'fnB';  /  let x = 'fn';
  //   b) function parameter: varName is a param of a helper; collect string
  //      literals passed at that argument position from all call sites.
  function resolveVar(varName, content) {
    const out = new Set();
    const escVar = varName.replace(/\$/g, '\\$');
    // (a) assignments — pull every quoted identifier-like literal off the RHS
    const assignRe = new RegExp('(?:const|let|var)?\\s*\\b' + escVar + "\\s*=\\s*([^;\\n]+)", 'g');
    let m;
    while ((m = assignRe.exec(content)) !== null) {
      let rhs = m[1];
      if (/cloudfunctions\.net/.test(rhs)) continue; // that's a base-URL assignment
      // For ternaries, only the branches after `?` are candidate values —
      // the condition (e.g. platformId === 'google') is not a function name.
      const q = rhs.indexOf('?');
      if (q !== -1) rhs = rhs.slice(q + 1);
      const litRe = /['"]([A-Za-z0-9_]+)['"]/g;
      let l;
      while ((l = litRe.exec(rhs)) !== null) out.add(l[1]);
    }
    if (out.size) return [...out];
    // (b) helper parameter — find function whose param list includes varName
    const fnRe = new RegExp(
      '(?:function\\s+([A-Za-z0-9_$]+)|([A-Za-z0-9_$]+)\\s*=\\s*(?:async\\s*)?(?:function)?)\\s*\\(([^)]*)\\)', 'g');
    while ((m = fnRe.exec(content)) !== null) {
      const fnName = m[1] || m[2];
      const params = (m[3] || '').split(',').map(s => s.trim());
      const pos = params.indexOf(varName);
      if (!fnName || pos === -1) continue;
      const callRe = new RegExp('\\b' + fnName.replace(/\$/g, '\\$') + '\\(\\s*([^)]*)\\)', 'g');
      let c;
      while ((c = callRe.exec(content)) !== null) {
        const args = c[1].split(',').map(s => s.trim());
        const lm = /^['"]([A-Za-z0-9_]+)['"]$/.exec(args[pos] || '');
        if (lm) out.add(lm[1]);
      }
    }
    return [...out];
  }

  function handleDynamic(file, content, refLabel, expr) {
    // expr looks like ${varName} (possibly with more) — extract the variable
    const vm = /^\$\{([A-Za-z_$][A-Za-z0-9_$]*)\}/.exec(expr);
    const literals = vm ? resolveVar(vm[1], content) : [];
    if (literals.length) {
      for (const name of literals) add(name, `${file} (via ${refLabel})`);
      resolved.push({ file, ref: refLabel, names: literals });
    } else {
      unresolved.push({ file, ref: refLabel });
    }
  }

  for (const { file, content } of sources) {
    // Pattern 1 & 4a: anything directly after cloudfunctions.net/
    const directRe = /cloudfunctions\.net\/([A-Za-z0-9_$][A-Za-z0-9_${}]*)/g;
    let m;
    while ((m = directRe.exec(content)) !== null) {
      if (m[1].includes('$')) handleDynamic(file, content, `cloudfunctions.net/${m[1]}`, m[1]);
      else add(m[1], file);
    }

    // Discover base-URL constants: const CF = 'https://...cloudfunctions.net';
    const baseIds = new Set();
    const baseRe = /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*['"`]https:\/\/[^'"`]*cloudfunctions\.net\/?['"`]/g;
    while ((m = baseRe.exec(content)) !== null) baseIds.add(m[1]);

    for (const id of baseIds) {
      const esc = id.replace(/\$/g, '\\$');
      // Pattern 2: `${CF}/name` and dynamic `${CF}/${x}`
      const tplRe = new RegExp('\\$\\{' + esc + '\\}/([A-Za-z0-9_$][A-Za-z0-9_${}]*)', 'g');
      while ((m = tplRe.exec(content)) !== null) {
        if (m[1].includes('$')) handleDynamic(file, content, `\${${id}}/${m[1]}`, m[1]);
        else add(m[1], file);
      }
      // Pattern 3: CF_BASE + '/name'
      const concatRe = new RegExp('\\b' + esc + "\\s*\\+\\s*['\"`]/([A-Za-z0-9_]+)", 'g');
      while ((m = concatRe.exec(content)) !== null) add(m[1], file);
    }
  }
  return { names, resolved, unresolved };
}

function collectReferences() {
  const files = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html') || f.endsWith('.js'));
  const sources = files.map(f => ({ file: f, content: fs.readFileSync(path.join(PUBLIC, f), 'utf8') }));
  return collectReferencesFromSources(sources);
}

// ── Self-test: fixture coverage for every URL-construction pattern ──────────
function selfTest() {
  const fixtures = [
    { file: 'full-url.html',   content: `fetch('https://us-central1-p.cloudfunctions.net/directFn')` },
    { file: 'tpl-base.html',   content: "const CF = 'https://us-central1-p.cloudfunctions.net';\nfetch(`${CF}/tplFn`);" },
    { file: 'tpl-base2.html',  content: "const CF_BASE = 'https://us-central1-p.cloudfunctions.net/';\nfetch(`${CF_BASE}/tplFn2`);" },
    { file: 'concat.html',     content: "var CC_CF = 'https://us-central1-p.cloudfunctions.net';\nfetch(CC_CF + '/concatFn', {});" },
    // Helper-parameter resolution (the callAdminCF pattern)
    { file: 'dynamic.html',    content: "async function callAdminCF(endpoint, jobId) {\n  await fetch(`https://us-central1-p.cloudfunctions.net/${endpoint}`);\n}\ncallAdminCF('resolvedFn', 1);\ncallAdminCF('resolvedFn2', 2);" },
    // Local ternary assignment (the Connect-page OAuth pattern)
    { file: 'ternary.html',    content: "const CF = 'https://us-central1-p.cloudfunctions.net';\nconst initiateFn = platformId === 'google' ? 'initiateA' : 'initiateB';\nconst u = `${CF}/${initiateFn}?x=1`;" },
    // Unresolvable dynamic — MUST be reported as unresolved (audit failure)
    { file: 'dyn-base.html',   content: "const CF = 'https://us-central1-p.cloudfunctions.net';\nfetch(`${CF}/${mystery}`);" },
  ];
  const { names, resolved, unresolved } = collectReferencesFromSources(fixtures);
  const expected = ['concatFn', 'directFn', 'initiateA', 'initiateB', 'resolvedFn', 'resolvedFn2', 'tplFn', 'tplFn2'];
  const got = [...names.keys()].sort();
  let ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) console.error(`  ❌ self-test: expected [${expected}], got [${got}]`);
  if (resolved.length !== 2) { ok = false; console.error(`  ❌ self-test: expected 2 resolved dynamic refs, got ${resolved.length}`); }
  if (unresolved.length !== 1 || unresolved[0].file !== 'dyn-base.html') {
    ok = false;
    console.error(`  ❌ self-test: expected exactly 1 unresolved dynamic ref (dyn-base.html), got ${JSON.stringify(unresolved)}`);
  }
  console.log(ok ? '  ✅ self-test passed (all URL-construction patterns collected; unresolved dynamics flagged)' : '  ❌ self-test FAILED');
  process.exit(ok ? 0 : 1);
}

// ── OPTIONS preflight ────────────────────────────────────────────────────────
function optionsRequest(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname,
      method: 'OPTIONS',
      headers: {
        Origin: 'https://blastybiz.com',
        'Access-Control-Request-Method': 'POST',
      },
      timeout: TIMEOUT_MS,
    }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const project = projectId();
  if (!project) {
    console.error('❌ Cannot resolve Firebase project ID (set FIREBASE_PROJECT_ID or add .firebaserc)');
    process.exit(1);
  }

  const { names, resolved, unresolved } = collectReferences();
  console.log('\n── Cloud Function endpoint check (OPTIONS preflight) ─────────────');
  console.log(`  Project: ${project} — ${names.size} function name(s) referenced from public/\n`);

  for (const d of resolved) {
    console.log(`  ℹ️  Dynamic reference in ${d.file}: ${d.ref} — statically resolved to: ${d.names.join(', ')}`);
  }
  let unresolvedFailures = 0;
  for (const d of unresolved) {
    console.log(`  ❌ UNRESOLVED dynamic reference in ${d.file}: ${d.ref} — cannot verify which function(s) this calls.`);
    console.log(`     Use a literal name, a local const/ternary of literals, or a helper called with literal names.`);
    unresolvedFailures++;
  }

  const failed = [];
  const sorted = [...names.keys()].sort();
  for (const name of sorted) {
    const url = `https://${REGION}-${project}.cloudfunctions.net/${name}`;
    let status;
    try {
      status = await optionsRequest(url);
    } catch (e) {
      console.log(`  ❌ ${name} → ${e.message}`);
      failed.push(name);
      continue;
    }
    if (status === 204) {
      console.log(`  ✅ ${name} → 204`);
    } else {
      console.log(`  ❌ ${name} → HTTP ${status} (expected 204 — not deployed at cloudfunctions.net?)`);
      failed.push(name);
    }
  }

  console.log('\n── Summary ───────────────────────────────────────────────────────');
  if (failed.length === 0 && unresolvedFailures === 0) {
    console.log(`  ✅ All ${sorted.length} referenced Cloud Function endpoint(s) answered 204`);
    process.exit(0);
  }
  if (failed.length > 0) {
    console.log(`  ❌ ${failed.length} endpoint(s) FAILED preflight:`);
    for (const name of failed) {
      console.log(`     • ${name}  (referenced by: ${[...names.get(name)].join(', ')})`);
      console.log(`       fix: firebase deploy --only functions:${name}`);
    }
  }
  if (unresolvedFailures > 0) {
    console.log(`  ❌ ${unresolvedFailures} dynamic reference(s) could not be statically resolved (see above)`);
  }
  process.exit(1);
}

module.exports = { collectReferences, collectReferencesFromSources };

if (require.main === module) main().catch(e => {
  console.error('\nFatal error:', e.message);
  process.exit(1);
});
