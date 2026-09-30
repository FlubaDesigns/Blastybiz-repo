/**
 * BlastyBiz — Payment endpoints
 * createCheckoutSession, createPortalSession, squareWebhook, adminUpdatePricing
 */
'use strict';

const {
  onRequest, admin, db, crypto,
  APP_BASE_URL, sendResendEmail, getSquare,
  userBizCol, checkUidRateLimit, withAuth, getPlanConfig,
  AUTO_POST_PLATFORMS,
} = require('../lib/shared');

// ── Pricing ───────────────────────────────────────────────────────────────────
// settings/pricing is the source of truth for what the owner is actually charged
// (adminUpdatePricing writes it alongside the Square catalog plan ids). Both the
// checkout endpoint and the plan-comparison endpoint read through this helper so
// the price shown on the plan step can never drift from the price charged.
const PRICING_DEFAULTS = { proMonthly: 19, agencyMonthly: 99, proAnnual: 199, agencyAnnual: 999 };

async function loadPricing() {
  const out = { ...PRICING_DEFAULTS, planIds: { pro: {}, agency: {} } };
  try {
    const snap = await db.collection('settings').doc('pricing').get();
    if (snap.exists) {
      const d = snap.data();
      if (d.proMonthly)    out.proMonthly    = d.proMonthly;
      if (d.agencyMonthly) out.agencyMonthly = d.agencyMonthly;
      if (d.proAnnual)     out.proAnnual     = d.proAnnual;
      if (d.agencyAnnual)  out.agencyAnnual  = d.agencyAnnual;
      out.planIds.pro.monthly    = d.squareProMonthlyPlanId;
      out.planIds.pro.annual     = d.squareProAnnualPlanId;
      out.planIds.agency.monthly = d.squareAgencyMonthlyPlanId;
      out.planIds.agency.annual  = d.squareAgencyAnnualPlanId;
    }
  } catch (e) {
    console.warn('[loadPricing] Firestore pricing read failed, using defaults:', e.message);
  }
  return out;
}

// ── Checkout return path ──────────────────────────────────────────────────────
// The plan step and the publish page each want the owner dropped back where they
// left off rather than on the dashboard. Square redirects to whatever absolute
// URL we hand it, so the caller-supplied path is validated against an allowlist
// shape before it's appended to APP_BASE_URL — an unvalidated value here is an
// open redirect out of the app.
const RETURN_PATH_RE = /^\/BlastyBiz[A-Za-z0-9._-]*\.html(\?[A-Za-z0-9=&_%.~-]{0,240})?$/;

function safeReturnPath(p) {
  if (typeof p !== 'string' || !p || p.length > 300) return null;
  if (p.includes('//') || p.includes('\\') || p.includes('..')) return null;
  // %2F is a slash Square might normalise before following the redirect. The
  // path segment is allowlisted so the origin can't move either way, but there
  // is no legitimate reason for an encoded slash in one of our return paths.
  if (/%2f/i.test(p)) return null;
  return RETURN_PATH_RE.test(p) ? p : null;
}

// ── getPlanOptions — what the in-app plan step renders ────────────────────────
// Prices come from settings/pricing and the AI / business caps come from
// getPlanConfig(), the same call reserveAiAction() enforces against. Nothing
// about plan entitlements is hardcoded in the page.
exports.getPlanOptions = onRequest({ invoker: 'public', region: 'us-central1' }, withAuth(async (req, res) => {
  const [pricing, planCfg] = await Promise.all([loadPricing(), getPlanConfig()]);
  res.json({
    prices: {
      proMonthly:    pricing.proMonthly,
      proAnnual:     pricing.proAnnual,
      agencyMonthly: pricing.agencyMonthly,
      agencyAnnual:  pricing.agencyAnnual,
    },
    aiLimits:  planCfg.aiLimits,
    bizLimits: planCfg.bizLimits,
    // The plan step sells auto-posting, so it must promise exactly what
    // approveDraft will do — not what client-side platform metadata (which an
    // admin can override in config/platforms) happens to say.
    autoPlatforms: AUTO_POST_PLATFORMS,
    // Free-account retention window, so the Account page can tell an owner how
    // long we keep their data without hardcoding a number that could drift from
    // the config (and from the privacy policy).
    retention: {
      dormantDays: planCfg.retention.dormantDays,
      warningDays: planCfg.retention.warningDays,
    },
    // Which checkout buttons can actually complete — a plan whose Square
    // catalog id is missing would 503 on click, so the page hides it instead.
    checkoutReady: {
      pro:    { monthly: !!pricing.planIds.pro.monthly,    annual: !!pricing.planIds.pro.annual },
      agency: { monthly: !!pricing.planIds.agency.monthly, annual: !!pricing.planIds.agency.annual },
    },
  });
}));

