'use strict';
const axios = require('axios');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const { db, admin, userBizRef, userBizCol, userBizDraftsRef, userBizJobsRef, userBizPostsRef, userBizConnsRef, _getConnTokens, _setConnTokens } = require('../lib/db');
const { bbLog } = require('../lib/logging');
const { sendResendEmail }   = require('../lib/email');
const { makeUnsubSig, _unsubSecret } = require('../lib/unsub');
const { callAI, trackAiUsage, classifyAiError, AI_DEFAULTS } = require('../lib/ai');
const { PLATFORM_DOCS, buildPlatformBlock }                  = require('../lib/platforms');
const { fetchAndCacheYelpCategories }                        = require('../lib/yelp');
const { APP_BASE_URL }      = require('../lib/config');

// ── Platforms included in automated scheduled posts ───────────────────────────
const SCHED_PLATFORMS = [
  { id: 'google',    name: 'Google Business',      type: 'api'    },
  { id: 'facebook',  name: 'Facebook Business',    type: 'api'    },
  { id: 'instagram', name: 'Instagram Business',   type: 'api'    },
  { id: 'nextdoor',  name: 'Nextdoor',             type: 'manual' },
  { id: 'fbmarket',  name: 'Facebook Marketplace', type: 'manual' },
  { id: 'craigslist',name: 'Craigslist',           type: 'manual' },
  { id: 'yelp',      name: 'Yelp',                 type: 'manual' },
  { id: 'alignable', name: 'Alignable',            type: 'manual' },
  { id: 'thumbtack', name: 'Thumbtack',            type: 'manual' },
  { id: 'angi',      name: 'Angi',                 type: 'manual' },
  { id: 'applemaps', name: 'Apple Maps Connect',   type: 'manual' },
  { id: 'linkedin',  name: 'LinkedIn',             type: 'manual' },
  { id: 'x',         name: 'X (Twitter)',          type: 'manual' },
];

// ── _computeNextRunAt ─────────────────────────────────────────────────────────
function _computeNextRunAt(sched, fromDate) {
  const tz       = sched.timezone || 'America/New_York';
  const slotHour = { morning: 9, midday: 12, afternoon: 15, evening: 18 }[sched.timeSlot || 'morning'];
  const from     = fromDate || new Date();

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(from);
  const gp = (t) => parseInt(parts.find(p => p.type === t)?.value || '0');
  const lYear = gp('year'), lMonth = gp('month') - 1, lDay = gp('day'), lHour = gp('hour');
  const lDow  = new Date(lYear, lMonth, lDay).getDay();

  let candYear = lYear, candMonth = lMonth, candDay = lDay;

  if (sched.frequency === 'daily') {
    if (lHour >= slotHour) {
      const d = new Date(lYear, lMonth, lDay + 1);
      candYear = d.getFullYear(); candMonth = d.getMonth(); candDay = d.getDate();
    }
  } else if (sched.frequency === 'custom') {
    const days  = Math.max(1, parseInt(sched.customDays) || 7);
    const ahead = lHour >= slotHour ? days : (days > 1 ? days - 1 : 0);
    const d     = new Date(lYear, lMonth, lDay + ahead);
    candYear = d.getFullYear(); candMonth = d.getMonth(); candDay = d.getDate();
  } else if (sched.frequency === 'monthly') {
    const dom = sched.dayOfMonth || 1;
    if (lDay < dom || (lDay === dom && lHour < slotHour)) {
      candDay = dom;
    } else {
      const d = new Date(lYear, lMonth + 1, dom);
      candYear = d.getFullYear(); candMonth = d.getMonth(); candDay = d.getDate();
    }
  } else {
    const targetDow = sched.dayOfWeek ?? 1;
    let ahead = (targetDow - lDow + 7) % 7;
    if (ahead === 0 && lHour >= slotHour) ahead = sched.frequency === 'biweekly' ? 14 : 7;
    else if (sched.frequency === 'biweekly' && ahead > 0 && ahead < 7) ahead += 7;
    const d = new Date(lYear, lMonth, lDay + ahead);
    candYear = d.getFullYear(); candMonth = d.getMonth(); candDay = d.getDate();
  }

  const approx  = new Date(candYear, candMonth, candDay, slotHour, 0, 0);
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(approx);
  const tgp      = (t) => parseInt(tzParts.find(p => p.type === t)?.value || '0');
  const tzLocalMs = Date.UTC(tgp('year'), tgp('month') - 1, tgp('day'), tgp('hour'), tgp('minute'), 0);
  return new Date(approx.getTime() + (approx.getTime() - tzLocalMs));
}

