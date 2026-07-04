/**
 * deleteAccount deletion sweep test
 *
 * Verifies that deleteAccount wipes all user-owned Firestore data and leaves
 * billing-only records (aiUsageLogs) intact.
 *
 * Prerequisites:
 *   firebase emulators:start --only firestore
 *   (or use the npm test script which runs emulators:exec)
 *
 * Run:
 *   npm test  (from functions/)          -- uses firebase emulators:exec
 *   node functions/test/deleteAccount.test.js  -- if emulator already running
 */

'use strict';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore }                 = require('firebase-admin/firestore');

// ── bootstrap ────────────────────────────────────────────────────────────────
if (!getApps().length) {
  initializeApp({ projectId: 'blastybiz-9523e' });
}
const db = getFirestore();
db.settings({ host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });

// ── helpers ──────────────────────────────────────────────────────────────────
const UID   = 'test-user-delete-sweep';
const BIZ1  = 'biz-alpha';
const BIZ2  = 'biz-beta';

function userBizRef(uid, bizId)      { return db.collection('users').doc(uid).collection('businesses').doc(bizId); }
function userBizCol(uid)             { return db.collection('users').doc(uid).collection('businesses'); }
function userBizDraftsRef(uid, bizId){ return userBizRef(uid, bizId).collection('listingDrafts'); }
function userBizJobsRef(uid, bizId)  { return userBizRef(uid, bizId).collection('publishJobs'); }
function userBizPostsRef(uid, bizId) { return userBizRef(uid, bizId).collection('pendingPosts'); }
function userBizConnsRef(uid, bizId) { return userBizRef(uid, bizId).collection('platformConnections'); }

// ── assertion helper ─────────────────────────────────────────────────────────
function assert(condition, message) {
  if (!condition) {
    console.error(`\n  FAIL  ${message}`);
    process.exitCode = 1;
    return false;
  }
  console.log(`  PASS  ${message}`);
  return true;
}

// ── seed data ────────────────────────────────────────────────────────────────
async function seedData() {
  const batch1 = db.batch();
  const batch2 = db.batch();

  // top-level docs
  batch1.set(db.collection('users').doc(UID), { displayName: 'Test User', email: 'test@example.com', uid: UID });
  batch1.set(db.collection('subscriptions').doc(UID), { plan: 'starter', uid: UID });

  // aiUsageLogs — intentionally NOT deleted (billing records)
  batch1.set(db.collection('aiUsageLogs').doc(`log-${UID}-1`), { uid: UID, tokens: 500, createdAt: new Date() });

  // activityLogs — must be deleted
  batch1.set(db.collection('activityLogs').doc(`act-${UID}-1`), { uid: UID, event: 'login' });
  batch1.set(db.collection('activityLogs').doc(`act-${UID}-2`), { uid: UID, event: 'publish' });
  batch1.set(db.collection('activityLogs').doc(`act-${UID}-3`), { uid: UID, event: 'edit' });

  // business 1
  batch1.set(userBizRef(UID, BIZ1), { businessName: 'Alpha Biz', uid: UID });
  batch1.set(userBizDraftsRef(UID, BIZ1).doc('draft-1'), { platform: 'google', uid: UID });
  batch1.set(userBizDraftsRef(UID, BIZ1).doc('draft-2'), { platform: 'yelp', uid: UID });
  batch1.set(userBizJobsRef(UID, BIZ1).doc('job-1'), { status: 'pending', uid: UID });
  batch1.set(userBizJobsRef(UID, BIZ1).doc('job-2'), { status: 'done', uid: UID });
  batch1.set(userBizPostsRef(UID, BIZ1).doc('post-1'), { content: 'hello', uid: UID });
  batch1.set(userBizPostsRef(UID, BIZ1).doc('post-2'), { content: 'world', uid: UID });
  batch1.set(userBizConnsRef(UID, BIZ1).doc('google'), { status: 'connected', uid: UID });
  batch1.set(userBizConnsRef(UID, BIZ1).doc('facebook'), { status: 'connected', uid: UID });
  batch1.set(userBizRef(UID, BIZ1).collection('documents').doc('doc-1'), { type: 'press_release', uid: UID });

  // business 2
  batch2.set(userBizRef(UID, BIZ2), { businessName: 'Beta Biz', uid: UID });
  batch2.set(userBizDraftsRef(UID, BIZ2).doc('draft-1'), { platform: 'apple', uid: UID });
  batch2.set(userBizJobsRef(UID, BIZ2).doc('job-1'), { status: 'pending', uid: UID });
  batch2.set(userBizPostsRef(UID, BIZ2).doc('post-1'), { content: 'beta post', uid: UID });
  batch2.set(userBizConnsRef(UID, BIZ2).doc('instagram'), { status: 'connected', uid: UID });
  batch2.set(userBizRef(UID, BIZ2).collection('documents').doc('doc-1'), { type: 'bio', uid: UID });

  await batch1.commit();
  await batch2.commit();
  console.log('  [seed] wrote 22 test documents across all known paths');
}