function paidPeriodEnded(subscription,now=new Date()) {
  if(!['CANCELED','DEACTIVATED'].includes(String(subscription?.status||'').toUpperCase()))return false;
  const end=subscription.chargedThroughDate||subscription.charged_through_date;
  if(typeof end!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(Date.parse(end))||new Date(end).toISOString().slice(0,10)!==end)return false;
  // charged_through_date is a calendar date in the subscription's timezone.
  // Permit checkout only on a later day; never overlap an invoiced period.
  try {
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:subscription.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const value=k=>parts.find(p=>p.type===k).value;
    return end<`${value('year')}-${value('month')}-${value('day')}`;
  }catch(_){return false;}
}

exports.createCheckoutSession = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID'] }, withAuth(async (req, res, decoded) => {
  const uid   = decoded.uid;
  const email = decoded.email || req.body.email || '';
  const { plan, billingPeriod: rawPeriod } = req.body;
  const billingPeriod = rawPeriod === 'annual' ? 'annual' : 'monthly';

  if (!(await checkUidRateLimit('checkoutRateLimit', uid, 10, 60 * 60 * 1000))) {
    return res.status(429).json({ error: 'Too many checkout attempts. Please try again in an hour.' });
  }

  if (!['pro', 'agency'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' });

  const existingSubscription=(await db.collection('subscriptions').doc(uid).get()).data();
  if(existingSubscription?.squareSubscriptionId){
    let mayRestart=false;
    if(['CANCELED','DEACTIVATED'].includes(String(existingSubscription.status||'').toUpperCase())){
      try {
        const current=await getSquare().subscriptions.get({subscriptionId:existingSubscription.squareSubscriptionId});
        mayRestart=!current.errors?.length&&current.subscription?.id===existingSubscription.squareSubscriptionId&&paidPeriodEnded(current.subscription);
      }catch(_){return res.status(503).json({error:'We could not confirm your subscription status. Please try again or contact support@blastybiz.com.'});}
    }
    if(!mayRestart)return res.status(409).json({error:'To change your plan or billing period, contact support@blastybiz.com.',code:'EXISTING_SUBSCRIPTION'});
  }

  const pricing = await loadPricing();
  const subscriptionPlanId = pricing.planIds[plan][billingPeriod];
  if (!subscriptionPlanId) {
    return res.status(503).json({ error: 'Subscription plans not yet configured. Run adminUpdatePricing first.' });
  }

  const returnPath = safeReturnPath(req.body.returnPath) || '/BlastyBiz-Dashboard.html?success=1';

  const idempotencyKey = `checkout-${uid}-${plan}-${billingPeriod}-${Math.floor(Date.now() / 3600000)}`;

  const response = await getSquare().checkout.paymentLinks.create({
    idempotencyKey,
    checkoutOptions: {
      redirectUrl: `${APP_BASE_URL}${returnPath}`,
      merchantSupportEmail: 'info@blastybiz.com',
      subscriptionPlanId,
    },
    prePopulatedData: { buyerEmail: email },
  });

  const orderId = response.paymentLink?.orderId;
  if (orderId) {
    const checkoutRef=db.collection('pendingCheckouts').doc(orderId);
    await db.runTransaction(async tx=>{
      const existing=await tx.get(checkoutRef);
      if(existing.exists) {
        if(existing.data().uid!==uid || existing.data().plan!==plan)throw Error('Checkout linkage mismatch');
        return; // Reopening the same Square link must retain its fulfillment receipt.
      }
      tx.create(checkoutRef,{
        uid, plan, billingPeriod, subscriptionPlanId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 48 * 60 * 60 * 1000),
      });
    });
  }
  res.json({ url: response.paymentLink.url });
}));

