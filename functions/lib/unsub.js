'use strict';
const crypto = require('crypto');

// HMAC-signed unsubscribe tokens
// Use a dedicated UNSUB_SIGNING_KEY so rotating the Resend key doesn't
// silently invalidate every unsubscribe link already in customers' inboxes.
function makeUnsubSig(uid, secret) {
  return crypto.createHmac('sha256', secret).update(uid).digest('hex');
}
function _unsubSecret() {
  return process.env.UNSUB_SIGNING_KEY || process.env.RESEND_API_KEY;
}

module.exports = { makeUnsubSig, _unsubSecret };