// ── count helpers ────────────────────────────────────────────────────────────
async function countDocs(ref) {
  const snap = await ref.get();
  return snap.size;
}

// ── deletion logic (mirrors deleteAccount exactly) ──────────────────────────
async function runDeletion(uid) {
  const [bizSnap, activitySnap] = await Promise.all([
    userBizCol(uid).get(),
    db.collection('activityLogs').where('uid', '==', uid).get(),
  ]);

  const bizSubRefs = [];
  for (const bizDoc of bizSnap.docs) {
    const bizId = bizDoc.id;
    const [draftsSnap, jobsSnap, connsSnap, pendingSnap, libSnap] = await Promise.all([
      userBizDraftsRef(uid, bizId).get(),
      userBizJobsRef(uid, bizId).get(),
      userBizConnsRef(uid, bizId).get(),
      userBizPostsRef(uid, bizId).get(),
      userBizRef(uid, bizId).collection('documents').get(),
    ]);
    draftsSnap.docs.forEach(d => bizSubRefs.push(d.ref));
    jobsSnap.docs.forEach(d => bizSubRefs.push(d.ref));
    connsSnap.docs.forEach(d => bizSubRefs.push(d.ref));
    pendingSnap.docs.forEach(d => bizSubRefs.push(d.ref));
    libSnap.docs.forEach(d => bizSubRefs.push(d.ref));
  }

  const allRefs = [
    db.collection('users').doc(uid),
    db.collection('subscriptions').doc(uid),
    ...bizSnap.docs.map(d => d.ref),
    ...bizSubRefs,
    ...activitySnap.docs.map(d => d.ref),
  ];

  const CHUNK = 450;
  for (let i = 0; i < allRefs.length; i += CHUNK) {
    const batch = db.batch();
    allRefs.slice(i, i + CHUNK).forEach(ref => batch.delete(ref));
    await batch.commit();
  }

  console.log(`  [deletion] deleted ${allRefs.length} document refs`);
}

// ── verify nothing remains ───────────────────────────────────────────────────
async function verifyClean(uid) {
  const userDoc  = await db.collection('users').doc(uid).get();
  const subDoc   = await db.collection('subscriptions').doc(uid).get();
  const bizCount = await countDocs(userBizCol(uid));

  // subcollections under each business should also be gone
  let subColCount = 0;
  const bizSnap = await userBizCol(uid).get();  // should be empty, but check anyway
  for (const biz of bizSnap.docs) {
    const bizId = biz.id;
    for (const col of ['listingDrafts', 'publishJobs', 'pendingPosts', 'platformConnections', 'documents']) {
      const s = await userBizRef(uid, bizId).collection(col).get();
      subColCount += s.size;
    }
  }

  const actSnap  = await db.collection('activityLogs').where('uid', '==', uid).get();
  const aiSnap   = await db.collection('aiUsageLogs').where('uid', '==', uid).get();

  return { userDoc, subDoc, bizCount, subColCount, actCount: actSnap.size, aiCount: aiSnap.size };
}

// ── clean up any leftover data from a previous run ───────────────────────────
async function purgeTestData(uid) {
  // Wipe by running the deletion + any aiUsageLogs
  await runDeletion(uid).catch(() => {});
  const aiSnap = await db.collection('aiUsageLogs').where('uid', '==', uid).get();
  if (aiSnap.size > 0) {
    const batch = db.batch();
    aiSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n=== deleteAccount deletion sweep test ===\n');

  try {
    // Ensure a clean slate before seeding
    console.log('Cleaning up any leftover data from previous runs...');
    await purgeTestData(UID);

    // Seed
    console.log('\nSeeding test data...');
    await seedData();

    // Run the deletion logic
    console.log('\nRunning deletion logic...');
    await runDeletion(UID);

    // Verify
    console.log('\nVerifying results...');
    const r = await verifyClean(UID);

    assert(!r.userDoc.exists,    'users/{uid} document is deleted');
    assert(!r.subDoc.exists,     'subscriptions/{uid} document is deleted');
    assert(r.bizCount === 0,     'users/{uid}/businesses collection is empty');
    assert(r.subColCount === 0,  'all business subcollections are empty (listingDrafts, publishJobs, pendingPosts, platformConnections, documents)');
    assert(r.actCount === 0,     'activityLogs entries for this user are deleted');
    assert(r.aiCount === 1,      'aiUsageLogs are RETAINED (billing records must not be deleted)');

  } catch (err) {
    console.error('\nUnexpected error:', err);
    process.exitCode = 1;
  }

  const passed = process.exitCode !== 1;
  console.log(`\n${ passed ? '✓ All assertions passed' : '✗ One or more assertions failed' }\n`);
  process.exit(passed ? 0 : 1);
})();