// ── _runScheduledPost ─────────────────────────────────────────────────────────
async function _runScheduledPost(bizId, biz, sched, activeCampaignId, activeCampaignName, schedUid) {
  if (!sched) { sched = biz.postingSchedule || {}; }
  if (!activeCampaignId)   activeCampaignId   = sched.activeCampaignId   || '';
  if (!activeCampaignName) activeCampaignName = sched.activeCampaignName || '';
  if (!schedUid)           schedUid = biz.uid || '';

  const bizName = biz.businessName || biz.name;
  const tone    = biz.tone || 'friendly';
  const address = biz.address || (biz.city ? `${biz.city}, ${biz.state}` : '');
  const locType = biz.locationType || 'physical';
  const region  = biz.region || '';

  let _schedUserData = {};
  if (schedUid) {
    try {
      const userSnap    = await db.collection('users').doc(schedUid).get();
      _schedUserData    = userSnap.exists ? userSnap.data() : {};
      const isPaid      = _schedUserData.planActive === true &&
                          (_schedUserData.plan === 'pro' || _schedUserData.plan === 'agency');
      if (!isPaid) {
        console.log(`[scheduledPost] Skipping biz ${bizId} — not a paid active plan (uid=${schedUid})`);
        return;
      }
    } catch(e) {
      console.error(`[scheduledPost] plan check failed for biz ${bizId}:`, e.message);
      return;
    }
  }

  let campaignContext = '';
  if (activeCampaignId) {
    try {
      const draftQ = await userBizDraftsRef(schedUid, bizId)
        .where('campaignId', '==', activeCampaignId)
        .orderBy('createdAt', 'desc').limit(1).get();
      if (!draftQ.empty) {
        const d = draftQ.docs[0].data();
        const lines = [
          `Campaign: ${d.campaignName || sched.activeCampaignName || ''}`,
          d.adName    ? `Ad: ${d.adName}`        : '',
          d.offer     ? `Offer: ${d.offer}`       : '',
          d.adDetails ? `Details: ${d.adDetails}` : '',
          d.price     ? `Price: ${d.price}`       : '',
        ].filter(Boolean);
        if (lines.length) campaignContext = '\nACTIVE CAMPAIGN (use this as the primary focus for every platform post):\n' + lines.join('\n');
      }
    } catch(e) { console.warn('[scheduledPost] campaign draft lookup failed:', e.message); }
  }

  const offerLines = [
    biz.category ? `Category: ${biz.category}` : '',
    biz.offer || biz.description || '',
    biz.specialNotes ? `Notes: ${biz.specialNotes}` : '',
    biz.hours ? `Hours: ${biz.hours}` : '',
  ].filter(Boolean).join('\n');

  const connSnap      = await userBizConnsRef(schedUid, bizId).where('status', '==', 'connected').get();
  const connectedIds  = new Set(connSnap.docs.map(d => d.data().platform || d.id));
  const activePlatforms = SCHED_PLATFORMS.filter(p => connectedIds.has(p.id) || p.type === 'manual');
  if (!activePlatforms.length) return;

  const platformCats = biz.platformCats || {};
  const platformList = activePlatforms.map(p => ({
    ...p, doc: PLATFORM_DOCS[p.id] || {},
    cat: platformCats[p.id] ? ` (category: ${platformCats[p.id]})` : '',
  }));

  const prompt = `You are a local business marketing expert. Generate a fresh recurring post for each platform. This is an automated scheduled post — make it feel current and engaging, not stale.

BUSINESS INFO:
- Name: ${bizName}
- Category: ${biz.category || 'General'}
- Description: ${offerLines || 'A great local business'}
- Phone: ${biz.phone || 'not provided'}
- Location type: ${locType === 'online' ? 'Online only' : 'Physical location'}
- Address/Area: ${locType === 'online' ? (region ? 'Serves: ' + region : 'Online') : (address || 'not provided')}
- Website: ${biz.website || 'none'}
- Hours: ${biz.hours || 'not provided'}
- Preferred tone: ${tone}
${(biz.bizInsights||[]).filter(i=>i.answer).length ? '\n⚠️ OWNER-PROVIDED FACTS — MANDATORY. The owner answered these questions so their copy is never generic. You MUST reference these details directly and specifically in the copy. Do NOT write filler when real facts are available:\n' + biz.bizInsights.filter(i=>i.answer).map(i=>`- ${i.question}: ${i.answer}`).join('\n') : ''}${(biz.globalFactoids||[]).length ? '\n📌 BUSINESS FACTS — Use selectively. Include a fact only when it genuinely strengthens this specific post. Do NOT force every fact into every piece. Higher score = stronger brand signal:\n' + [...biz.globalFactoids].sort((a,b)=>(b.importance!=null?b.importance:5)-(a.importance!=null?a.importance:5)).map(f=>`- [${f.importance!=null?f.importance:5}/10] ${f.text}`).join('\n') : ''}${campaignContext}
PLATFORMS TO WRITE FOR:
${platformList.map(buildPlatformBlock).join('\n')}

Return ONLY valid JSON using each platform's exact json key shown above in the section header: { "adaptations": { ${platformList.map(p=>`"${p.id}": "text"`).join(', ')} } }`;

  let _gspModel;
  const aiStartMs = Date.now();
  let parsed;
  try {
    const { text: aiText, usage: aiUsage, model } = await callAI(prompt, { tier: 'smart', maxTokens: 2000 });
    _gspModel = model;
    parsed    = JSON.parse(aiText.replace(/```json|```/g, '').trim());
    const aiElapsedMs = Date.now() - aiStartMs;
    trackAiUsage('system', 'generateScheduledPost', _gspModel, aiUsage, {
      timing:  { aiElapsedMs },
      context: { businessId: bizId || null, scheduleId: bizId || null, campaignId: activeCampaignId || null },
    });
  } catch(e) {
    const failureType = classifyAiError(e);
    if (failureType === 'anthropic_timeout') console.warn('[AI_TIMEOUT] generateScheduledPost timed out after 25s — bizId:', bizId);
    trackAiUsage('system', 'generateScheduledPost', _gspModel || AI_DEFAULTS.smartModel, null, {
      failureType,
      context: { businessId: bizId || null, scheduleId: bizId || null, campaignId: activeCampaignId || null },
    });
    throw e;
  }
  const adapted = parsed.adaptations || {};

  if (sched.requireApproval) {
    await userBizPostsRef(schedUid, bizId).add({
      bizId, uid: schedUid, status: 'pending',
      adaptations: adapted, platforms: activePlatforms, tone,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[scheduledPost] biz ${bizId} — requireApproval=true, saved to pendingPosts`);
    return;
  }

  const uid       = schedUid;
  const plan      = _schedUserData.plan || 'starter';
  const isStarter = plan === 'starter';

  const batch = db.batch();
  for (const p of activePlatforms) {
    const content = adapted[p.id];
    if (!content) continue;
    const isManual = p.type === 'manual' || isStarter;
    const jobRef   = userBizJobsRef(uid, bizId).doc();
    batch.set(jobRef, {
      jobId: jobRef.id, businessId: bizId, uid,
      platform: p.id, capabilityLevel: p.type === 'api' ? 'full_api' : 'manual_assisted',
      jobType: 'scheduled_post',
      status: isManual ? 'manual_required' : 'pending',
      attempts: 0, maxAttempts: 3,
      customerLabel: isManual ? 'Action needed' : 'Waiting to publish',
      customerVisibleMessage: isManual
        ? `Your scheduled ${p.name} post is ready — copy it below.`
        : `Your scheduled ${p.name} post is waiting to publish.`,
      planGated: isStarter && p.type === 'api',
      payload: { adaptedContent: content },
      apiResponse: {}, customerNotified: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

// ══════════════════════════════════════════
// scheduledPostingCheck — runs every hour
// ══════════════════════════════════════════
exports.scheduledPostingCheck = onSchedule(
  { schedule: 'every 1 hours', region: 'us-central1', secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'] },
  async () => {
    const now        = new Date();
    const BATCH_SIZE = 50;
    let lastDoc      = null;

    while (true) {
      let q = db.collectionGroup('listingDrafts')
        .where('schedule.enabled', '==', true)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(BATCH_SIZE);
      if (lastDoc) q = q.startAfter(lastDoc);

      const snap = await q.get();
      if (snap.empty) break;

      for (const campDoc of snap.docs) {
        const camp  = campDoc.data();
        const campId = campDoc.id;
        const sched  = camp.schedule;
        if (!sched?.nextRunAt) continue;

        const nextRun = sched.nextRunAt.toDate ? sched.nextRunAt.toDate() : new Date(sched.nextRunAt);
        if (nextRun > now) continue;

        const bizId    = camp.bizId  || campDoc.ref.parent.parent.id;
        const schedUid = camp.uid    || campDoc.ref.parent.parent.parent.parent.id;

        let claimed = false;
        try {
          await db.runTransaction(async (tx) => {
            const freshDoc   = await tx.get(campDoc.ref);
            const freshSched = freshDoc.data()?.schedule || {};
            if (freshSched.processing === true) {
              const claimedAt = freshSched.processingStartedAt?.toDate?.() || new Date(0);
              if ((now - claimedAt) < 10 * 60 * 1000) return;
            }
            tx.update(campDoc.ref, {
              'schedule.processing':          true,
              'schedule.processingStartedAt': admin.firestore.FieldValue.serverTimestamp(),
            });
            claimed = true;
          });
        } catch(e) {
          console.warn(`[scheduledPostingCheck] claim tx failed for camp ${campId}:`, e.message);
        }
        if (!claimed) continue;

        try {
          const bizDoc = await db.collection('users').doc(schedUid).collection('businesses').doc(bizId).get();
          const biz    = bizDoc.exists ? bizDoc.data() : {};
          await _runScheduledPost(bizId, biz, sched, campId, camp.name || '', schedUid);

          const next = _computeNextRunAt(sched, now);
          await campDoc.ref.update({
            'schedule.lastRunAt':           admin.firestore.FieldValue.serverTimestamp(),
            'schedule.nextRunAt':           admin.firestore.Timestamp.fromDate(next),
            'schedule.updatedAt':           admin.firestore.FieldValue.serverTimestamp(),
            'schedule.processing':          false,
            'schedule.processingStartedAt': null,
          });
          console.log(`[scheduledPostingCheck] camp ${campId} biz ${bizId} — next run: ${next.toISOString()}`);
        } catch(e) {
          await campDoc.ref.update({ 'schedule.processing': false, 'schedule.processingStartedAt': null }).catch(() => {});
          console.error(`[scheduledPostingCheck] camp ${campId} failed:`, e.message);
        }
      }

      if (snap.docs.length < BATCH_SIZE) break;
      lastDoc = snap.docs[snap.docs.length - 1];
    }
  }
);

// ══════════════════════════════════════════
// scheduledYelpCategoryRefresh — every Monday 3am ET
// ══════════════════════════════════════════
exports.scheduledYelpCategoryRefresh = onSchedule(
  { schedule: 'every monday 03:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['YELP_API_KEY'] },
  async () => {
    try { await fetchAndCacheYelpCategories(); }
    catch(e) { console.error('[scheduledYelpCategoryRefresh]', e.message); }
  }
);

// ══════════════════════════════════════════
// scheduledUpgradeNudge — daily at 10am ET
// ══════════════════════════════════════════
exports.scheduledUpgradeNudge = onSchedule(
  { schedule: 'every day 10:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async () => {
    const now        = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const windowStart  = new Date(sevenDaysAgo);
    windowStart.setDate(windowStart.getDate() - 1);

    let tmplSubject = null, tmplHtml = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'upgrade-nudge').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) { tmplSubject = tmplSnap.docs[0].data().subject; tmplHtml = tmplSnap.docs[0].data().html; }
    } catch(e) { console.error('[scheduledUpgradeNudge] template fetch failed:', e.message); }

    const usersSnap = await db.collection('users')
      .where('plan', '==', 'starter')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(windowStart))
      .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(sevenDaysAgo))
      .get();

    const _nudgeBizMap = {};
    await Promise.all(usersSnap.docs.map(async (userDoc) => {
      try {
        const bizSnap = await userBizCol(userDoc.id).limit(1).get();
        _nudgeBizMap[userDoc.id] = bizSnap.docs[0]?.data()?.businessName || '';
      } catch(e) { _nudgeBizMap[userDoc.id] = ''; }
    }));

    let sent = 0;
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      if (!userData.email || userData.emailUnsubscribed) continue;
      const uid          = userDoc.id;
      const ownerName    = userData.ownerName || userData.displayName || '';
      const businessName = _nudgeBizMap[uid] || '';
      const unsubUrl     = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, _unsubSecret())}`;

      const mergeData = {
        name:           ownerName || 'there',
        businessName:   businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
        upgradeUrl:     APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
        dashboardUrl:   APP_BASE_URL + '/BlastyBiz-Dashboard.html',
        appUrl:         APP_BASE_URL,
        unsubscribeUrl: unsubUrl,
      };
      function applyNudgeTags(str) { return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || ''); }

      const subject = tmplSubject
        ? applyNudgeTags(tmplSubject)
        : `${mergeData.name}, BlastyBiz is ready to blast for ${mergeData.businessName} 👀`;
      const html = tmplHtml
        ? applyNudgeTags(tmplHtml)
        : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hey ${mergeData.name} — it's been a week. Let's talk.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">You signed up 7 days ago, and <strong>${mergeData.businessName}</strong> is still on the free plan. That means you're doing the copy, the posting, the formatting — all of it by hand, for every platform, every time.</p>
    <div style="background:#f0fff4;border-left:4px solid #00C853;border-radius:0 8px 8px 0;padding:20px 24px;margin-bottom:24px">
      <ul style="color:#444;font-size:14px;line-height:2.1;padding-left:18px;margin:0">
        <li>AI-written copy adapted for every major platform automatically</li>
        <li>Auto-posting — no login, no paste, no repeat</li>
        <li>Business Library — upload once, AI uses it every time</li>
        <li>Campaign history and copy archive</li>
      </ul>
    </div>
    <a href="${mergeData.upgradeUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Go Pro — Unlock Everything &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

      try { await sendResendEmail({ to: userData.email, subject, html }); sent++; }
      catch(e) { console.error(`[scheduledUpgradeNudge] failed for ${userData.email}:`, e.message); }
    }
    console.log(`[scheduledUpgradeNudge] sent ${sent} nudge emails`);
  }
);

