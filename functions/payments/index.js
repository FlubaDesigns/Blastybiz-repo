'use strict';
const crypto = require('crypto');
const { onRequest } = require('firebase-functions/v2/https');

const { db, admin, userBizCol } = require('../lib/db');
const { setCors, withAuth }     = require('../lib/auth');
const { getSquare }             = require('../lib/square');
const { sendResendEmail }       = require('../lib/email');
const { APP_BASE_URL }          = require('../lib/config');
const { checkUidRateLimit }     = require('../lib/rateLimit');

// ══════════════════════════════════════════
// createCheckoutSession
// POST /createCheckoutSession
// ══════════════════════════════════════════
exports.createCheckoutSession = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID'] }, withAuth(async (req, res, decoded) => {
  const uid   = decoded.uid;
  const email = decoded.email || req.body.email || '';
  const { plan, billingPeriod: rawPeriod } = req.body;
  const billingPeriod = rawPeriod === 'annual' ? 'annual' : 'monthly';

  // Rate limit: 10 checkout attempts per user per hour
  if (!(await checkUidRateLimit('checkoutRateLimit', uid, 10, 60 * 60 * 1000))) {
    return res.status(429).json({ error: 'Too many checkout attempts. Please try again in an hour.' });
  }

  // Read prices + Square plan IDs from Firestore (written by adminUpdatePricing)
  let proMonthly = 19, agencyMonthly = 99;
  let proAnnual  = 199, agencyAnnual  = 999;
  let squareProMonthlyPlanId, squareProAnnualPlanId;
  let squareAgencyMonthlyPlanId, squareAgencyAnnualPlanId;
  try {
    const pricingSnap = await db.collection('settings').doc('pricing').get();
    if (pricingSnap.exists) {
      const d = pricingSnap.data();
      if (d.proMonthly)                proMonthly                = d.proMonthly;
      if (d.agencyMonthly)             agencyMonthly             = d.agencyMonthly;
      if (d.proAnnual)                 proAnnual                 = d.proAnnual;
      if (d.agencyAnnual)              agencyAnnual              = d.agencyAnnual;
      if (d.squareProMonthlyPlanId)    squareProMonthlyPlanId    = d.squareProMonthlyPlanId;
      if (d.squareProAnnualPlanId)     squareProAnnualPlanId     = d.squareProAnnualPlanId;
      if (d.squareAgencyMonthlyPlanId) squareAgencyMonthlyPlanId = d.squareAgencyMonthlyPlanId;
      if (d.squareAgencyAnnualPlanId)  squareAgencyAnnualPlanId  = d.squareAgencyAnnualPlanId;
    }
  } catch(e) {
    console.warn('createCheckoutSession: Firestore pricing read failed, using defaults:', e.message);
  }

  if (!['pro', 'agency'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' });

  const planIdMap = {
    pro:    { monthly: squareProMonthlyPlanId,    annual: squareProAnnualPlanId },
    agency: { monthly: squareAgencyMonthlyPlanId, annual: squareAgencyAnnualPlanId },
  };
  const subscriptionPlanId = planIdMap[plan][billingPeriod];
  if (!subscriptionPlanId) {
    return res.status(503).json({ error: 'Subscription plans not yet configured. Run adminUpdatePricing first.' });
  }

  // Idempotency key — 1-hour window protects against double-clicks / slow-network retries
  const idempotencyKey = `checkout-${uid}-${plan}-${billingPeriod}-${Math.floor(Date.now() / 3600000)}`;

  const response = await getSquare().checkout.paymentLinks.create({
    idempotencyKey,
    checkoutOptions: {
      redirectUrl: `${APP_BASE_URL}/BlastyBiz-Dashboard.html?success=1`,
      merchantSupportEmail: 'info@blastybiz.com',
      subscriptionPlanId,
    },
    prePopulatedData: { buyerEmail: email },
  });

  // Store uid + plan + billingPeriod keyed by Square orderId so squareWebhook can
  // reliably map the payment.completed event back to the right user + plan tier.
  const orderId = response.paymentLink?.orderId;
  if (orderId) {
    await db.collection('pendingCheckouts').doc(orderId).set({
      uid, plan, billingPeriod,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 48 * 60 * 60 * 1000),
    });
  }
  res.json({ url: response.paymentLink.url });
}));

