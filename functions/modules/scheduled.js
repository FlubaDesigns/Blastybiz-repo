/**
 * BlastyBiz — Scheduled Cloud Functions
 * scheduledPostingCheck, scheduledYelpCategoryRefresh, scheduledUpgradeNudge,
 * scheduledWeeklyDigest, scheduledSetupNudge, scheduledFirestoreExport,
 * cleanupAbandonedSignups
 */
'use strict';

const {
  onRequest, onSchedule, admin, db, axios,
  APP_BASE_URL, sendResendEmail,
  userBizRef, userBizCol, userBizPostsRef, userBizConnsRef,
  _getConnTokens,
  makeUnsubSig, _unsubSecret,
} = require('../lib/shared');

const { fetchAndCacheYelpCategories } = require('./admin');

// ── Platform helpers for scheduled posting ────────────────────────────────────
const SCHED_PLATFORMS = {
  google:   { name: 'Google Business Profile', publish: publishGoogle   },
  facebook: { name: 'Facebook Page',           publish: publishFacebook },
  instagram:{ name: 'Instagram',               publish: publishInstagram},
};

async function _computeNextRunAt(schedule, now) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const freq = schedule.frequency || 'weekly';
  if (freq === 'daily')   return new Date(now.getTime() + DAY_MS);
  if (freq === 'weekly')  return new Date(now.getTime() + 7 * DAY_MS);
  if (freq === 'monthly') return new Date(now.getTime() + 30 * DAY_MS);
  return new Date(now.getTime() + 7 * DAY_MS);
}

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
exports.scheduledPostingCheck = onSchedule(
  { schedule: 'every 30 minutes', region: 'us-central1', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
  async () => {
    const now = new Date();
    try {
      const snap = await db.collectionGroup('scheduledPosts')
        .where('status', '==', 'active')
        .where('nextRunAt', '<=', now)
        .limit(50)
        .get();

      for (const docSnap of snap.docs) {
        const schedule = docSnap.data();
        const schedRef = docSnap.ref;
        try {
          const result = await _runScheduledPost(schedule);
          const nextRunAt = await _computeNextRunAt(schedule, now);
          const update = {
            lastRunAt:    now,
            nextRunAt,
            lastResult:   result.manualFallback ? 'manual_fallback' : 'success',
            lastPostId:   result.postId || null,
            runCount:     admin.firestore.FieldValue.increment(1),
            updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
          };
          if (result.manualFallback) {
            update.status = 'paused';
            update.pauseReason = result.reason || 'manual_fallback';
          }
          await schedRef.update(update);
        } catch(e) {
          console.error(`[scheduledPostingCheck] failed for ${docSnap.id}:`, e.message);
          await schedRef.update({
            status: 'paused', pauseReason: e.message,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    } catch(e) {
      console.error('[scheduledPostingCheck] error:', e.message);
    }
  }
);

// ── scheduledYelpCategoryRefresh ──────────────────────────────────────────────
exports.scheduledYelpCategoryRefresh = onSchedule(
  { schedule: 'every 720 hours', region: 'us-central1' },
  async () => {
    try {
      const count = await fetchAndCacheYelpCategories();
      console.log(`[scheduledYelpCategoryRefresh] Cached ${count} categories`);
    } catch(e) {
      console.error('[scheduledYelpCategoryRefresh] error:', e.message);
    }
  }
);

// ── scheduledUpgradeNudge ─────────────────────────────────────────────────────
exports.scheduledUpgradeNudge = onSchedule(
  { schedule: 'every monday 09:00', region: 'us-central1', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] },
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
  { schedule: 'every monday 09:30', region: 'us-central1', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] },
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
  { schedule: 'every 6 hours', region: 'us-central1', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] },
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
    } catch(e) {
      console.error('[cleanupAbandonedSignups] error:', e.message);
    }
  }
);