// ══════════════════════════════════════════
// scheduledWeeklyDigest — every Monday 8am ET
// ══════════════════════════════════════════
exports.scheduledWeeklyDigest = onSchedule(
  { schedule: 'every monday 08:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async () => {
    const now         = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    let tmplSubject = null, tmplHtml = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'weekly-digest').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) { tmplSubject = tmplSnap.docs[0].data().subject; tmplHtml = tmplSnap.docs[0].data().html; }
    } catch(e) { console.error('[scheduledWeeklyDigest] template fetch failed:', e.message); }

    const DIGEST_BATCH = 100;
    let lastDoc = null, sent = 0;

    while (true) {
      let q = db.collection('users').where('planActive', '==', true).orderBy('__name__').limit(DIGEST_BATCH);
      if (lastDoc) q = q.startAfter(lastDoc);
      const usersSnap = await q.get();
      if (usersSnap.empty) break;

      const _digestUids = usersSnap.docs.map(d => d.id);
      const [_digestBizResults, _digestJobsResults] = await Promise.all([
        Promise.all(_digestUids.map(uid => userBizCol(uid).limit(1).get().catch(() => null))),
        Promise.all(_digestUids.map(uid =>
          db.collectionGroup('publishJobs').where('uid', '==', uid).where('status', '==', 'success').get().catch(() => null)
        )),
      ]);
      const _digestBizMap  = Object.fromEntries(_digestUids.map((uid, i) => [uid, _digestBizResults[i]]));
      const _digestJobsMap = Object.fromEntries(_digestUids.map((uid, i) => [uid, _digestJobsResults[i]]));

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        if (!userData.email || userData.emailUnsubscribed) continue;
        const uid       = userDoc.id;
        const ownerName = userData.ownerName || userData.displayName || '';
        let businessName = '', bizId = null;
        const _bizSnap  = _digestBizMap[uid];
        if (_bizSnap && !_bizSnap.empty) {
          businessName = _bizSnap.docs[0].data().businessName || '';
          bizId        = _bizSnap.docs[0].id;
        }

        const sevenDaysAgoMs = sevenDaysAgo.getTime();
        const _jobsSnap      = _digestJobsMap[uid];
        const successJobs    = _jobsSnap
          ? _jobsSnap.docs.map(d => d.data()).filter(j => {
              const pub = j.publishedAt?.toDate?.() || null;
              return pub && pub.getTime() >= sevenDaysAgoMs;
            })
          : [];
        if (successJobs.length === 0) continue;

        const platformList = [...new Set(successJobs.map(j =>
          (j.platform || 'platform').replace(/\b\w/g, c => c.toUpperCase())
        ))].join(', ');
        const jobCount  = successJobs.length.toString();
        const unsubUrl  = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, _unsubSecret())}`;

        const mergeData = {
          name:           ownerName || 'there',
          businessName:   businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
          jobCount, platformList,
          dashboardUrl:   APP_BASE_URL + '/BlastyBiz-Dashboard.html',
          appUrl:         APP_BASE_URL,
          unsubscribeUrl: unsubUrl,
        };
        function applyDigestTags(str) { return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || ''); }

        const platformRows = successJobs.map(j => {
          const plat = (j.platform || 'platform').replace(/\b\w/g, c => c.toUpperCase());
          return `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333">${plat}</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#00873a;text-align:right">&#10003; Published</td></tr>`;
        }).join('');

        const subject = tmplSubject
          ? applyDigestTags(tmplSubject)
          : `${mergeData.businessName}'s BlastyBiz recap — ${jobCount} post${jobCount === '1' ? '' : 's'} this week 📊`;
        const html = tmplHtml
          ? applyDigestTags(tmplHtml)
          : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <div style="font-size:12px;font-weight:700;color:#888;letter-spacing:2px;margin-bottom:8px">WEEKLY RECAP</div>
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 8px">${mergeData.businessName}</h1>
    <p style="font-size:15px;color:#555;margin:0 0 24px">Here's what BlastyBiz published for you this week, ${mergeData.name}.</p>
    <div style="background:#f0fff4;border-radius:8px;padding:16px 20px;margin-bottom:24px;text-align:center">
      <div style="font-size:40px;font-weight:800;color:#00873a;line-height:1">${jobCount}</div>
      <div style="font-size:13px;color:#555;margin-top:4px">post${jobCount === '1' ? '' : 's'} published across ${platformList}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${platformRows}</table>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">View Full History &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

        try { await sendResendEmail({ to: userData.email, subject, html }); sent++; }
        catch(e) { console.error(`[scheduledWeeklyDigest] failed for ${userData.email}:`, e.message); }
      }

      if (usersSnap.docs.length < DIGEST_BATCH) break;
      lastDoc = usersSnap.docs[usersSnap.docs.length - 1];
    }
    console.log(`[scheduledWeeklyDigest] sent ${sent} digest emails`);
  }
);

