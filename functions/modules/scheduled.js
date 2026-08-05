/**
 * BlastyBiz — Scheduled Cloud Functions
 * scheduledPostingCheck, scheduledDraftPreview, scheduledUpgradeNudge,
 * scheduledWeeklyDigest, scheduledSetupNudge, scheduledFirestoreExport,
 * cleanupAbandonedSignups
 */
'use strict';

const {
  onRequest, onSchedule, admin, db, axios, crypto,
  APP_BASE_URL, sendResendEmail,
  userBizRef, userBizCol, userBizPostsRef, userBizConnsRef,
  _getConnTokens,
  makeUnsubSig, _unsubSecret,
  makeActionSig, _actionSecret, computeNextRunAt,
} = require('../lib/shared');

// ── Platform helpers for scheduled posting ────────────────────────────────────
const SCHED_PLATFORMS = {
  google:   { name: 'Google Business Profile', publish: publishGoogle   },
  facebook: { name: 'Facebook Page',           publish: publishFacebook },
  instagram:{ name: 'Instagram',               publish: publishInstagram},
};

// _computeNextRunAt is now imported as computeNextRunAt from lib/shared

async function publishGoogle(uid, bizId, content, imageUrls) {
  const connRef  = userBizConnsRef(uid, bizId).doc('google');
  const connSnap = await connRef.get();
  if (!connSnap.exists || connSnap.data().status !== 'connected') {
    throw new Error('Google not connected');
  }
  const tokens = await _getConnTokens(connRef);
  const conn   = { ...connSnap.data(), ...tokens };
  let accessToken = conn.accessToken;
  if (!accessToken) throw new Error('No Google access token');

  async function tryPost(tok) {
    return axios.post(
      `https://mybusinesspostings.googleapis.com/v1/locations/${conn.locationId}/localPosts`,
      { languageCode: 'en-US', summary: content,
        media: (imageUrls||[]).map(u=>({mediaFormat:'PHOTO',sourceUrl:u})) },
      { headers: { Authorization: `Bearer ${tok}` } }
    );
  }
  try {
    const r = await tryPost(accessToken);
    return { postId: r.data.name };
  } catch(e) {
    if (e.response?.status === 401 && conn.refreshToken) {
      const rResp = await axios.post('https://oauth2.googleapis.com/token', null, {
        params: { client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
                  refresh_token: conn.refreshToken, grant_type: 'refresh_token' }
      });
      const newToken = rResp.data.access_token;
      const { _setConnTokens } = require('../lib/shared');
      await _setConnTokens(connRef, { accessToken: newToken });
      await connRef.update({ updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      const r = await tryPost(newToken);
      return { postId: r.data.name };
    }
    throw new Error('Google API: ' + (e.response?.data?.error?.message || e.message));
  }
}

async function publishFacebook(uid, bizId, content) {
  const connRef  = userBizConnsRef(uid, bizId).doc('facebook');
  const connSnap = await connRef.get();
  if (!connSnap.exists || connSnap.data().status !== 'connected') throw new Error('Facebook not connected');
  const tokens = await _getConnTokens(connRef);
  const conn   = { ...connSnap.data(), ...tokens };
  if (!conn.pageId || !conn.accessToken) throw new Error('Missing Facebook page credentials');
  const r = await axios.post(
    `https://graph.facebook.com/v18.0/${conn.pageId}/feed`,
    { message: content, access_token: conn.accessToken }
  );
  return { postId: r.data.id };
}

async function publishInstagram(uid, bizId, content, imageUrls) {
  const connRef  = userBizConnsRef(uid, bizId).doc('instagram');
  const connSnap = await connRef.get();
  if (!connSnap.exists || connSnap.data().status !== 'connected') throw new Error('Instagram not connected');
  const tokens = await _getConnTokens(connRef);
  const conn   = { ...connSnap.data(), ...tokens };
  const imageUrl = (imageUrls||[])[0];
  if (!imageUrl) return { manualFallback: true, reason: 'no_image', message: 'Instagram requires an image.' };
  const media = await axios.post(
    `https://graph.facebook.com/v18.0/${conn.igUserId}/media`,
    { image_url: imageUrl, caption: content, access_token: conn.accessToken }
  );
  const pub = await axios.post(
    `https://graph.facebook.com/v18.0/${conn.igUserId}/media_publish`,
    { creation_id: media.data.id, access_token: conn.accessToken }
  );
  return { postId: pub.data.id };
}

async function _runScheduledPost(schedule) {
  const { uid, bizId, platformId, content, imageUrls } = schedule;
  const platform = SCHED_PLATFORMS[platformId];
  if (!platform) throw new Error(`Unsupported scheduled platform: ${platformId}`);
  return platform.publish(uid, bizId, content, imageUrls);
}

// ── scheduledPostingCheck ─────────────────────────────────────────────────────
// Runs hourly. Evaluates every enabled schedule draft and applies four guards
// before posting: skip-cycle, global-pause, first-three approval gate, and
// silence-is-approval (owner-gone-dark + lowConfidence checks).
exports.scheduledPostingCheck = onSchedule(
  { schedule: 'every 1 hours', region: 'us-central1',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  async () => {
    const now = new Date();
    const API_PLATFORMS = ['google', 'facebook', 'instagram'];
    try {
      const snap = await db.collectionGroup('listingDrafts')
        .where('schedule.enabled', '==', true)
        .limit(200)
        .get();

      for (const draftSnap of snap.docs) {
        const draft    = draftSnap.data();
        const schedule = draft.schedule || {};
        if (!schedule.nextRunAt || new Date(schedule.nextRunAt) > now) continue;

        // Path shape: users/{uid}/businesses/{bizId}/listingDrafts/{id}
        const parts = draftSnap.ref.path.split('/');
        const uid   = parts[1];
        const bizId = parts[3];
        const adaptations      = draft.adaptations || {};
        const nextRunAt        = computeNextRunAt(schedule, now);
        const isExplicitApproval = schedule.approved === true;

        // ── Guard 0: skip-cycle ─────────────────────────────────────────────
        if (schedule.skipCycle === true) {
          await draftSnap.ref.update({
            'schedule.nextRunAt':     nextRunAt.toISOString(),
            'schedule.lastRunAt':     now.toISOString(),
            'schedule.skipCycle':     admin.firestore.FieldValue.delete(),
            'schedule.approved':      admin.firestore.FieldValue.delete(),
            'schedule.previewSentAt': admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[scheduledPostingCheck] skipCycle ${uid}/${bizId} — advanced to ${nextRunAt.toISOString()}`);
          continue;
        }

        // ── Guard 1: global pause ───────────────────────────────────────────
        let bizData = {};
        try {
          const bizSnap = await userBizRef(uid, bizId).get();
          bizData = bizSnap.exists ? bizSnap.data() : {};
        } catch(e) {
          console.warn(`[scheduledPostingCheck] biz read failed ${uid}/${bizId}: ${e.message}`);
          continue;
        }
        if (bizData.schedulingPaused === true) {
          // Do NOT advance nextRunAt — post will run once unpaused
          console.log(`[scheduledPostingCheck] schedulingPaused ${uid}/${bizId} — skipping`);
          continue;
        }

        // ── Guard 2 & 3: approval gates ─────────────────────────────────────
        const approvalCount = bizData.approvalCount || 0;

        if (approvalCount < 3) {
          // First-three gate: explicit approval required for every post
          if (!isExplicitApproval) {
            console.log(`[scheduledPostingCheck] awaiting explicit approval (count=${approvalCount}) ${uid}/${bizId}`);
            continue; // Do not advance nextRunAt — wait for owner to approve
          }
        } else {
          // Silence-is-approval — but apply two extra safety checks
          if (!isExplicitApproval) {
            // Check 1: owner-gone-dark (no email engagement in 30 days)
            let ownerDark = false;
            try {
              const userSnap = await db.collection('users').doc(uid).get();
              const userData = userSnap.exists ? userSnap.data() : {};
              const lastEngaged = userData.lastEmailEngagedAt;
              if (lastEngaged) {
                const ms = lastEngaged.toMillis ? lastEngaged.toMillis() : new Date(lastEngaged).getTime();
                ownerDark = Date.now() - ms > 30 * 24 * 60 * 60 * 1000;
              } else {
                // Never clicked an action link — use account age as proxy
                const createdAt = userData.createdAt;
                const ageMs = createdAt
                  ? Date.now() - (createdAt.toMillis ? createdAt.toMillis() : new Date(createdAt).getTime())
                  : 0;
                ownerDark = ageMs > 30 * 24 * 60 * 60 * 1000;
              }
            } catch(e) { /* non-fatal — treat as not dark */ }

            if (ownerDark) {
              console.log(`[scheduledPostingCheck] owner-gone-dark ${uid}/${bizId} — requiring explicit approval`);
              continue;
            }

            // Check 2: any content flagged lowConfidence
            const hasLowConf = Object.values(adaptations).some(v =>
              v && typeof v === 'object' && v.lowConfidence === true
            );
            if (hasLowConf) {
              console.log(`[scheduledPostingCheck] lowConfidence content ${uid}/${bizId} — requiring explicit approval`);
              continue;
            }
          }
        }

        // ── Post to each API platform ────────────────────────────────────────
        let anyPosted = false;
        for (const platformId of API_PLATFORMS) {
          const content = typeof adaptations[platformId] === 'string'
            ? adaptations[platformId]
            : adaptations[platformId]?.text || adaptations[platformId];
          if (!content) continue;
          try {
            const result = await _runScheduledPost({
              uid, bizId, platformId, content, imageUrls: draft.imageUrls || [],
            });
            if (result.manualFallback) {
              console.warn(`[scheduledPostingCheck] manual fallback ${uid}/${bizId}/${platformId}: ${result.reason}`);
            } else {
              anyPosted = true;
            }
          } catch(e) {
            console.error(`[scheduledPostingCheck] failed ${uid}/${bizId}/${platformId}:`, e.message);
          }
        }

        // ── Advance schedule, clear per-cycle flags ──────────────────────────
        await draftSnap.ref.update({
          'schedule.nextRunAt':     nextRunAt.toISOString(),
          'schedule.lastRunAt':     now.toISOString(),
          'schedule.approved':      admin.firestore.FieldValue.delete(),
          'schedule.skipCycle':     admin.firestore.FieldValue.delete(),
          'schedule.previewSentAt': admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Increment approvalCount on an explicit-approval post so we track trust milestones
        if (anyPosted && isExplicitApproval) {
          await userBizRef(uid, bizId).update({
            approvalCount: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }).catch(e => console.warn(`[scheduledPostingCheck] approvalCount increment failed: ${e.message}`));
        }
      }
    } catch(e) {
      console.error('[scheduledPostingCheck] error:', e.message);
    }
  }
);

// ── scheduledDraftPreview ─────────────────────────────────────────────────────
// Runs daily. For each enabled draft due within 48 hours that hasn't had a
// preview email sent this cycle, send the owner a preview with Approve / Skip /
// Change / Pause links. Silence = the post goes out automatically.
const CF_BASE = 'https://us-central1-blastybiz-9523e.cloudfunctions.net';

exports.scheduledDraftPreview = onSchedule(
  { schedule: 'every 24 hours', region: 'us-central1',
    secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY', 'ACTION_SIGNING_KEY'] },
  async () => {
    const now  = new Date();
    const h48  = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    try {
      const snap = await db.collectionGroup('listingDrafts')
        .where('schedule.enabled', '==', true)
        .limit(200)
        .get();

      for (const draftSnap of snap.docs) {
        const draft    = draftSnap.data();
        const schedule = draft.schedule || {};

        // Only preview drafts due within the next 48 h
        if (!schedule.nextRunAt) continue;
        const nextRun = new Date(schedule.nextRunAt);
        if (nextRun < now || nextRun > h48) continue;

        // Don't send a second preview in the same cycle
        if (schedule.previewSentAt) {
          const sentAt = typeof schedule.previewSentAt === 'string'
            ? new Date(schedule.previewSentAt)
            : (schedule.previewSentAt.toDate?.() || new Date(schedule.previewSentAt));
          if (sentAt > new Date(now.getTime() - 23 * 60 * 60 * 1000)) continue;
        }

        const parts = draftSnap.ref.path.split('/');
        const uid   = parts[1];
        const bizId = parts[3];
        const draftId = draftSnap.id;

        // Get owner details
        let email, ownerName, plan;
        try {
          const userSnap = await db.collection('users').doc(uid).get();
          if (!userSnap.exists) continue;
          const u = userSnap.data();
          if (u.emailUnsubscribed) continue;
          email     = u.email;
          ownerName = u.ownerName || u.displayName || '';
          plan      = u.plan || 'starter';
        } catch(_) { continue; }

        if (!email || !['pro', 'agency'].includes(plan)) continue;

        // Check business not paused
        try {
          const bizSnap = await userBizRef(uid, bizId).get();
          if (bizSnap.exists && bizSnap.data().schedulingPaused) continue;
        } catch(_) { continue; }

        const adaptations = draft.adaptations || {};
        const platforms   = Object.keys(adaptations);
        if (!platforms.length) continue;

        // ── Build signed action links ──────────────────────────────────────
        const key = _actionSecret();
        if (!key) { console.warn('[scheduledDraftPreview] ACTION_SIGNING_KEY not set'); continue; }
        const cycle = String(now.getTime());

        function mkLink(act) {
          // cycle is included in the HMAC so it cannot be modified without breaking the sig
          const sig = makeActionSig(uid, draftId, act, cycle, key);
          return `${CF_BASE}/draftAction?uid=${encodeURIComponent(uid)}&biz=${encodeURIComponent(bizId)}&draft=${encodeURIComponent(draftId)}&action=${act}&sig=${sig}&cycle=${cycle}`;
        }

        const approveUrl = mkLink('approve');
        const skipUrl    = mkLink('skip');
        const changeUrl  = mkLink('change');
        const pauseUrl   = mkLink('pause');
        const unsubUrl   = `${CF_BASE}/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, _unsubSecret())}`;

        // ── Format dates ──────────────────────────────────────────────────
        const dayName  = nextRun.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr  = nextRun.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

        // ── Ad copy preview (first 2 platforms, max 350 chars each) ───────
        function escHtml(s) {
          return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }
        const previewPlats = platforms.slice(0, 2);
        const copyHtml = previewPlats.map(pid => {
          const raw = typeof adaptations[pid] === 'string'
            ? adaptations[pid]
            : (adaptations[pid]?.text || JSON.stringify(adaptations[pid]));
          const copy = raw.replace(/<br\/?>/gi, '\n').slice(0, 350) + (raw.length > 350 ? '…' : '');
          return `<div style="background:#f7f7f7;border-radius:8px;padding:14px 16px;margin-bottom:10px">
  <div style="font-size:10px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${escHtml(pid)}</div>
  <div style="font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap">${escHtml(copy)}</div>
</div>`;
        }).join('');

        const name    = ownerName || 'there';
        const platStr = platforms.join(', ');
        const subject = `Your BlastyBiz post goes out ${dayName} — take a look`;

        const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto"/>
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <p style="font-size:15px;color:#333;margin:0 0 8px">Hey ${escHtml(name)} —</p>
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 16px">Your post goes out <strong>${escHtml(dateStr)}</strong>.</h1>
    <p style="font-size:14px;color:#555;line-height:1.65;margin:0 0 20px">Here's a preview of what's going out. If it looks good, do nothing — it posts automatically.</p>
    ${copyHtml}
    <p style="font-size:12px;color:#888;margin:8px 0 24px">Platforms: ${escHtml(platStr)}</p>
    <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px">
      <tr>
        <td style="padding-right:10px">
          <a href="${approveUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:800;font-size:14px">✓ Approve</a>
        </td>
        <td style="padding-right:10px">
          <a href="${skipUrl}" style="display:inline-block;background:#f5f5f5;color:#333;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px;border:1px solid #ddd">⏭ Skip</a>
        </td>
        <td>
          <a href="${changeUrl}" style="display:inline-block;background:#f5f5f5;color:#333;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px;border:1px solid #ddd">✏️ Change</a>
        </td>
      </tr>
    </table>
    <div style="background:#e8f5e9;border-radius:8px;padding:14px 18px;margin-bottom:24px">
      <p style="font-size:13px;color:#1b5e20;margin:0;font-weight:600">⏰ Or do nothing — we'll post it automatically on ${escHtml(dayName)}.</p>
    </div>
    <a href="${APP_BASE_URL}/BlastyBiz.html" style="font-size:13px;color:#00873a;font-weight:700;text-decoration:none">View Dashboard →</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0;line-height:1.8">
      &#169; BlastyBiz &bull;
      <a href="${pauseUrl}" style="color:#999;text-decoration:underline">Pause all scheduled posts</a> &bull;
      <a href="${unsubUrl}" style="color:#999;text-decoration:underline">Unsubscribe from all emails</a>
    </p>
  </div>
</div>`;

        try {
          await sendResendEmail({ to: email, subject, html });
          await draftSnap.ref.update({
            'schedule.previewSentAt': now.toISOString(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[scheduledDraftPreview] sent to ${uid}/${bizId}/${draftId}`);
        } catch(e) {
          console.error(`[scheduledDraftPreview] send failed ${uid}/${bizId}/${draftId}: ${e.message}`);
        }
      }
    } catch(e) {
      console.error('[scheduledDraftPreview] error:', e.message);
    }
  }
);

// ── scheduledUpgradeNudge ─────────────────────────────────────────────────────
exports.scheduledUpgradeNudge = onSchedule(
  { schedule: 'every monday 10:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] },
  async () => {
    try {
      const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const snap = await db.collection('users')
        .where('plan', '==', 'starter')
        .where('onboarded', '==', true)
        .where('upgradeNudgeSentAt', '<', cutoff)
        .limit(100)
        .get();

      let sent = 0;
      for (const docSnap of snap.docs) {
        const userData = docSnap.data();
        const uid = docSnap.id;
        if (!userData.email || userData.emailUnsubscribed) continue;
        const ownerName = userData.ownerName || userData.displayName || '';
        const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, _unsubSecret())}`;
        const mergeData = {
          name: ownerName || 'there',
          upgradeUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
          appUrl: APP_BASE_URL,
          unsubscribeUrl: unsubUrl,
        };
        function applyUpgradeTags(str) {
          return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
        }
        let subject = `${mergeData.name}, auto-publishing is one click away 🚀`;
        let html = null;
        try {
          const tmplSnap = await db.collection('emailTemplates')
            .where('type', '==', 'upgrade-nudge').where('active', '==', true).limit(1).get();
          if (!tmplSnap.empty) {
            const tmpl = tmplSnap.docs[0].data();
            subject = applyUpgradeTags(tmpl.subject || subject);
            html    = applyUpgradeTags(tmpl.html || '');
          }
        } catch(e) { console.error('[scheduledUpgradeNudge] template fetch:', e.message); }
        if (!html) {
          html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hey ${mergeData.name} — you\'re one upgrade away from full auto.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">BlastyBiz Pro publishes your listings automatically — no copy-paste, no manual work. Connect Google and Facebook once, and BlastyBiz handles the rest.</p>
    <a href="${mergeData.upgradeUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Upgrade to Pro &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;
        }
        await sendResendEmail({ to: userData.email, subject, html });
        await docSnap.ref.update({ upgradeNudgeSentAt: admin.firestore.FieldValue.serverTimestamp() });
        sent++;
      }
      console.log(`[scheduledUpgradeNudge] Sent ${sent} nudges`);
    } catch(e) {
      console.error('[scheduledUpgradeNudge] error:', e.message);
    }
  }
);

// ── scheduledWeeklyDigest ─────────────────────────────────────────────────────
exports.scheduledWeeklyDigest = onSchedule(
  { schedule: 'every monday 08:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] },
  async () => {
    const weekAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
    try {
      const usersSnap = await db.collection('users')
        .where('onboarded', '==', true)
        .where('plan', 'in', ['pro', 'agency'])
        .limit(200)
        .get();

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const uid = userDoc.id;
        if (!userData.email || userData.emailUnsubscribed) continue;

        let successCount = 0, manualCount = 0;
        try {
          const jobsSnap = await db.collectionGroup('publishJobs')
            .where('uid', '==', uid)
            .where('createdAt', '>=', weekAgo)
            .get();
          successCount = jobsSnap.docs.filter(d => d.data().status === 'success').length;
          manualCount  = jobsSnap.docs.filter(d => d.data().status === 'manual_required').length;
        } catch(e) { continue; }

        if (successCount === 0 && manualCount === 0) continue;

        const ownerName = userData.ownerName || userData.displayName || '';
        const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, _unsubSecret())}`;
        const mergeData = {
          name: ownerName || 'there',
          successCount: String(successCount),
          manualCount:  String(manualCount),
          dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
          appUrl: APP_BASE_URL,
          unsubscribeUrl: unsubUrl,
        };
        function applyDigestTags(str) {
          return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
        }
        let subject = `Your BlastyBiz weekly report is ready, ${mergeData.name} 📊`;
        let html = null;
        try {
          const tmplSnap = await db.collection('emailTemplates')
            .where('type', '==', 'weekly-digest').where('active', '==', true).limit(1).get();
          if (!tmplSnap.empty) {
            const tmpl = tmplSnap.docs[0].data();
            subject = applyDigestTags(tmpl.subject || subject);
            html    = applyDigestTags(tmpl.html || '');
          }
        } catch(e) { console.error('[scheduledWeeklyDigest] template fetch:', e.message); }
        if (!html) {
          html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hey ${mergeData.name} — here\'s your week.</h1>
    <div style="display:flex;gap:16px;margin-bottom:24px">
      <div style="flex:1;background:#e8f5e9;border-radius:10px;padding:16px 20px;text-align:center">
        <div style="font-size:32px;font-weight:900;color:#00873a">${successCount}</div>
        <div style="font-size:12px;font-weight:700;color:#555;margin-top:4px">AUTO-PUBLISHED</div>
      </div>
      ${manualCount > 0 ? `<div style="flex:1;background:#fff3e0;border-radius:10px;padding:16px 20px;text-align:center">
        <div style="font-size:32px;font-weight:900;color:#e65100">${manualCount}</div>
        <div style="font-size:12px;font-weight:700;color:#555;margin-top:4px">NEED MANUAL POST</div>
      </div>` : ''}
    </div>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">View Dashboard &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;
        }
        await sendResendEmail({ to: userData.email, subject, html });
      }
    } catch(e) {
      console.error('[scheduledWeeklyDigest] error:', e.message);
    }
  }
);

// ── scheduledSetupNudge ───────────────────────────────────────────────────────
exports.scheduledSetupNudge = onSchedule(
  { schedule: 'every monday 09:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] },
  async () => {
    const now = Date.now();
    try {
      const snap = await db.collection('setupNudges')
        .where('sent', '==', false)
        .where('sendAfter', '<=', admin.firestore.Timestamp.fromMillis(now))
        .limit(50)
        .get();

      for (const docSnap of snap.docs) {
        const { uid, email } = docSnap.data();
        if (!email) {
          await docSnap.ref.update({ sent: true });
          continue;
        }

        let userEmail = email, ownerName = '', onboarded = false;
        try {
          const userSnap = await db.collection('users').doc(uid).get();
          if (userSnap.exists) {
            const d = userSnap.data();
            onboarded = d.onboarded === true;
            ownerName = d.ownerName || d.displayName || '';
            userEmail = d.email || email;
            if (d.emailUnsubscribed) { await docSnap.ref.update({ sent: true }); continue; }
          }
        } catch(e) { /* non-fatal */ }

        if (onboarded) { await docSnap.ref.update({ sent: true }); continue; }

        const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, _unsubSecret())}`;
        const mergeData = {
          name: ownerName || 'there',
          appUrl: APP_BASE_URL,
          dashboardUrl: APP_BASE_URL + '/BlastyBiz-Login.html',
          unsubscribeUrl: unsubUrl,
        };
        function applySetupTags(str) {
          return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
        }
        let subject = `${mergeData.name}, finish your BlastyBiz setup`;
        let html = null;
        try {
          const tmplSnap = await db.collection('emailTemplates')
            .where('type', '==', 'setup-nudge').where('active', '==', true).limit(1).get();
          if (!tmplSnap.empty) {
            const tmpl = tmplSnap.docs[0].data();
            subject = applySetupTags(tmpl.subject || subject);
            html    = applySetupTags(tmpl.html || '');
          }
        } catch(e) { console.error('[scheduledSetupNudge] template fetch:', e.message); }
        if (!html) {
          html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hey ${mergeData.name} — your setup is waiting.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">You created a BlastyBiz account but haven\'t finished setting up your business. It only takes a few minutes — and once you\'re done, BlastyBiz can start blasting for you.</p>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Finish Setup &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;
        }
        await sendResendEmail({ to: userEmail, subject, html });
        await docSnap.ref.update({ sent: true, sentAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    } catch(e) {
      console.error('[scheduledSetupNudge] error:', e.message);
    }
  }
);

// ── scheduledFirestoreExport ──────────────────────────────────────────────────
/**
 * 4.9 — Weekly Firestore managed export to GCS for disaster recovery.
 *
 * One-time ops steps (run once before this function is useful):
 *   1. Create a GCS bucket:
 *      gsutil mb -l us-central1 gs://blastybiz-firestore-backups
 *   2. Grant the Firebase service account write access:
 *      gsutil iam ch serviceAccount:firebase-adminsdk-XXXXX@blastybiz-9523e.iam.gserviceaccount.com:objectAdmin gs://blastybiz-firestore-backups
 *      (find the SA email in GCP Console → IAM → filter "firebase-adminsdk")
 *   3. Enable Firestore PITR:
 *      gcloud firestore databases update --database='(default)' --enable-pitr
 *   This function will fail silently if the bucket or IAM role hasn't been set up yet.
 */
exports.scheduledFirestoreExport = onSchedule(
  { schedule: '0 2 * * 0', timeZone: 'America/Los_Angeles', region: 'us-central1' },
  async () => {
    const projectId = process.env.GCLOUD_PROJECT || 'blastybiz-9523e';
    const bucket    = `gs://blastybiz-firestore-backups`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputUri = `${bucket}/${timestamp}`;

    try {
      const { GoogleAuth } = require('google-auth-library');
      const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });
      const client = await auth.getClient();
      const token  = await client.getAccessToken();

      const resp = await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputUriPrefix: outputUri }),
        }
      );
      if (!resp.ok) {
        const err = await resp.text();
        console.error('[scheduledFirestoreExport] Export API error:', err);
        return;
      }
      const op = await resp.json();
      console.log(`[scheduledFirestoreExport] Export started: ${op.name || '(unknown op)'} → ${outputUri}`);
    } catch(e) {
      console.error('[scheduledFirestoreExport] error:', e.message);
    }
  }
);

// ── cleanupAbandonedSignups ───────────────────────────────────────────────────
exports.cleanupAbandonedSignups = onSchedule(
  { schedule: 'every 24 hours', region: 'us-central1' },
  async () => {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    try {
      const dedupSnap = await db.collection('aiRequestDedup')
        .where('createdAt', '<', cutoff).limit(500).get();
      if (!dedupSnap.empty) {
        const batch = db.batch();
        dedupSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        console.log(`[cleanupAbandonedSignups] Deleted ${dedupSnap.size} stale dedup entries`);
      }
      const rlSnap = await db.collection('contactRateLimit')
        .where('expiresAt', '<', admin.firestore.Timestamp.fromMillis(Date.now())).limit(500).get();
      if (!rlSnap.empty) {
        const batch2 = db.batch();
        rlSnap.docs.forEach(d => batch2.delete(d.ref));
        await batch2.commit();
        console.log(`[cleanupAbandonedSignups] Deleted ${rlSnap.size} expired rate-limit entries`);
      }
      const nudgeSnap = await db.collection('setupNudges')
        .where('sent', '==', true)
        .where('createdAt', '<', cutoff).limit(500).get();
      if (!nudgeSnap.empty) {
        const batch3 = db.batch();
        nudgeSnap.docs.forEach(d => batch3.delete(d.ref));
        await batch3.commit();
        console.log(`[cleanupAbandonedSignups] Deleted ${nudgeSnap.size} old nudge records`);
      }
      // ── Expired previewCache entries (TTL field set at write time) ──────────
      const pcSnap = await db.collection('previewCache')
        .where('expiresAt', '<', admin.firestore.Timestamp.fromMillis(Date.now())).limit(500).get();
      if (!pcSnap.empty) {
        const batch4 = db.batch();
        pcSnap.docs.forEach(d => batch4.delete(d.ref));
        await batch4.commit();
        console.log(`[cleanupAbandonedSignups] Deleted ${pcSnap.size} expired previewCache entries`);
      }
      // ── Expired previewRateLimit entries ────────────────────────────────────
      const prlSnap = await db.collection('previewRateLimit')
        .where('expiresAt', '<', admin.firestore.Timestamp.fromMillis(Date.now())).limit(500).get();
      if (!prlSnap.empty) {
        const batch5 = db.batch();
        prlSnap.docs.forEach(d => batch5.delete(d.ref));
        await batch5.commit();
        console.log(`[cleanupAbandonedSignups] Deleted ${prlSnap.size} expired previewRateLimit entries`);
      }
    } catch(e) {
      console.error('[cleanupAbandonedSignups] error:', e.message);
    }
  }
);
