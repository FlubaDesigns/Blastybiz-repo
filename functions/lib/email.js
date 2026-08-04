'use strict';

// ── Resend email helper (uses native fetch — Node 22) ──────────────────────
async function sendResendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === 'placeholder') {
    console.log('[email] RESEND_API_KEY not configured — skipping email to', to);
    return;
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'BlastyBiz <info@blastybiz.com>', to: [to], subject, html }),
    });
    if (!resp.ok) console.error('[email] Resend error:', await resp.text());
  } catch (e) {
    console.error('[email] sendResendEmail failed:', e.message);
  }
}

module.exports = { sendResendEmail };