// ══════════════════════════════════════════
// scheduledSetupNudge — daily 9am ET
// ══════════════════════════════════════════
exports.scheduledSetupNudge = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'America/New_York', region: 'us-central1', secrets: ['RESEND_API_KEY'] },
  async () => {
    let nudgesSnap;
    try {
      nudgesSnap = await db.collection('setupNudges')
        .where('sent', '==', false)
        .where('sendAfter', '<=', admin.firestore.Timestamp.now())
        .get();
    } catch(e) {
      console.warn('[scheduledSetupNudge] composite query failed, using fallback:', e.message);
      nudgesSnap = await db.collection('setupNudges')
        .where('sendAfter', '<=', admin.firestore.Timestamp.now()).get();
    }

    let sent = 0;
    for (const nudgeDoc of nudgesSnap.docs) {
      const nudgeData = nudgeDoc.data();
      if (nudgeData.sent === true) continue;
      const uid = nudgeData.uid;
      if (!uid) { await nudgeDoc.ref.delete(); continue; }

      const bizQuery = await userBizCol(uid).limit(1).get();
      if (!bizQuery.empty) { await db.collection('setupNudges').doc(uid).delete(); continue; }

      let userDoc;
      try { userDoc = await db.collection('users').doc(uid).get(); }
      catch(e) { console.error('[scheduledSetupNudge] users read failed:', e.message); continue; }

      if (!userDoc.exists)          { await db.collection('setupNudges').doc(uid).delete(); continue; }
      const userData = userDoc.data();
      if (!userData.email)               { await db.collection('setupNudges').doc(uid).delete(); continue; }
      if (userData.emailUnsubscribed)    { await db.collection('setupNudges').doc(uid).delete(); continue; }

      const ownerName = userData.ownerName || userData.displayName || '';
      const unsubUrl  = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(uid)}&sig=${makeUnsubSig(uid, _unsubSecret())}`;

      let tmplSubject = null, tmplHtml = null;
      try {
        const tmplSnap = await db.collection('emailTemplates')
          .where('type', '==', 'setup-nudge').where('active', '==', true).limit(1).get();
        if (!tmplSnap.empty) { tmplSubject = tmplSnap.docs[0].data().subject; tmplHtml = tmplSnap.docs[0].data().html; }
      } catch(e) { console.warn('[scheduledSetupNudge] template fetch failed:', e.message); }

      const mergeData = {
        name: ownerName || 'there',
        onboardingUrl:  APP_BASE_URL + '/BlastyBiz-Onboarding.html',
        appUrl:         APP_BASE_URL,
        unsubscribeUrl: unsubUrl,
      };
      function applyNudgeTags(str) { return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || ''); }

      const subject = tmplSubject
        ? applyNudgeTags(tmplSubject)
        : `${mergeData.name}, finish setting up your BlastyBiz profile`;
      const html = tmplHtml
        ? applyNudgeTags(tmplHtml)
        : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hey ${mergeData.name} — your profile is almost ready.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">You created your BlastyBiz account yesterday but haven't finished setting up your business profile yet. It only takes a few minutes — and once it's done, BlastyBiz writes the copy for every platform automatically.</p>
    <a href="${mergeData.onboardingUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Finish Setup &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

      try {
        await sendResendEmail({ to: userData.email, subject, html });
        await db.collection('setupNudges').doc(uid).update({ sent: true });
        sent++;
      } catch(e) { console.error(`[scheduledSetupNudge] failed for ${userData.email}:`, e.message); }
    }
    console.log(`[scheduledSetupNudge] sent ${sent} setup nudge emails`);
  }
);

// ══════════════════════════════════════════
// checkPlatformTokenExpiry — every 30 minutes
// ══════════════════════════════════════════
exports.checkPlatformTokenExpiry = onSchedule(
  {
    schedule: 'every 30 minutes',
    region: 'us-central1',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  },
  async () => {
    const cutoffShort = new Date(Date.now() + 5 * 60 * 1000);
    const cutoffFb    = new Date(Date.now() + 7 * 24 * 3600 * 1000);

    let tmplSubject = null, tmplHtml = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'platform-expired').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) { tmplSubject = tmplSnap.docs[0].data().subject; tmplHtml = tmplSnap.docs[0].data().html; }
    } catch(e) { console.error('[checkPlatformTokenExpiry] template fetch failed:', e.message); }

    const snap = await db.collectionGroup('platformConnections').where('status', '==', 'connected').get();
    let refreshed = 0, expired = 0, skipped = 0;
    const toNotify = [];

    for (const docSnap of snap.docs) {
      const conn = docSnap.data();
      if (!conn.expiresAt) { skipped++; continue; }

      const expiresAt = conn.expiresAt.toDate ? conn.expiresAt.toDate() : new Date(conn.expiresAt);
      const isFbOrIg  = conn.platform === 'facebook' || conn.platform === 'instagram';
      const cutoff    = isFbOrIg ? cutoffFb : cutoffShort;
      if (expiresAt > cutoff) { skipped++; continue; }

      const privTokens = await _getConnTokens(docSnap.ref);
      const igRef      = docSnap.ref.parent.parent.collection('platformConnections').doc('instagram');

      if (conn.platform === 'facebook' && privTokens.accessToken) {
        try {
          const resp = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
              grant_type: 'fb_exchange_token',
              client_id: process.env.FACEBOOK_APP_ID,
              client_secret: process.env.FACEBOOK_APP_SECRET,
              fb_exchange_token: privTokens.accessToken,
            },
          });
          const { access_token, expires_in } = resp.data;
          const newExpiresAt = new Date(Date.now() + (expires_in || 60 * 24 * 3600) * 1000);
          await _setConnTokens(docSnap.ref, { accessToken: access_token });
          await docSnap.ref.update({ expiresAt: newExpiresAt, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          console.log(`[checkPlatformTokenExpiry] Refreshed Facebook token for biz ${conn.businessId}`);
          const igSnap = await igRef.get();
          if (igSnap.exists && igSnap.data().status === 'connected') {
            await _setConnTokens(igRef, { accessToken: access_token });
            await igRef.update({ expiresAt: newExpiresAt, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          }
          refreshed++;
          continue;
        } catch(e) {
          console.warn(`[checkPlatformTokenExpiry] Facebook refresh failed for biz ${conn.businessId}:`, e.response?.data || e.message);
          try {
            const igSnap = await igRef.get();
            if (igSnap.exists && igSnap.data().status === 'connected') {
              await igRef.update({ status: 'expired', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            }
          } catch(igErr) { console.error(`[checkPlatformTokenExpiry] Failed to mark IG expired:`, igErr.message); }
        }
      }

      if (conn.platform === 'instagram') { skipped++; continue; }

      if (conn.platform === 'google' && privTokens.refreshToken) {
        try {
          const resp = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
              client_id: process.env.GOOGLE_CLIENT_ID,
              client_secret: process.env.GOOGLE_CLIENT_SECRET,
              refresh_token: privTokens.refreshToken,
              grant_type: 'refresh_token',
            },
          });
          const { access_token, expires_in } = resp.data;
          await _setConnTokens(docSnap.ref, { accessToken: access_token });
          await docSnap.ref.update({
            expiresAt: new Date(Date.now() + (expires_in || 3600) * 1000),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[checkPlatformTokenExpiry] Refreshed Google token for ${docSnap.id}`);
          refreshed++;
          continue;
        } catch(e) {
          console.warn(`[checkPlatformTokenExpiry] Google refresh failed for ${docSnap.id}:`, e.response?.data || e.message);
        }
      }

      try {
        await docSnap.ref.update({ status: 'expired', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        console.log(`[checkPlatformTokenExpiry] Marked expired: ${docSnap.id} (platform: ${conn.platform})`);
        expired++;
      } catch(e) { console.error(`[checkPlatformTokenExpiry] Failed to mark expired for ${docSnap.id}:`, e.message); continue; }

      if (conn.uid) toNotify.push({ conn, docId: docSnap.id });
    }

    if (toNotify.length > 0) {
      const _uniqueUids  = [...new Set(toNotify.map(n => n.conn.uid))];
      const _userRefs    = _uniqueUids.map(uid => db.collection('users').doc(uid));
      const _userDocs    = await db.getAll(..._userRefs);
      const _userDataMap = Object.fromEntries(_userDocs.map(d => [d.id, d.exists ? d.data() : null]));

      for (const { conn, docId } of toNotify) {
        const userData = _userDataMap[conn.uid];
        if (!userData || !userData.email || userData.emailUnsubscribed) continue;

        try {
          const ownerName = userData.ownerName || userData.displayName || '';
          let businessName = '';
          try {
            const bizSnap = await userBizRef(conn.uid, conn.businessId).get();
            businessName  = bizSnap.data()?.businessName || '';
          } catch(e) { /* non-fatal */ }

          const platformDisplay = conn.platform === 'google' ? 'Google Business Profile'
            : conn.platform.charAt(0).toUpperCase() + conn.platform.slice(1);
          const unsubUrl   = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(conn.uid)}&sig=${makeUnsubSig(conn.uid, _unsubSecret())}`;
          const connectUrl = `${APP_BASE_URL}/BlastyBiz-Connect.html`;

          const mergeData = {
            name:           ownerName || 'there',
            businessName:   businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
            platform:       platformDisplay,
            connectUrl, appUrl: APP_BASE_URL,
            unsubscribeUrl: unsubUrl,
          };
          function applyExpiredTags(str) { return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || ''); }

          const subject = tmplSubject
            ? applyExpiredTags(tmplSubject)
            : `Action needed — your ${platformDisplay} connection expired`;
          const html = tmplHtml
            ? applyExpiredTags(tmplHtml)
            : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Your ${platformDisplay} connection needs a quick reconnect, ${mergeData.name}.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">Your <strong>${platformDisplay}</strong> authorization for <strong>${mergeData.businessName}</strong> has expired. Auto-posting is paused until you reconnect.</p>
    <a href="${connectUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Reconnect ${platformDisplay} &#8594;</a>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

          await sendResendEmail({ to: userData.email, subject, html });
          console.log(`[checkPlatformTokenExpiry] Sent expiry email to ${userData.email} for ${docId}`);
        } catch(e) {
          console.error(`[checkPlatformTokenExpiry] Email failed for ${docId}:`, e.message);
        }
      }
    }

    console.log(`[checkPlatformTokenExpiry] Done — refreshed: ${refreshed}, expired: ${expired}, skipped: ${skipped}`);
  }
);

// ── cleanupAbandonedSignups — daily cron: delete users who never onboarded ────
// Removes Firebase Auth accounts and Firestore user docs for accounts that
// were created more than 30 days ago and still have onboarded: false.
// This covers users who signed up but never clicked the verification link.
exports.cleanupAbandonedSignups = onSchedule('every 24 hours', async (_event) => {
  const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  );
  let snap;
  try {
    snap = await db.collection('users')
      .where('onboarded', '==', false)
      .where('createdAt', '<=', thirtyDaysAgo)
      .get();
  } catch(e) {
    console.error('[cleanupAbandonedSignups] Firestore query failed:', e.message);
    return;
  }

  console.log('[cleanupAbandonedSignups] candidates:', snap.size);
  let deleted = 0;
  let errors  = 0;

  for (const userDoc of snap.docs) {
    const uid = userDoc.id;
    try {
      // Guard: skip users who have already created business data — they started onboarding
      // even if they never finished. Do not destroy real data; let them complete or admin-review.
      const bizSnap = await userBizCol(uid).limit(1).get();
      if (!bizSnap.empty) {
        console.log('[cleanupAbandonedSignups] Skipping uid=' + uid + ' — has business data');
        continue;
      }

      // Delete Firebase Auth account (non-fatal if not found)
      try {
        await admin.auth().deleteUser(uid);
      } catch(authErr) {
        if (authErr.code !== 'auth/user-not-found') {
          console.warn('[cleanupAbandonedSignups] Auth delete failed uid=' + uid, authErr.code);
        }
      }
      // Delete Firestore user doc (onboardingProgress field lives here too)
      await userDoc.ref.delete();
      deleted++;
    } catch(e) {
      console.error('[cleanupAbandonedSignups] Failed uid=' + uid, e.message);
      errors++;
    }
  }

  console.log('[cleanupAbandonedSignups] done — deleted=' + deleted + ' errors=' + errors);
});

// ── scheduledFirestoreExport — weekly Firestore backup to GCS ────────────────
// Triggers every Sunday at 02:00 America/Los_Angeles.
//
// ⚠ REQUIRED OPS STEPS (one-time, console/CLI):
//   1. Create bucket:  gsutil mb -l us-east1 gs://blastybiz-9523e-backups
//   2. Grant export role to the Firebase service account:
//      gcloud projects add-iam-policy-binding blastybiz-9523e \
//        --member="serviceAccount:firebase-adminsdk-1p8t7@blastybiz-9523e.iam.gserviceaccount.com" \
//        --role="roles/datastore.importExportAdmin"
//      gcloud storage buckets add-iam-policy-binding gs://blastybiz-9523e-backups \
//        --member="serviceAccount:firebase-adminsdk-1p8t7@blastybiz-9523e.iam.gserviceaccount.com" \
//        --role="roles/storage.admin"
//   3. Enable Firestore PITR (7-day window) in Firebase Console → Firestore → Settings.
//   4. Perform one restore into a dev project and record the duration (your RTO answer).
exports.scheduledFirestoreExport = onSchedule({
  schedule: 'every sunday 02:00',
  timeZone: 'America/Los_Angeles',
  region: 'us-central1',
}, async () => {
  const projectId = 'blastybiz-9523e';
  const bucket    = `gs://${projectId}-backups`;
  try {
    // Obtain an access token from the GCE metadata server (available in all CFs)
    const tokenResp = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } }
    );
    if (!tokenResp.ok) throw new Error(`Metadata token fetch failed: ${tokenResp.status}`);
    const { access_token } = await tokenResp.json();

    const timestamp       = new Date().toISOString().replace(/[:.]/g, '-');
    const outputUriPrefix = `${bucket}/firestore/${timestamp}`;

    const exportResp = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputUriPrefix }),
      }
    );
    if (!exportResp.ok) {
      const body = await exportResp.text();
      throw new Error(`Export API ${exportResp.status}: ${body.slice(0, 300)}`);
    }
    const op = await exportResp.json();
    bbLog('INFO', 'scheduledFirestoreExport', { event: 'export_started', operation: op.name, outputUriPrefix });
  } catch(e) {
    bbLog('ERROR', 'scheduledFirestoreExport', { event: 'export_failed', msg: e.message });
    throw e; // rethrow so Cloud Scheduler marks it failed
  }
});