exports.createPortalSession = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  const uid = decoded.uid;
  const subSnap = await db.collection('subscriptions').doc(uid).get();
  if (!subSnap.exists) return res.json({ hasSubscription: false, url: null });
  res.json({ hasSubscription: true, url: 'mailto:info@blastybiz.com?subject=Manage%20BlastyBiz%20Subscription' });
}));

// Complete the event and its account effects in the same transaction. Customer
// linkage and subscription snapshots live in the existing webhook ledger so
// either event arrival order can recover without a second billing system.
async function applySquareEvent(event) {
  const eventId=event.event_id;
  if(typeof eventId!=='string'||!eventId||eventId.includes('/'))throw Error('Missing webhook event ID');
  const events=db.collection('webhookEvents'),eventRef=events.doc(eventId);
  const payment=event.data?.object?.payment,sub=event.data?.object?.subscription;
  const customerId=payment?.customer_id || payment?.customerId || sub?.customer_id || sub?.customerId || '';
  const customerRef=customerId ? events.doc('customer_'+crypto.createHash('sha256').update(customerId).digest('hex')) : null;
  return db.runTransaction(async tx=>{
    const received=await tx.get(eventRef);
    if(received.exists && ['completed','needs_review'].includes(received.data().status))return null;
    const customer=customerRef ? await tx.get(customerRef) : null;
    const stamp=admin.firestore.FieldValue.serverTimestamp();
    const done=()=>tx.set(eventRef,{type:event.type,status:'completed',completedAt:stamp},{merge:true});
    if(event.type==='payment.updated' && payment?.status==='COMPLETED') {
      const orderId=payment.order_id || payment.orderId;
      if(!orderId){done();return null;}
      const checkoutRef=db.collection('pendingCheckouts').doc(orderId),checkout=await tx.get(checkoutRef);
      if(!checkout.exists) {
        const createdMs=Date.parse(event.created_at);
        if(Number.isFinite(createdMs) && Date.now()-createdMs<24*60*60*1000)throw Error('Checkout linkage not available yet');
        const validTime=Number.isFinite(createdMs);
        const record={type:event.type,status:validTime?'completed':'needs_review',unlinked:true,
          reason:validTime?'checkout_missing':'invalid_event_timestamp',orderId,paymentId:payment.id || '',customerId,
          eventCreatedAt:event.created_at || '',...(validTime?{completedAt:stamp}:{receivedAt:stamp})};
        tx.set(eventRef,record,{merge:true});
        return {kind:'reconciliation_required',eventId,...record};
      }
      const pending=checkout.data();
      if(pending.fulfilledPaymentId){done();return null;}
      const {uid,plan}=pending;
      if(!uid || !['pro','agency'].includes(plan))throw Error('Invalid checkout linkage');
      if(customer?.data()?.uid && customer.data().uid!==uid) {
        const record={type:event.type,status:'needs_review',reason:'customer_account_mismatch',
          uid,linkedUid:customer.data().uid,orderId,paymentId:payment.id || '',customerId,
          eventCreatedAt:event.created_at || '',receivedAt:stamp};
        tx.set(eventRef,record,{merge:true});
        return {kind:'reconciliation_required',eventId,...record};
      }
      const subscriptionRef=db.collection('subscriptions').doc(uid);
      const current=await tx.get(subscriptionRef),user=await tx.get(db.collection('users').doc(uid));
      const businesses=await tx.get(userBizCol(uid));
      const records=customerId ? await tx.get(events.where('customerId','==',customerId)) : {docs:[]};
      const started=pending.createdAt?.toMillis?.() || 0;
      const candidates=records.docs.map(d=>d.data()).filter(d=>d.recordType==='subscription' &&
        (!started || new Date(d.createdAt).getTime()>=started) &&
        (!pending.subscriptionPlanId || d.planVariationId===pending.subscriptionPlanId || d.planId===pending.subscriptionPlanId));
      candidates.sort((a,b)=>String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      const linked=candidates[0] || null;
      const canceled=linked && ['CANCELED','DEACTIVATED'].includes(linked.status);
      if(!user.exists)throw Error('Checkout account not found');
      const old=current.exists?current.data():{};
      // A delayed old checkout must not replace a newer paid subscription.
      const checkoutMs=pending.createdAt?.toMillis?.() || 0;
      const currentMs=old.checkoutCreatedAt?.toMillis?.() || 0;
      if(checkoutMs && currentMs && checkoutMs<currentMs){tx.update(checkoutRef,{fulfilledPaymentId:payment.id,fulfilledAt:stamp});done();return null;}
      const activePlan=canceled?'starter':plan,billingPeriod=pending.billingPeriod || 'monthly';
      tx.set(db.collection('users').doc(uid),{plan:activePlan,planActive:!canceled,billingPeriod},{merge:true});
      for(const biz of businesses.docs)tx.update(biz.ref,{currentPlan:activePlan,subscriptionStatus:canceled?'canceled':'active'});
      tx.set(subscriptionRef,{
        uid,squareCustomerId:customerId,squarePaymentId:payment.id,plan,billingPeriod,status:canceled?'canceled':'active',
        squareCheckoutPlanId:pending.subscriptionPlanId || '',
        squareSubscriptionId:linked?.subscriptionId || '',squareSubscriptionCreatedAt:linked?.createdAt || '',
        checkoutCreatedAt:pending.createdAt || stamp,updatedAt:stamp,
      },{merge:true});
      tx.update(checkoutRef,{fulfilledPaymentId:payment.id,fulfilledAt:stamp});
      if(customerRef)tx.set(customerRef,{recordType:'customer',uid,updatedAt:stamp},{merge:true});
      done();
      return canceled?null:{kind:'paid',uid,plan,billingPeriod,bizSnaps:businesses,payment};
    }
    if(['subscription.created','subscription.updated'].includes(event.type) && sub?.id && customerRef) {
      const summaryRef=events.doc('subscription_'+crypto.createHash('sha256').update(sub.id).digest('hex'));
      const prior=await tx.get(summaryRef),previous=prior.exists?prior.data():{};
      const version=Number(sub.version || 0);
      if(previous.version && version && version<previous.version){done();return null;}
      if(!version && previous.eventAt && event.created_at && event.created_at<previous.eventAt){done();return null;}
      const record={recordType:'subscription',customerId,subscriptionId:sub.id,version,
        status:String(sub.status || previous.status || '').toUpperCase(),
        planVariationId:sub.plan_variation_id || sub.planVariationId || previous.planVariationId || '',
        planId:sub.plan_id || sub.planId || previous.planId || '',
        createdAt:sub.created_at || previous.createdAt || event.created_at || '',eventAt:event.created_at || '',updatedAt:stamp};
      let uid=customer?.data()?.uid;
      if(!uid){const matches=await tx.get(db.collection('subscriptions').where('squareCustomerId','==',customerId).limit(2));if(matches.docs.length===1)uid=matches.docs[0].data().uid || matches.docs[0].id;}
      const subscriptionRef=uid?db.collection('subscriptions').doc(uid):null;
      const linked=subscriptionRef?await tx.get(subscriptionRef):null;
      const account=uid?await tx.get(db.collection('users').doc(uid)):null;
      const current=linked?.exists?linked.data():{};
      const canceled=['CANCELED','DEACTIVATED'].includes(record.status);
      const same=current.squareSubscriptionId===sub.id;
      const planMatches=!current.squareCheckoutPlanId || [record.planId,record.planVariationId].includes(current.squareCheckoutPlanId);
      const checkoutStart=current.checkoutCreatedAt?.toMillis?.() || 0;
      const belongsToCheckout=!checkoutStart || new Date(record.createdAt).getTime()>=checkoutStart;
      const mayLink=!!linked?.exists && planMatches && belongsToCheckout && (!current.squareSubscriptionId ||
        (!canceled && event.type==='subscription.created' && record.createdAt && record.createdAt>(current.squareSubscriptionCreatedAt || '')));
      const revoke=!!linked?.exists && canceled && (same || (!current.squareSubscriptionId && mayLink));
      const businesses=revoke?await tx.get(userBizCol(uid)):null;
      // No writes occur before all reads above, including the legacy linkage query.
      tx.set(summaryRef,record,{merge:true});
      tx.set(customerRef,{recordType:'customer',...(uid?{uid}:{}),updatedAt:stamp},{merge:true});
      if(subscriptionRef && (same || mayLink))tx.set(subscriptionRef,{squareSubscriptionId:sub.id,squareSubscriptionCreatedAt:record.createdAt,updatedAt:stamp},{merge:true});
      if(revoke) {
        tx.set(db.collection('users').doc(uid),{plan:'starter',planActive:false},{merge:true});
        tx.update(subscriptionRef,{status:'canceled',updatedAt:stamp});
        for(const biz of businesses.docs)tx.update(biz.ref,{currentPlan:'starter',subscriptionStatus:'canceled'});
      }
      done();
      return revoke?{kind:'canceled',uid,bizSnaps:businesses,priorPlanName:account?.data()?.plan==='agency'?'Agency':'Pro'}:null;
    }
    done();
    return event.type==='payment.updated' && payment?.status==='FAILED'?{kind:'failed',payment}:null;
  });
}

exports.squareWebhook = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_WEBHOOK_SIGNATURE_KEY', 'RESEND_API_KEY'] }, async (req, res) => {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/squareWebhook';
  const body = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', signatureKey);
  hmac.update(notificationUrl + body);
  const expected = hmac.digest('base64');
  const incoming = req.headers['x-square-hmacsha256-signature'] || '';
  try {
    const expBuf = Buffer.from(expected);
    const incBuf = Buffer.from(incoming);
    if (expBuf.length !== incBuf.length || !crypto.timingSafeEqual(expBuf, incBuf)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }
  } catch { return res.status(403).json({ error: 'Invalid signature' }); }

  let effect;
  try { effect = await applySquareEvent(req.body || {}); }
  catch(e) { console.error('[squareWebhook] durable update failed:',e.message);return res.status(503).json({error:'Payment update not committed; retry required.'}); }
  if(effect?.kind==='reconciliation_required') {
    console.error('[squareWebhook] payment requires reconciliation:', {
      eventId:effect.eventId,status:effect.status,reason:effect.reason,orderId:effect.orderId,
      paymentId:effect.paymentId,customerId:effect.customerId,...(effect.uid?{uid:effect.uid,linkedUid:effect.linkedUid}:{})
    });
  }
  if(effect?.kind==='paid') {
    const {uid,plan,billingPeriod,bizSnaps,payment}=effect;
      try {
        const userSnap = await db.collection('users').doc(uid).get();
        const userData = userSnap.data() || {};
        const toEmail = userData.email;
        const ownerName = userData.ownerName || userData.displayName || '';
        const businessName = (bizSnaps.docs[0]?.data()?.businessName) || (ownerName ? ownerName + '\'s Business' : 'your business');
        const planName = plan === 'agency' ? 'Agency' : 'Pro';

        if (toEmail) {
          const mergeData = {
            name: ownerName || 'there',
            businessName,
            planName,
            dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
            appUrl: APP_BASE_URL,
          };
          function applyPaidTags(str) {
            return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
          }

          let paidSubject = 'Welcome aboard, ' + mergeData.name + ' — you\'re now BlastyBiz ' + planName + '! 🎉';
          let paidHtml = null;
          try {
            const tmplSnap = await db.collection('emailTemplates')
              .where('type', '==', 'paid-welcome')
              .where('active', '==', true)
              .limit(1)
              .get();
            if (!tmplSnap.empty) {
              const tmpl = tmplSnap.docs[0].data();
              paidSubject = applyPaidTags(tmpl.subject || paidSubject);
              paidHtml = applyPaidTags(tmpl.html || '');
            }
          } catch(e) {
            console.error('[squareWebhook] paid-welcome template fetch failed:', e.message);
          }

          if (!paidHtml) {
            paidHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
              <div style="background:#0d1a0d;padding:28px 32px">
                <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
                <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
              </div>
              <div style="padding:32px">
                <h1 style="font-size:22px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Welcome aboard, ${mergeData.name}. You&#39;re ${planName}. &#127881;</h1>
                <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 20px">Your payment went through and <strong>${mergeData.businessName}</strong> is now on BlastyBiz ${planName}. Everything unlocked. Let&#39;s get blasting.</p>
                <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Go to Dashboard &#8594;</a>
              </div>
              <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
                <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
              </div>
            </div>`;
          }

          await sendResendEmail({ to: toEmail, subject: paidSubject, html: paidHtml });
        }
      } catch(e) {
        console.error('[squareWebhook] paid-welcome email failed:', e.message);
      }

      try {
        const paidUserSnap = await db.collection('users').doc(uid).get();
        const paidUserData = paidUserSnap.data() || {};
        const paidEmail = paidUserData.email || uid;
        const paidName = paidUserData.ownerName || paidUserData.displayName || 'Unknown';
        const paidBizSnap = await userBizCol(uid).limit(1).get();
        const paidBiz = paidBizSnap.docs[0]?.data()?.businessName || '—';
        await sendResendEmail({
          to: 'info@blastybiz.com',
          subject: `[BlastyBiz] 💰 New paying customer: ${paidName} (${plan})`,
          html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
  <h2 style="margin:0 0 12px;font-size:18px">&#128176; New paying customer!</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#888;width:140px">Plan</td><td style="padding:6px 0;font-weight:700;color:#00873a;text-transform:uppercase">${plan}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Name</td><td style="padding:6px 0;font-weight:600">${paidName}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0">${paidEmail}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Business</td><td style="padding:6px 0">${paidBiz}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Payment ID</td><td style="padding:6px 0;font-size:12px;color:#888">${payment.id || '—'}</td></tr>
    <tr><td style="padding:6px 0;color:#888">Time</td><td style="padding:6px 0">${new Date().toUTCString()}</td></tr>
  </table>
</div>`,
        });
      } catch(e) { console.warn('[squareWebhook] admin new-paying alert failed:', e.message); }
  }
  if(effect?.kind==='canceled') {
    const {uid,bizSnaps,priorPlanName}=effect;
              try {
                const userSnap = await db.collection('users').doc(uid).get();
                const userData = userSnap.data() || {};
                const toEmail = userData.email;
                const ownerName = userData.ownerName || userData.displayName || '';
                const businessName = (bizSnaps.docs[0]?.data()?.businessName) || (ownerName ? ownerName + '\'s Business' : 'your business');
                if (toEmail) {
                  const mergeData = {
                    name: ownerName || 'there',
                    businessName,
                    planName: priorPlanName,
                    upgradeUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
                    dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
                    appUrl: APP_BASE_URL,
                  };
                  function applyCancelTags(str) {
                    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
                  }
                  let cancelSubject = `Your BlastyBiz subscription has ended, ${mergeData.name}`;
                  let cancelHtml = null;
                  try {
                    const tmplSnap = await db.collection('emailTemplates')
                      .where('type', '==', 'cancellation').where('active', '==', true).limit(1).get();
                    if (!tmplSnap.empty) {
                      const tmpl = tmplSnap.docs[0].data();
                      cancelSubject = applyCancelTags(tmpl.subject || cancelSubject);
                      cancelHtml = applyCancelTags(tmpl.html || '');
                    }
                  } catch(e) { console.error('[squareWebhook] cancellation template fetch failed:', e.message); }

                  if (!cancelHtml) {
                    cancelHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">You're on the free plan now, ${mergeData.name}.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">Your BlastyBiz ${mergeData.planName} subscription for <strong>${mergeData.businessName}</strong> has ended. We've moved you to the free plan — your account and all your data are still here.</p>
    <div style="background:#f7f7f7;border-radius:8px;padding:20px 24px;margin-bottom:24px">
      <div style="font-size:12px;font-weight:800;color:#888;letter-spacing:2px;margin-bottom:10px">WHAT YOU'VE LOST ACCESS TO</div>
      <ul style="color:#555;font-size:14px;line-height:2;padding-left:18px;margin:0">
        <li>Auto-posting to every major platform</li>
        <li>Business Library AI context</li>
        <li>Priority queue &amp; posting history</li>
      </ul>
    </div>
    <a href="${mergeData.upgradeUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Come Back to ${mergeData.planName} &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Changed your mind? Upgrade anytime — everything picks up right where you left off.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
                  }
                  await sendResendEmail({ to: toEmail, subject: cancelSubject, html: cancelHtml });
                }
              } catch(e) { console.error('[squareWebhook] cancellation email failed:', e.message); }
  }
  if (effect?.kind === 'failed') {
    const payment = effect.payment;
    if (payment) {
      try {
        const customerId = payment.customer_id || payment.customerId;
        let uid, ownerName, businessName, toEmail;
        if (customerId) {
          const snap = await db.collection('subscriptions').where('squareCustomerId', '==', customerId).limit(1).get();
          if (!snap.empty) uid = snap.docs[0].data().uid;
        }
        if (!uid && (payment.order_id || payment.orderId)) {
          const pendingSnap = await db.collection('pendingCheckouts').doc(payment.order_id || payment.orderId).get();
          if (pendingSnap.exists) uid = pendingSnap.data().uid;
        }
        if (uid) {
          const userSnap = await db.collection('users').doc(uid).get();
          const userData = userSnap.data() || {};
          toEmail = userData.email;
          ownerName = userData.ownerName || userData.displayName || '';
          const bizSnap = await userBizCol(uid).limit(1).get();
          businessName = bizSnap.docs[0]?.data()?.businessName || (ownerName ? ownerName + '\'s Business' : 'your business');
        }
        if (toEmail) {
          const mergeData = {
            name: ownerName || 'there',
            businessName: businessName || 'your business',
            dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
            upgradeUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
            appUrl: APP_BASE_URL,
          };
          function applyPaymentFailedTags(str) {
            return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
          }
          let pfSubject = `Action needed, ${mergeData.name} — your BlastyBiz payment didn't go through`;
          let pfHtml = null;
          try {
            const tmplSnap = await db.collection('emailTemplates')
              .where('type', '==', 'payment-failed').where('active', '==', true).limit(1).get();
            if (!tmplSnap.empty) {
              const tmpl = tmplSnap.docs[0].data();
              pfSubject = applyPaymentFailedTags(tmpl.subject || pfSubject);
              pfHtml = applyPaymentFailedTags(tmpl.html || '');
            }
          } catch(e) { console.error('[squareWebhook] payment-failed template fetch failed:', e.message); }

          if (!pfHtml) {
            pfHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Hi ${mergeData.name} — your payment didn't go through.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">We weren't able to process your BlastyBiz subscription payment for <strong>${mergeData.businessName}</strong>. This can happen when a card expires or a bank blocks a recurring charge.</p>
    <div style="background:#fff3cd;border-left:4px solid #ffc107;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:13px;font-weight:700;color:#856404;margin-bottom:4px">&#9888; Your account may be paused</div>
      <div style="font-size:14px;color:#6b5300">Update your payment method to keep your Pro features active and avoid interruption.</div>
    </div>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Update Payment Method &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Questions? Reply to this email — a real person reads every reply. We want to keep <strong>${mergeData.businessName}</strong> on BlastyBiz Pro.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz &#183; <a href="${mergeData.appUrl}" style="color:#999">blastybiz.com</a></p>
  </div>
</div>`;
          }
          await sendResendEmail({ to: toEmail, subject: pfSubject, html: pfHtml });
        }
      } catch(e) { console.error('[squareWebhook] payment.failed handler error:', e.message); }
    }
  }

  res.json({ received: true });
});

exports.adminUpdatePricing = onRequest({ invoker: 'public', secrets: ['SQUARE_ACCESS_TOKEN'] }, withAuth(async (req, res, decoded) => {
  const { proMonthly, agencyMonthly, proAnnual, agencyAnnual } = req.body;
  if (!proMonthly || !agencyMonthly) return res.status(400).json({ error: 'proMonthly and agencyMonthly required' });
  const pro          = parseFloat(proMonthly);
  const agency       = parseFloat(agencyMonthly);
  const proAnn       = proAnnual    ? parseFloat(proAnnual)    : 199;
  const agencyAnn    = agencyAnnual ? parseFloat(agencyAnnual) : 999;
  if ([pro, agency, proAnn, agencyAnn].some(v => !Number.isFinite(v) || v <= 0)) return res.status(400).json({ error: 'Invalid prices' });

  const catalog = getSquare().catalog;
  const ts = Date.now();

  let squareProMonthlyPlanId, squareProAnnualPlanId;
  let squareAgencyMonthlyPlanId, squareAgencyAnnualPlanId;
  let squareError;
  try {
    const [proMonResult, proAnnResult, agencyMonResult, agencyAnnResult] = await Promise.all([
      catalog.object.upsert({
        idempotencyKey: `bb-pro-monthly-${ts}`,
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: '#pro_monthly_plan',
          subscriptionPlanData: {
            name: `BlastyBiz Pro — $${pro}/mo`,
            phases: [{
              cadence: 'MONTHLY',
              recurringPriceMoney: { amount: BigInt(Math.round(pro * 100)), currency: 'USD' },
              ordinal: BigInt(0),
            }],
          },
        },
      }),
      catalog.object.upsert({
        idempotencyKey: `bb-pro-annual-${ts}`,
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: '#pro_annual_plan',
          subscriptionPlanData: {
            name: `BlastyBiz Pro — $${proAnn}/yr`,
            phases: [{
              cadence: 'ANNUAL',
              recurringPriceMoney: { amount: BigInt(Math.round(proAnn * 100)), currency: 'USD' },
              ordinal: BigInt(0),
            }],
          },
        },
      }),
      catalog.object.upsert({
        idempotencyKey: `bb-agency-monthly-${ts}`,
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: '#agency_monthly_plan',
          subscriptionPlanData: {
            name: `BlastyBiz Agency — $${agency}/mo`,
            phases: [{
              cadence: 'MONTHLY',
              recurringPriceMoney: { amount: BigInt(Math.round(agency * 100)), currency: 'USD' },
              ordinal: BigInt(0),
            }],
          },
        },
      }),
      catalog.object.upsert({
        idempotencyKey: `bb-agency-annual-${ts}`,
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: '#agency_annual_plan',
          subscriptionPlanData: {
            name: `BlastyBiz Agency — $${agencyAnn}/yr`,
            phases: [{
              cadence: 'ANNUAL',
              recurringPriceMoney: { amount: BigInt(Math.round(agencyAnn * 100)), currency: 'USD' },
              ordinal: BigInt(0),
            }],
          },
        },
      }),
    ]);
    squareProMonthlyPlanId    = proMonResult.catalogObject?.id;
    squareProAnnualPlanId     = proAnnResult.catalogObject?.id;
    squareAgencyMonthlyPlanId = agencyMonResult.catalogObject?.id;
    squareAgencyAnnualPlanId  = agencyAnnResult.catalogObject?.id;
    if([proMonResult,proAnnResult,agencyMonResult,agencyAnnResult].some(r=>r.errors?.length||!r.catalogObject?.id))throw Error('Square did not return all four valid plan IDs');
  } catch (e) {
    squareError = e.message || String(e);
    console.error('[adminUpdatePricing] Square plan creation failed:', squareError);
    return res.status(502).json({ok:false,error:'Square pricing update failed. Existing prices and checkout plans were preserved.'});
  }

  const update = {
    proMonthly: pro,
    agencyMonthly: agency,
    proAnnual: proAnn,
    agencyAnnual: agencyAnn,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (squareProMonthlyPlanId)    update.squareProMonthlyPlanId    = squareProMonthlyPlanId;
  if (squareProAnnualPlanId)     update.squareProAnnualPlanId     = squareProAnnualPlanId;
  if (squareAgencyMonthlyPlanId) update.squareAgencyMonthlyPlanId = squareAgencyMonthlyPlanId;
  if (squareAgencyAnnualPlanId)  update.squareAgencyAnnualPlanId  = squareAgencyAnnualPlanId;
  await db.collection('settings').doc('pricing').set(update, { merge: true });

  res.json({
    ok: true,
    proMonthly: pro, proAnnual: proAnn,
    agencyMonthly: agency, agencyAnnual: agencyAnn,
    squareProMonthlyPlanId:    squareProMonthlyPlanId    || null,
    squareProAnnualPlanId:     squareProAnnualPlanId     || null,
    squareAgencyMonthlyPlanId: squareAgencyMonthlyPlanId || null,
    squareAgencyAnnualPlanId:  squareAgencyAnnualPlanId  || null,
    squareError: squareError || null,
  });
}, { admin: true }));
