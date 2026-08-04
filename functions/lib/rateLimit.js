'use strict';
const { db, admin } = require('./db');

// ── Simple per-uid rate limiter (Firestore-backed) ────────────────────────────
// Returns true if the caller is within limit (and records the hit); false if over.
// Wrapped in a transaction to eliminate the read-then-write race condition that
// could allow slightly over-limit requests through under concurrency.
async function checkUidRateLimit(collectionName, uid, maxCount, windowMs) {
  try {
    const rlRef = db.collection(collectionName).doc(uid);
    const now = Date.now();
    const allowed = await db.runTransaction(async (txn) => {
      const rlSnap = await txn.get(rlRef);
      if (rlSnap.exists) {
        const { count, windowStart } = rlSnap.data();
        if (now - windowStart < windowMs) {
          if (count >= maxCount) return false;
          txn.update(rlRef, { count: admin.firestore.FieldValue.increment(1) });
        } else {
          txn.set(rlRef, { count: 1, windowStart: now, expiresAt: admin.firestore.Timestamp.fromMillis(now + windowMs) });
        }
      } else {
        txn.set(rlRef, { count: 1, windowStart: now, expiresAt: admin.firestore.Timestamp.fromMillis(now + windowMs) });
      }
      return true;
    });
    return allowed;
  } catch(e) { return false; /* rate-limit check fails closed — deny if Firestore unavailable */ }
}

module.exports = { checkUidRateLimit };
