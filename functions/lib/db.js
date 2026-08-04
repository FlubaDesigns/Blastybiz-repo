'use strict';
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ── Subcollection path helpers ─────────────────────────────────────────────────
function userBizRef(uid, bizId)   { return db.collection('users').doc(uid).collection('businesses').doc(bizId); }
function userBizCol(uid)          { return db.collection('users').doc(uid).collection('businesses'); }
function userBizDraftsRef(uid, bizId) { return userBizRef(uid, bizId).collection('listingDrafts'); }
function userBizJobsRef(uid, bizId)   { return userBizRef(uid, bizId).collection('publishJobs'); }
function userBizPostsRef(uid, bizId)  { return userBizRef(uid, bizId).collection('pendingPosts'); }
function userBizConnsRef(uid, bizId)  { return userBizRef(uid, bizId).collection('platformConnections'); }

// ── Private token subcollection helpers ───────────────────────────────────────
// OAuth access/refresh tokens live in platformConnections/{id}/private/tokens,
// a subcollection denied to ALL browser clients in Firestore rules (server-only).
// Never store accessToken or refreshToken on the parent platformConnections doc.
async function _getConnTokens(connRef) {
  const snap = await connRef.collection('private').doc('tokens').get();
  return snap.exists ? snap.data() : {};
}
async function _setConnTokens(connRef, tokens) {
  await connRef.collection('private').doc('tokens').set(tokens, { merge: true });
}

module.exports = {
  admin, db,
  userBizRef, userBizCol, userBizDraftsRef, userBizJobsRef, userBizPostsRef, userBizConnsRef,
  _getConnTokens, _setConnTokens,
};
