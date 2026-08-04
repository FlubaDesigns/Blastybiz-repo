/**
 * BlastyBiz — Miscellaneous public endpoints
 * sendTestEmail, contactForm, unsubscribeEmail
 */
'use strict';

const {
  onRequest, admin, db, crypto,
  APP_BASE_URL,
  setCors, withAuth,
  makeUnsubSig, _unsubSecret,
} = require('../lib/shared');

exports.sendTestEmail = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, withAuth(async (req, res, decoded) => {
  const { to, subject: rawSubject, html: rawHtml } = req.body;
  if (!to || !rawSubject || !rawHtml) return res.status(400).json({ error: 'to, subject, and html are required' });
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 'placeholder') return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

  const SAMPLE = {
    name: 'Alex Johnson',
    businessName: 'Sunrise Café',
    planName: 'Pro',
    platform: 'Google Business',
    jobCount: '5',
    platformList: 'Google Business, Facebook, Instagram',
    dashboardUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html',
    upgradeUrl: APP_BASE_URL + '/BlastyBiz-Dashboard.html#upgrade',
    appUrl: APP_BASE_URL,
  };
  function applyTags(str) {
    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE[k] ?? '');
  }
  const finalSubject = '[TEST] ' + applyTags(rawSubject);
  const finalHtml    = applyTags(rawHtml);

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'BlastyBiz <info@blastybiz.com>', to: [to], subject: finalSubject, html: finalHtml }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || 'Resend error', detail: data });
    return res.json({ ok: true, id: data.id, to });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}, { admin: true }));

exports.contactForm = onRequest({ invoker: 'public', secrets: ['RESEND_API_KEY'] }, withAuth(async (req, res) => {
  const ALLOWED_TO = new Set(['support@blastybiz.com', 'info@blastybiz.com', 'sales@blastybiz.com', 'billing@blastybiz.com']);
  const { to, name, email, message } = req.body || {};
  if (!ALLOWED_TO.has(to)) return res.status(400).json({ error: 'Invalid recipient' });
  if (!name?.trim() || !email?.trim() || !message?.trim()) return res.status(400).json({ error: 'Missing fields' });
  if (name.trim().length > 200) return res.status(400).json({ error: 'Name too long' });
  if (email.trim().length > 200) return res.status(400).json({ error: 'Email too long' });
  if (message.trim().length > 3000) return res.status(400).json({ error: 'Message too long (3000 chars max)' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: 'Invalid email address' });

  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    const ipKey = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const rlRef = db.collection('contactRateLimit').doc(ipKey);
    const rlSnap = await rlRef.get();
    const now = Date.now();
    const windowMs = 60 * 60 * 1000;
    if (rlSnap.exists) {
      const { count, windowStart } = rlSnap.data();
      if (now - windowStart < windowMs) {
        if (count >= 5) return res.status(429).json({ error: 'Too many messages. Please try again in an hour.' });
        await rlRef.update({ count: admin.firestore.FieldValue.increment(1) });
      } else {
        await rlRef.set({ count: 1, windowStart: now, expiresAt: admin.firestore.Timestamp.fromMillis(now + windowMs) });
      }
    } else {
      await rlRef.set({ count: 1, windowStart: now, expiresAt: admin.firestore.Timestamp.fromMillis(now + windowMs) });
    }
  } catch(e) { /* rate-limit check non-fatal */ }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 'placeholder') return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  const safeName    = escHtml(name.trim());
  const safeEmail   = escHtml(email.trim());
  const safeMessage = escHtml(message.trim()).replace(/\n/g, '<br>');
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'BlastyBiz <info@blastybiz.com>',
        to: [to],
        reply_to: email.trim(),
        subject: `New message from ${safeName}`,
        html: `<p><strong>Name:</strong> ${safeName}<br><strong>Email:</strong> ${safeEmail}</p><p><strong>Message:</strong><br>${safeMessage}</p>`,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || 'Resend error' });
    return res.json({ success: true, id: data.id });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}, { public: true }));

exports.unsubscribeEmail = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['RESEND_API_KEY', 'UNSUB_SIGNING_KEY'] }, async (req, res) => {
  const uid = req.query.uid;
  const sig = req.query.sig;
  if (!uid || !sig) return res.status(400).send('<p>Missing unsubscribe parameters.</p>');

  const signingKey = _unsubSecret();
  if (!signingKey) return res.status(500).send('<p>Configuration error.</p>');

  const expected = makeUnsubSig(uid, signingKey);
  let sigValid = false;
  try {
    sigValid = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch(e) { /* invalid hex */ }
  if (!sigValid) return res.status(400).send('<p>Invalid unsubscribe link. Please contact support.</p>');

  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return res.status(404).send('<p>Account not found.</p>');
    await db.collection('users').doc(uid).update({ emailUnsubscribed: true });
    return res.status(200).send('<p>You have been unsubscribed. You will no longer receive marketing emails from BlastyBiz.</p>');
  } catch(e) {
    console.error('[unsubscribeEmail] error:', e.message);
    return res.status(500).send('<p>Something went wrong. Please try again or contact support.</p>');
  }
});
