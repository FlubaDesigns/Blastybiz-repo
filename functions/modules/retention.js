/**
 * BlastyBiz — Free account data retention
 * scheduledRetentionSweep, adminRetentionReport, adminBackfillLastActive
 *
 * Free accounts are kept for a marketing window and then purged. This is
 * destructive and irreversible, so the whole thing is built to fail safe:
 *
 *   - The mode lives in config/plans and defaults to 'report'. A config read
 *     failure falls back to defaults, which means it falls back to 'report'.
 *     Nothing deletes until someone deliberately sets mode to 'purge'.
 *   - Dormancy is measured against users/{uid}.lastActiveAt. Firestore range
 *     queries skip documents that lack the field, so an account with no
 *     lastActiveAt can never be selected. Missing data means safe, not doomed.
 *   - Nobody is purged who was not warned by email first, and the purge stage
 *     re-verifies plan and dormancy at deletion time rather than trusting the
 *     decision made when the warning was sent.
 *   - An owner coming back clears the warning markers on their next activity
 *     (see touchLastActive), so returning cancels the purge immediately.
 */
'use strict';

const {
  onRequest, onSchedule, admin, db,
  APP_BASE_URL, sendResendEmail,
  makeUnsubSig, _unsubSecret,
  withAuth, getPlanConfig, purgeUserData, resolveLastActive,
} = require('../lib/shared');

const DAY_MS = 24 * 60 * 60 * 1000;

// Plans that are subject to retention. Anything not in here is paying and is
// never touched by this process, whatever else its account looks like.
const FREE_PLANS = ['starter', 'trial'];

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return 0;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function clearDormancyMarkers() {
  return {
    dormancyWarnedAt:   admin.firestore.FieldValue.delete(),
    dormancyPurgeAt:    admin.firestore.FieldValue.delete(),
    dormancyReminderAt: admin.firestore.FieldValue.delete(),
  };
}

// ── Email ─────────────────────────────────────────────────────────────────────
// Deliberately NOT gated on emailUnsubscribed. That flag is a marketing
// preference; this is notice that we are about to delete someone's data, and
// silently skipping it would mean deleting without warning. The unsubscribe
// link is still present so the footer stays consistent and honest.
async function sendRetentionEmail(uid, userData, { type, subjectFallback, htmlFallback, mergeData }) {
  const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail`
    + `?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, _unsubSecret())}`;
  const tags = { ...mergeData, appUrl: APP_BASE_URL, unsubscribeUrl: unsubUrl };
  const apply = (str) => String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => tags[k] ?? '');

  let subject = apply(subjectFallback);
  let html = null;
  try {
    const tmplSnap = await db.collection('emailTemplates')
      .where('type', '==', type).where('active', '==', true).limit(1).get();
    if (!tmplSnap.empty) {
      const tmpl = tmplSnap.docs[0].data();
      subject = apply(tmpl.subject || subjectFallback);
      html    = apply(tmpl.html || '');
    }
  } catch (e) {
    console.error(`[retention] template fetch (${type}):`, e.message);
  }
  if (!html) html = apply(htmlFallback);

  await sendResendEmail({ to: userData.email, subject, html });
  return true;
}

function shell(bodyHtml) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">${bodyHtml}</div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &bull; <a href="{{unsubscribeUrl}}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;
}

const WARNING_HTML = shell(`
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">{{name}}, your BlastyBiz account has gone quiet.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">You haven't used BlastyBiz in a while, so we're getting ready to clear out your account to keep things tidy.</p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px"><strong>On {{deleteDate}}</strong> — that's {{daysLeft}} days from now — we'll delete your business profile, your campaigns, your saved listings and your posting history. This can't be undone.</p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px"><strong>Want to keep it? Just sign in.</strong> That's all it takes — one visit and everything stays exactly where you left it.</p>
    <a href="{{dashboardUrl}}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Keep My Account &#8594;</a>
    <p style="font-size:13px;color:#777;line-height:1.7;margin:24px 0 0">If you'd rather we deleted it sooner, or you want a copy of your data first, reply to this email and we'll sort it out.</p>`);

const FINAL_HTML = shell(`
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Last chance, {{name}} — {{daysLeft}} days left.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">This is the final reminder. <strong>On {{deleteDate}}</strong> your BlastyBiz business profile, campaigns, listings and posting history will be permanently deleted.</p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">Signing in once stops it. Nothing else needed.</p>
    <a href="{{dashboardUrl}}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Keep My Account &#8594;</a>`);

