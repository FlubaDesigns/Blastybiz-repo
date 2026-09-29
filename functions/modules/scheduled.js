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
  userBizRef, userBizCol, userBizPostsRef, userBizConnsRef, userBizJobsRef, PLATFORM_CAPABILITY_MAP,
  _getConnTokens,
  makeUnsubSig, _unsubSecret,
  makeActionSig, _actionSecret, computeNextRunAt, normalizeSchedule,
} = require('../lib/shared');

// Read bounded pages of due work. Persist the cursor so blocked records cannot
// monopolize every invocation when the queue exceeds one invocation's budget.
async function* scheduledDraftPages(worker, until, from = null) {
  const cursorRef = db.collection('maintenance').doc(worker);
  let cursor = (await cursorRef.get()).data() || {};
  for (let page = 0; page < 25; page++) {
    let query = db.collectionGroup('listingDrafts')
      .where('schedule.enabled', '==', true)
      .where('schedule.nextRunAt', '<=', until.toISOString());
    if (from) query = query.where('schedule.nextRunAt', '>=', from.toISOString());
    query = query.orderBy('schedule.nextRunAt').orderBy(admin.firestore.FieldPath.documentId()).limit(200);
    if (cursor.nextRunAt && cursor.path) query = query.startAfter(cursor.nextRunAt, db.doc(cursor.path));
    const snap = await query.get();
    if (!snap.docs.length) { await cursorRef.delete(); return; }
    yield snap.docs;
    const last = snap.docs[snap.docs.length - 1];
    cursor = { nextRunAt: last.data().schedule.nextRunAt, path: last.ref.path };
    if (snap.docs.length < 200) { await cursorRef.delete(); return; }
    await cursorRef.set(cursor);
  }
}

async function queueScheduledDraft(draftRef, now) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(draftRef);
    if (!snap.exists) return;
    const rawDraft = snap.data();
    const draft = rawDraft.packet ? {...rawDraft,...rawDraft.packet} : rawDraft;
    const schedule = normalizeSchedule(draft.schedule || {});
    if (!schedule.enabled) {
      if (schedule.unsupportedFrequency) tx.update(draftRef, { schedule });
      return;
    }
    let nextRunAt;
    try { nextRunAt = computeNextRunAt(schedule, now); }
    catch(e) { tx.update(draftRef, { 'schedule.enabled': false, 'schedule.pauseReason': e.message }); return; }
    const due = new Date(schedule.nextRunAt);
    if (!Number.isFinite(due.getTime())) {
      tx.update(draftRef, { 'schedule.enabled': false, 'schedule.pauseReason': 'Invalid next posting date.' }); return;
    }
    if (due > now) return;
    const parts = draftRef.path.split('/'), uid = parts[1], bizId = parts[3];
    const bizRef = userBizRef(uid, bizId);
    const bizSnap = await tx.get(bizRef);
    const userSnap = await tx.get(db.collection('users').doc(uid));
    const campaignRef = draft.campaignId ? bizRef.collection('campaigns').doc(draft.campaignId) : null;
    const campaignSnap = campaignRef ? await tx.get(campaignRef) : null;
    if (!bizSnap.exists || !userSnap.exists || (campaignRef && (!campaignSnap.exists || campaignSnap.data().status === 'archived'))) {
      tx.update(draftRef, { 'schedule.enabled': false, 'schedule.pauseReason': 'Business or campaign is no longer active.' }); return;
    }
    const cycle = due.toISOString();
    const runId = 'scheduled_' + crypto.createHash('sha256').update(JSON.stringify([uid,bizId,snap.id,cycle])).digest('hex');
    const receiptRef = draftRef.collection('private').doc(runId);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) return;
    const advance = {
      'schedule.nextRunAt': nextRunAt.toISOString(), 'schedule.lastRunAt': now.toISOString(),
      'schedule.approved': admin.firestore.FieldValue.delete(),
      'schedule.skipCycle': admin.firestore.FieldValue.delete(),
      'schedule.previewSentAt': admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (schedule.skipCycle) { tx.create(receiptRef,{cycle,skipped:true}); tx.update(draftRef,advance); return; }
    const biz = bizSnap.data(), user = userSnap.data();
    if (biz.schedulingPaused) return;
    const explicit = schedule.approved === true;
    if (!explicit) {
      if ((biz.approvalCount || 0) < 3) return;
      const engaged = user.lastEmailEngagedAt || user.createdAt;
      const engagedMs = engaged?.toMillis ? engaged.toMillis() : new Date(engaged || now).getTime();
      if (!Number.isFinite(engagedMs) || now.getTime() - engagedMs > 30 * 86400000) return;
      if (Object.values(draft.adaptations || {}).some(v=>v && typeof v==='object' && v.lowConfidence)) return;
    }
    // Only an explicit saved selection authorizes recurring delivery. Legacy
    // drafts lacking it are paused for owner selection instead of guessing.
    const ids = [...new Set(Array.isArray(draft.enabledPlatforms) ? draft.enabledPlatforms : [])].filter(id=>draft.platformStatus?.[id]!=='excluded');
    if (!ids.length || ids.length > 100 || ids.some(id=>typeof id!=='string'||!id||id.length>128||id.includes('/'))) {
      tx.update(draftRef, { 'schedule.enabled': false, 'schedule.pauseReason': 'Select destinations before resuming this schedule.' }); return;
    }
    const jobs = ids.map(pid => {
      const copy = draft.adaptations?.[pid];
      const content = typeof copy === 'string' ? copy : copy?.text;
      if (typeof content !== 'string' || !content.trim()) return null;
      const cap = PLATFORM_CAPABILITY_MAP[pid] || {name:pid,capabilityLevel:'manual_assisted',manualInstructions:''};
      const manual = cap.capabilityLevel !== 'full_auto';
      const images = draft.imagesByPlatform?.[pid] ?? draft.imageUrls ?? [];
      const jobRef = userBizJobsRef(uid,bizId).doc(runId+'_'+pid);
      return {ref:jobRef,data:{
        jobId:jobRef.id,uid,businessId:bizId,draftId:snap.id,campaignId:draft.campaignId || '',
        scheduledRunId:runId,scheduledCycle:cycle,scheduledExplicitApproval:explicit,
        ...(draft.adId?{adId:draft.adId,adName:draft.adName||'',blastId:runId}:{}),
        platform:pid,platformName:cap.name,capabilityLevel:cap.capabilityLevel,
        jobType:'scheduled_approved',status:manual?'manual_required':'pending',
        attempts:0,maxAttempts:5,customerNotified:false,
        customerLabel:manual?'Action needed':'Waiting to publish',
        customerVisibleMessage:manual?'Your scheduled copy is ready to post manually.':'Your scheduled post is waiting to publish.',
        manualInstructions:cap.manualInstructions || '',
        payload:{adaptedContent:content,imageUrls:(Array.isArray(images)?images:[]).filter(u=>typeof u==='string'&&/^https:\/\//i.test(u)).slice(0,10)},
        createdAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp(),
      }};
    }).filter(Boolean);
    if (jobs.length !== ids.length) {
      tx.update(draftRef, { 'schedule.enabled': false, 'schedule.pauseReason': 'A selected destination has no saved copy. Generate or deselect it before resuming.' }); return;
    }
    // Advancing is safe only with durable, individually retryable jobs in the
    // same transaction. Provider calls belong exclusively to the dispatcher.
    for (const job of jobs) tx.create(job.ref,job.data);
    tx.create(receiptRef,{cycle,jobIds:jobs.map(j=>j.ref.id),approvalCounted:false,
      packet:{campaignId:draft.campaignId||'',adId:draft.adId||null,adName:draft.adName||'',campaignName:draft.campaignName||'',copyBehavior:'reuse',
        imageRefs:draft.imageRefs||draft.packet?.imageRefs||[],enabledPlatforms:ids,
        adaptations:Object.fromEntries(jobs.map(j=>[j.data.platform,j.data.payload.adaptedContent])),
        imagesByPlatform:Object.fromEntries(jobs.map(j=>[j.data.platform,j.data.payload.imageUrls]))}});
    tx.update(draftRef,advance);
  });
}