// ══════════════════════════════════════════
// createPortalSession
// POST /createPortalSession
// Square has no hosted billing portal — returns a mailto link.
// ══════════════════════════════════════════
exports.createPortalSession = onRequest({ invoker: 'public' }, withAuth(async (req, res, decoded) => {
  const uid = decoded.uid;
  const subSnap = await db.collection('subscriptions').doc(uid).get();
  if (!subSnap.exists) return res.status(404).json({ error: 'No subscription found' });
  res.json({ url: 'mailto:info@blastybiz.com?subject=Manage%20BlastyBiz%20Subscription' });
}));

// ══════════════════════════════════════════
// squareWebhook
// POST /squareWebhook
// Verifies Square HMAC signature, handles payment.updated (COMPLETED/FAILED),
// subscription.created, and subscription.updated (cancellation).
// ══════════════════════════════════════════
exports.squareWebhook = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['SQUARE_WEBHOOK_SIGNATURE_KEY', 'RESEND_API_KEY'] }, async (req, res) => {
  const signatureKey   = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/squareWebhook';
  const body           = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const hmac           = crypto.createHmac('sha256', signatureKey);
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

  const event = req.body;

  // Idempotency guard — Square retries on non-2xx; reject replays at the doc level.
  const eventId = event.event_id;
  if (eventId) {
    try {
      await db.collection('webhookEvents').doc(eventId).create({
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        type: event.type || ''
      });
    } catch(e) {
      if (e.code === 6) { // ALREADY_EXISTS
        console.log(`[squareWebhook] Duplicate event ${eventId} — skipping`);
        return res.json({ received: true });
      }
      throw e;
    }
  }

  if (event.type === 'payment.updated' && event.data?.object?.payment?.status === 'COMPLETED') {
    const payment = event.data?.object?.payment;
    if (!payment) return res.json({ received: true });
    const orderId = payment.order_id || payment.orderId;
    if (!orderId) return res.json({ received: true });
    try {
      const pendingSnap = await db.collection('pendingCheckouts').doc(orderId).get();
      if (!pendingSnap.exists) return res.json({ received: true });
      const { uid, plan, billingPeriod: pendingBillingPeriod } = pendingSnap.data();
      const billingPeriod = pendingBillingPeriod || 'monthly';
      if (!uid) return res.json({ received: true });
      await db.collection('pendingCheckouts').doc(orderId).delete();
      const bizSnaps  = await userBizCol(uid).get();
      const syncBatch = db.batch();
      syncBatch.set(
        db.collection('users').doc(uid),
        { plan, planActive: true, billingPeriod },
        { merge: true }
      );
      bizSnaps.docs.forEach(biz => {
        syncBatch.update(biz.ref, { currentPlan: plan, subscriptionStatus: 'active' });
      });
      await syncBatch.commit();
      await db.collection('subscriptions').doc(uid).set({
        uid,
        squareCustomerId: payment.customer_id || '',
        squarePaymentId: payment.id,
        plan,
        billingPeriod,
        status: 'active',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Send paid-welcome email
      try {
        const userSnap    = await db.collection('users').doc(uid).get();
        const userData    = userSnap.data() || {};
        const toEmail     = userData.email;
        const ownerName   = userData.ownerName || userData.displayName || '';
        const businessName = (bizSnaps.docs[0]?.data()?.businessName) || (ownerName ? ownerName + '\'s Business' : 'your business');
        const planName    = plan === 'agency' ? 'Agency' : 'Pro';

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
              .where('type', '==', 'paid-welcome').where('active', '==', true).limit(1).get();
            if (!tmplSnap.empty) {
              const tmpl = tmplSnap.docs[0].data();
              paidSubject = applyPaidTags(tmpl.subject || paidSubject);
              paidHtml    = applyPaidTags(tmpl.html    || '');
            }
          } catch(e) { console.error('[squareWebhook] paid-welcome template fetch failed:', e.message); }

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
      } catch(e) { console.error('[squareWebhook] paid-welcome email failed:', e.message); }

      // Internal admin alert
      try {
        const paidUserSnap = await db.collection('users').doc(uid).get();
        const paidUserData = paidUserSnap.data() || {};
        const paidEmail    = paidUserData.email || uid;
        const paidName     = paidUserData.ownerName || paidUserData.displayName || 'Unknown';
        const paidBizSnap  = await userBizCol(uid).limit(1).get();
        const paidBiz      = paidBizSnap.docs[0]?.data()?.businessName || '—';
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
    } catch (e) {
      console.error('squareWebhook order lookup error:', e.message);
    }
  }

  if (event.type === 'subscription.created') {
    const sub = event.data?.object?.subscription;
    if (sub) {
      const subscriptionId = sub.id;
      const customerId     = sub.customer_id || sub.customerId;
      if (subscriptionId && customerId) {
        try {
          const snap = await db.collection('subscriptions')
            .where('squareCustomerId', '==', customerId).limit(1).get();
          if (!snap.empty) {
            await snap.docs[0].ref.update({
              squareSubscriptionId: subscriptionId,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        } catch (e) { console.error('squareWebhook subscription.created error:', e.message); }
      }
    }
  }

  if (event.type === 'subscription.updated') {
    const sub = event.data?.object?.subscription;
    if (sub) {
      const status     = (sub.status || '').toUpperCase();
      const isCanceled = status === 'CANCELED' || status === 'DEACTIVATED';
      if (isCanceled) {
        const customerId = sub.customer_id || sub.customerId;
        if (customerId) {
          try {
            const snap = await db.collection('subscriptions')
              .where('squareCustomerId', '==', customerId).limit(1).get();
            if (!snap.empty) {
              const uid          = snap.docs[0].data().uid;
              const priorUserSnap = await db.collection('users').doc(uid).get();
              const priorPlan     = priorUserSnap.data()?.plan || 'pro';
              const priorPlanName = priorPlan === 'agency' ? 'Agency' : 'Pro';
              await db.collection('users').doc(uid).set(
                { plan: 'starter', planActive: false }, { merge: true }
              );
              await snap.docs[0].ref.update({
                status: 'canceled',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              const bizSnaps = await userBizCol(uid).get();
              for (const biz of bizSnaps.docs) {
                await biz.ref.update({ currentPlan: 'starter', subscriptionStatus: 'canceled' });
              }

              // Cancellation email
              try {
                const userSnap = await db.collection('users').doc(uid).get();
                const userData = userSnap.data() || {};
                const toEmail  = userData.email;
                const ownerName = userData.ownerName || userData.displayName || '';
                const businessName = (bizSnaps.docs[0]?.data()?.businessName) || (ownerName ? ownerName + '\'s Business' : 'your business');
                if (toEmail) {
                  const mergeData = {
                    name: ownerName || 'there',
                    businessName,
                    planName: priorPlanName,
                    upgradeUrl:   APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
                    dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
                    appUrl:       APP_BASE_URL,
                  };
                  function applyCancelTags(str) {
                    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
                  }
                  let cancelSubject = `Your BlastyBiz subscription has ended, ${mergeData.name}`;
                  let cancelHtml    = null;
                  try {
                    const tmplSnap = await db.collection('emailTemplates')
                      .where('type', '==', 'cancellation').where('active', '==', true).limit(1).get();
                    if (!tmplSnap.empty) {
                      const tmpl = tmplSnap.docs[0].data();
                      cancelSubject = applyCancelTags(tmpl.subject || cancelSubject);
                      cancelHtml    = applyCancelTags(tmpl.html    || '');
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
    <a href="${mergeData.upgradeUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Come Back to ${mergeData.planName} &#8594;</a>
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
          } catch (e) { console.error('squareWebhook subscription.updated error:', e.message); }
        }
      }
    }
  }

  // Payment failed
  if (event.type === 'payment.updated' && event.data?.object?.payment?.status === 'FAILED') {
    const payment = event.data?.object?.payment;
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
          toEmail    = userData.email;
          ownerName  = userData.ownerName || userData.displayName || '';
          const bizSnap = await userBizCol(uid).limit(1).get();
          businessName = bizSnap.docs[0]?.data()?.businessName || (ownerName ? ownerName + '\'s Business' : 'your business');
        }
        if (toEmail) {
          const mergeData = {
            name:         ownerName || 'there',
            businessName: businessName || 'your business',
            dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
            upgradeUrl:   APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
            appUrl:       APP_BASE_URL,
          };
          function applyPaymentFailedTags(str) {
            return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
          }
          let pfSubject = `Action needed, ${mergeData.name} — your BlastyBiz payment didn't go through`;
          let pfHtml    = null;
          try {
            const tmplSnap = await db.collection('emailTemplates')
              .where('type', '==', 'payment-failed').where('active', '==', true).limit(1).get();
            if (!tmplSnap.empty) {
              const tmpl = tmplSnap.docs[0].data();
              pfSubject  = applyPaymentFailedTags(tmpl.subject || pfSubject);
              pfHtml     = applyPaymentFailedTags(tmpl.html    || '');
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
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">We weren't able to process your BlastyBiz subscription payment for <strong>${mergeData.businessName}</strong>.</p>
    <a href="${mergeData.dashboardUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px">Update Payment Method &#8594;</a>
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

// ══════════════════════════════════════════
// adminUpdatePricing
// POST /adminUpdatePricing  (admin only)
// Creates new Square subscription plans and stores plan IDs in Firestore.
// ══════════════════════════════════════════
exports.adminUpdatePricing = onRequest({ invoker: 'public', secrets: ['SQUARE_ACCESS_TOKEN'] }, withAuth(async (req, res, decoded) => {
  const { proMonthly, agencyMonthly, proAnnual, agencyAnnual } = req.body;
  if (!proMonthly || !agencyMonthly) return res.status(400).json({ error: 'proMonthly and agencyMonthly required' });
  const pro       = parseFloat(proMonthly);
  const agency    = parseFloat(agencyMonthly);
  const proAnn    = proAnnual    ? parseFloat(proAnnual)    : 199;
  const agencyAnn = agencyAnnual ? parseFloat(agencyAnnual) : 999;
  if ([pro, agency, proAnn, agencyAnn].some(v => isNaN(v) || v < 0)) return res.status(400).json({ error: 'Invalid prices' });

  const catalog = getSquare().catalog;
  const ts      = Date.now();

  let squareProMonthlyPlanId, squareProAnnualPlanId;
  let squareAgencyMonthlyPlanId, squareAgencyAnnualPlanId;
  let squareError;
  try {
    const [proMonResult, proAnnResult, agencyMonResult, agencyAnnResult] = await Promise.all([
      catalog.object.upsert({
        idempotencyKey: `bb-pro-monthly-${ts}`,
        object: {
          type: 'SUBSCRIPTION_PLAN', id: '#pro_monthly_plan',
          subscriptionPlanData: {
            name: `BlastyBiz Pro — $${pro}/mo`,
            phases: [{ cadence: 'MONTHLY', recurringPriceMoney: { amount: BigInt(Math.round(pro * 100)), currency: 'USD' }, ordinal: BigInt(0) }],
          },
        },
      }),
      catalog.object.upsert({
        idempotencyKey: `bb-pro-annual-${ts}`,
        object: {
          type: 'SUBSCRIPTION_PLAN', id: '#pro_annual_plan',
          subscriptionPlanData: {
            name: `BlastyBiz Pro — $${proAnn}/yr`,
            phases: [{ cadence: 'ANNUAL', recurringPriceMoney: { amount: BigInt(Math.round(proAnn * 100)), currency: 'USD' }, ordinal: BigInt(0) }],
          },
        },
      }),
      catalog.object.upsert({
        idempotencyKey: `bb-agency-monthly-${ts}`,
        object: {
          type: 'SUBSCRIPTION_PLAN', id: '#agency_monthly_plan',
          subscriptionPlanData: {
            name: `BlastyBiz Agency — $${agency}/mo`,
            phases: [{ cadence: 'MONTHLY', recurringPriceMoney: { amount: BigInt(Math.round(agency * 100)), currency: 'USD' }, ordinal: BigInt(0) }],
          },
        },
      }),
      catalog.object.upsert({
        idempotencyKey: `bb-agency-annual-${ts}`,
        object: {
          type: 'SUBSCRIPTION_PLAN', id: '#agency_annual_plan',
          subscriptionPlanData: {
            name: `BlastyBiz Agency — $${agencyAnn}/yr`,
            phases: [{ cadence: 'ANNUAL', recurringPriceMoney: { amount: BigInt(Math.round(agencyAnn * 100)), currency: 'USD' }, ordinal: BigInt(0) }],
          },
        },
      }),
    ]);
    squareProMonthlyPlanId    = proMonResult.catalogObject?.id;
    squareProAnnualPlanId     = proAnnResult.catalogObject?.id;
    squareAgencyMonthlyPlanId = agencyMonResult.catalogObject?.id;
    squareAgencyAnnualPlanId  = agencyAnnResult.catalogObject?.id;
  } catch (e) {
    squareError = e.message || String(e);
    console.error('[adminUpdatePricing] Square plan creation failed:', squareError);
  }

  const update = {
    proMonthly: pro, agencyMonthly: agency, proAnnual: proAnn, agencyAnnual: agencyAnn,
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