// ── runRetentionSweep ─────────────────────────────────────────────────────────
async function runRetentionSweep({ trigger = 'schedule', forceMode = null } = {}) {
  const cfg = (await getPlanConfig()).retention || {};
  const mode = forceMode || cfg.mode || 'report';
  const dormantDays       = num(cfg.dormantDays, 365);
  const warningDays       = num(cfg.warningDays, 14);
  const finalReminderDays = num(cfg.finalReminderDays, 3);
  const maxWarn           = num(cfg.maxWarnPerRun, 100);
  const maxPurge          = num(cfg.maxPurgePerRun, 25);

  const now = Date.now();
  const dormantCutoff = admin.firestore.Timestamp.fromMillis(now - dormantDays * DAY_MS);

  const run = {
    ranAt: admin.firestore.Timestamp.fromMillis(now),
    trigger, mode, dormantDays, warningDays, finalReminderDays,
    warned: 0, reminded: 0, purged: 0, cancelled: 0,
    skippedNoEmail: 0, skippedStillPaid: 0, skippedReactivated: 0,
    wouldWarn: 0, wouldPurge: 0,
    sampleWarn: [], samplePurge: [], errors: [],
  };

  // ── Stage 1: warn newly dormant free accounts ───────────────────────────────
  for (const plan of FREE_PLANS) {
    if (run.warned >= maxWarn || run.wouldWarn >= maxWarn) break;
    let snap;
    try {
      snap = await db.collection('users')
        .where('plan', '==', plan)
        .where('lastActiveAt', '<', dormantCutoff)
        .orderBy('lastActiveAt', 'asc')
        .limit(maxWarn * 2)
        .get();
    } catch (e) {
      run.errors.push(`warn-query:${plan}:${e.message}`);
      continue;
    }

    for (const docSnap of snap.docs) {
      if (run.warned >= maxWarn || run.wouldWarn >= maxWarn) break;
      const d = docSnap.data() || {};
      if (d.dormancyWarnedAt) continue;           // already in the warning window
      if (!d.email) { run.skippedNoEmail++; continue; }  // can't warn → never purge

      const purgeAtMs = now + warningDays * DAY_MS;
      if (run.sampleWarn.length < 25) {
        run.sampleWarn.push({
          uid: docSnap.id, email: d.email,
          lastActiveAt: d.lastActiveAt || null,
          purgeAt: admin.firestore.Timestamp.fromMillis(purgeAtMs),
        });
      }

      if (mode === 'report') { run.wouldWarn++; continue; }

      try {
        await sendRetentionEmail(docSnap.id, d, {
          type: 'dormancy-warning',
          subjectFallback: `{{name}}, your BlastyBiz account will be deleted on {{deleteDate}}`,
          htmlFallback: WARNING_HTML,
          mergeData: {
            name: d.ownerName || d.displayName || 'there',
            dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
            deleteDate: fmtDate(purgeAtMs),
            daysLeft: String(warningDays),
          },
        });
        await docSnap.ref.update({
          dormancyWarnedAt: admin.firestore.FieldValue.serverTimestamp(),
          dormancyPurgeAt:  admin.firestore.Timestamp.fromMillis(purgeAtMs),
        });
        run.warned++;
      } catch (e) {
        run.errors.push(`warn:${docSnap.id}:${e.message}`);
      }
    }
  }

  // ── Stage 2 + 3: final reminders, then purge ────────────────────────────────
  // One query covers both: everything whose purge date is inside the reminder
  // window or already past.
  let dueSnap = null;
  try {
    dueSnap = await db.collection('users')
      .where('dormancyPurgeAt', '<=', admin.firestore.Timestamp.fromMillis(now + finalReminderDays * DAY_MS))
      .orderBy('dormancyPurgeAt', 'asc')
      .limit(500)
      .get();
  } catch (e) {
    run.errors.push('due-query:' + e.message);
  }

  for (const docSnap of (dueSnap ? dueSnap.docs : [])) {
    const uid = docSnap.id;
    const d = docSnap.data() || {};
    const purgeAtMs = toMillis(d.dormancyPurgeAt);

    // Re-verify at deletion time rather than trusting the warning-time decision.
    if (!FREE_PLANS.includes(d.plan)) {
      run.skippedStillPaid++;
      if (mode !== 'report') { await docSnap.ref.update(clearDormancyMarkers()); run.cancelled++; }
      continue;
    }
    if (toMillis(d.lastActiveAt) >= dormantCutoff.toMillis()) {
      run.skippedReactivated++;
      if (mode !== 'report') { await docSnap.ref.update(clearDormancyMarkers()); run.cancelled++; }
      continue;
    }
    if (!d.dormancyWarnedAt) {
      // Should be impossible — a purge date without a warning means something
      // wrote the field by hand. Refuse rather than delete unwarned.
      run.errors.push(`unwarned-purge-candidate:${uid}`);
      continue;
    }

    // Final reminder: still inside the window.
    if (purgeAtMs > now) {
      if (d.dormancyReminderAt || !d.email) continue;
      const daysLeft = Math.max(1, Math.ceil((purgeAtMs - now) / DAY_MS));
      if (mode === 'report') { run.reminded++; continue; }
      try {
        await sendRetentionEmail(uid, d, {
          type: 'dormancy-final',
          subjectFallback: `Final reminder — your BlastyBiz data is deleted on {{deleteDate}}`,
          htmlFallback: FINAL_HTML,
          mergeData: {
            name: d.ownerName || d.displayName || 'there',
            dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
            deleteDate: fmtDate(purgeAtMs),
            daysLeft: String(daysLeft),
          },
        });
        await docSnap.ref.update({ dormancyReminderAt: admin.firestore.FieldValue.serverTimestamp() });
        run.reminded++;
      } catch (e) {
        run.errors.push(`remind:${uid}:${e.message}`);
      }
      continue;
    }

    // Past the purge date.
    if (run.purged >= maxPurge || run.wouldPurge >= maxPurge) continue;
    if (run.samplePurge.length < 25) {
      run.samplePurge.push({ uid, email: d.email || null, lastActiveAt: d.lastActiveAt || null });
    }
    if (mode !== 'purge') { run.wouldPurge++; continue; }

    try {
      const res = await purgeUserData(uid);
      run.purged++;
      if (res.errors.length) run.errors.push(`purge-partial:${uid}:${res.errors.join(',')}`);
      console.log(`[retention] purged ${uid} — ${res.docsDeleted} docs, ${res.businesses} businesses`);
    } catch (e) {
      run.errors.push(`purge:${uid}:${e.message}`);
    }
  }

  try {
    await db.collection('retentionRuns').add(run);
  } catch (e) {
    console.error('[retention] failed to record run:', e.message);
  }
  console.log('[retention]', JSON.stringify({
    mode, warned: run.warned, reminded: run.reminded, purged: run.purged,
    wouldWarn: run.wouldWarn, wouldPurge: run.wouldPurge, cancelled: run.cancelled,
    errors: run.errors.length,
  }));
  return run;
}