exports.scheduledPostingCheck = onSchedule(
  { schedule: 'every 1 hours', region: 'us-central1' },
  async () => {
    const now = new Date();
    try {
      for await (const page of scheduledDraftPages('scheduledPostingCursor', now)) {
        for (const draftSnap of page) {
          try { await queueScheduledDraft(draftSnap.ref,now); }
          catch(e) { console.error('[scheduledPostingCheck] draft failed '+draftSnap.ref.path+':',e.message); }
        }
      }
    } catch(e) { console.error('[scheduledPostingCheck] error:',e.message); }
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
      for await (const page of scheduledDraftPages('scheduledPreviewCursor', h48, now)) {
      for (const draftSnap of page) {
        let scheduleValidated = false;
        try {
          const draft    = draftSnap.data();
          const schedule = normalizeSchedule(draft.schedule || {});
          if (schedule.unsupportedFrequency) {
            await draftSnap.ref.update({ schedule, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            continue;
          }

          const nextRunAt = computeNextRunAt(schedule, now);
          scheduleValidated = true;

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
          if(draft.campaignId) {
            const campaign=await userBizRef(uid,bizId).collection('campaigns').doc(draft.campaignId).get();
            if(!campaign.exists || campaign.data().status==='archived') {
              await draftSnap.ref.update({'schedule.enabled':false,'schedule.pauseReason':'Campaign archived.'});
              continue;
            }
          }

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
          const platforms = [...new Set(Array.isArray(draft.enabledPlatforms)?draft.enabledPlatforms:[])].filter(pid=>draft.platformStatus?.[pid]!=='excluded'&&adaptations[pid]);
          if (!platforms.length) {
            await draftSnap.ref.update({'schedule.enabled':false,'schedule.pauseReason':'Select destinations with saved copy before resuming.'});
            continue;
          }

          // ── Build signed action links ──────────────────────────────────────
          const key = _actionSecret();
          if (!key) { console.warn('[scheduledDraftPreview] ACTION_SIGNING_KEY not set'); continue; }
          const cycle = String(nextRun.getTime());

          function mkLink(act) {
            // cycle is included in the HMAC so it cannot be modified without breaking the sig
            const sig = makeActionSig(uid, bizId, draftId, act, cycle, key);
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
        } catch(e) {
          console.error('[scheduledDraftPreview] draft failed ' + draftSnap.ref.path + ':', e.message);
          // Invalid recurrence must not remain due and block later drafts. A
          // transient failure after validation must not disable a valid schedule.
          if (!scheduleValidated) {
            try {
              await draftSnap.ref.update({
                'schedule.enabled': false,
                'schedule.pauseReason': e.message,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            } catch(pauseError) {
              console.error('[scheduledDraftPreview] pause failed ' + draftSnap.ref.path + ':', pauseError.message);
            }
          }
          continue;
        }
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
        let subject = `${mergeData.name}, room to grow is one click away 🚀`;
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
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">BlastyBiz Pro adds business capacity and a larger AI budget. Automatic publishing to connected Google, Facebook and Instagram accounts is available on every plan.</p>
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