// ── scheduledRetentionSweep ───────────────────────────────────────────────────
exports.scheduledRetentionSweep = onSchedule(
  {
    schedule: 'every day 04:00', timeZone: 'America/New_York', region: 'us-central1',
    secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY', 'SQUARE_ACCESS_TOKEN'],
    timeoutSeconds: 540, memory: '512MiB',
  },
  async () => {
    try {
      await runRetentionSweep({ trigger: 'schedule' });
    } catch (e) {
      console.error('[scheduledRetentionSweep] error:', e.message);
    }
  }
);

// ── adminRetentionReport ──────────────────────────────────────────────────────
// Dry run on demand plus the history of previous runs, so the first real purge
// can be sanity-checked before it is armed.
exports.adminRetentionReport = onRequest(
  { invoker: 'public', timeoutSeconds: 300, memory: '512MiB' },
  withAuth(async (req, res) => {
    try {
      const cfg = (await getPlanConfig()).retention || {};
      const preview = await runRetentionSweep({ trigger: 'admin-dry-run', forceMode: 'report' });

      const histSnap = await db.collection('retentionRuns')
        .orderBy('ranAt', 'desc').limit(20).get();
      const history = histSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      res.json({ config: cfg, preview, history });
    } catch (e) {
      console.error('[adminRetentionReport]', e.message);
      res.status(500).json({ error: e.message });
    }
  }, { admin: true })
);

// ── adminBackfillLastActive ───────────────────────────────────────────────────
// Existing accounts predate lastActiveAt. Without this they'd have no field at
// all (safe — they'd never be swept), but they'd also never become eligible.
// Backfill derives the timestamp from real evidence of use.
exports.adminBackfillLastActive = onRequest(
  { invoker: 'public', timeoutSeconds: 540, memory: '512MiB' },
  withAuth(async (req, res) => {
    const { dryRun = true, limit = 200, overwrite = false } = req.body || {};
    try {
      const snap = await db.collection('users').limit(Math.min(Number(limit) || 200, 1000)).get();
      const out = { dryRun, scanned: snap.size, updated: 0, skipped: 0, noEvidence: 0, samples: [] };

      for (const docSnap of snap.docs) {
        const d = docSnap.data() || {};
        if (d.lastActiveAt && !overwrite) { out.skipped++; continue; }

        const ts = await resolveLastActive(docSnap.id, d);
        if (!ts) { out.noEvidence++; continue; }

        if (out.samples.length < 25) {
          out.samples.push({ uid: docSnap.id, email: d.email || null, plan: d.plan || null, lastActiveAt: ts });
        }
        if (!dryRun) await docSnap.ref.update({ lastActiveAt: ts });
        out.updated++;
      }
      res.json(out);
    } catch (e) {
      console.error('[adminBackfillLastActive]', e.message);
      res.status(500).json({ error: e.message });
    }
  }, { admin: true })
);

exports._runRetentionSweep = runRetentionSweep;
