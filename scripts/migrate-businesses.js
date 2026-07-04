/**
 * migrate-businesses.js
 *
 * One-time migration script: moves data from old flat top-level Firestore collections
 * into the new users/{uid}/businesses/{bizId}/ subcollection structure.
 *
 * Collections migrated (in order):
 *   1. businesses/{bizId}  →  users/{uid}/businesses/{bizId}
 *      - sub-collections: documents, campaigns, facts, images, copy, advertising, pendingPosts,
 *        listingDrafts, publishJobs, platformConnections
 *   2. listingDrafts/{docId}          →  users/{uid}/businesses/{bizId}/listingDrafts/{docId}
 *   3. publishJobs/{docId}            →  users/{uid}/businesses/{bizId}/publishJobs/{docId}
 *   4. pendingPosts/{docId}           →  users/{uid}/businesses/{bizId}/pendingPosts/{docId}
 *   5. platformConnections/{docId}    →  users/{uid}/businesses/{bizId}/platformConnections/{platform}
 *      (old doc ID was {bizId}_{platform}; new doc ID is just {platform})
 *
 * NOT migrated (stays flat by design):
 *   - aiRequestDedup — keyed by uid+requestId, not by business; TTL-managed, no user-visible impact
 *
 * Safe to re-run: skips docs that already exist at the new path (idempotent).
 * Does NOT delete old docs automatically — run with --delete after verifying new data.
 *
 * Usage:
 *   node scripts/migrate-businesses.js [--dry-run] [--delete]
 *
 * Requires: scripts/service-account.json (Firebase Admin service account key)
 */
const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const DRY    = process.argv.includes('--dry-run');
const DELETE = process.argv.includes('--delete');
if (DRY)    console.log('[DRY RUN] No writes will be made.\n');
if (DELETE) console.log('[DELETE] Old docs will be deleted after copy.\n');

// ─── helpers ────────────────────────────────────────────────────────────────

async function copySubCollection(srcRef, destRef, subName) {
  const snap = await srcRef.collection(subName).get();
  if (snap.empty) return 0;
  let count = 0;
  for (const d of snap.docs) {
    const dest = destRef.collection(subName).doc(d.id);
    const existing = await dest.get();
    if (existing.exists) { console.log(`    [SKIP ${subName}/${d.id}] already exists`); continue; }
    if (!DRY) await dest.set(d.data());
    console.log(`    ${DRY ? '[DRY]' : '[COPIED]'} ${subName}/${d.id}`);
    count++;
  }
  return count;
}

async function copyDoc(srcRef, destRef, label) {
  const snap = await srcRef.get();
  if (!snap.exists) return false;
  const existing = await destRef.get();
  if (existing.exists) {
    console.log(`  [SKIP] ${label} — already exists at destination`);
    return false;
  }
  if (!DRY) await destRef.set(snap.data());
  console.log(`  ${DRY ? '[DRY]' : '[COPIED]'} ${label}`);
  return true;
}

// ─── Step 1: migrate flat businesses/{bizId} ────────────────────────────────

async function migrateBusinesses() {
  console.log('\n=== Step 1: businesses/{bizId} → users/{uid}/businesses/{bizId} ===');
  const snap = await db.collection('businesses').get();
  if (snap.empty) { console.log('  No flat businesses docs found.'); return; }

  const SUB_COLLECTIONS = [
    'documents', 'campaigns', 'facts', 'images', 'copy', 'advertising',
    'pendingPosts', 'listingDrafts', 'publishJobs', 'platformConnections',
  ];

  let migrated = 0, skipped = 0, errors = 0;
  for (const biz of snap.docs) {
    const data = biz.data();
    const uid  = data.uid;
    if (!uid) {
      console.warn(`  [WARN] businesses/${biz.id} has no uid — skipping`);
      errors++;
      continue;
    }
    const destRef = db.doc(`users/${uid}/businesses/${biz.id}`);
    const copied  = await copyDoc(biz.ref, destRef, `businesses/${biz.id} → users/${uid}/businesses/${biz.id}`);
    if (copied) {
      for (const sub of SUB_COLLECTIONS) {
        const n = await copySubCollection(biz.ref, destRef, sub);
        if (n) console.log(`    → ${n} ${sub} docs copied`);
      }
      migrated++;
      if (DELETE && !DRY) {
        await biz.ref.delete();
        console.log(`  [DELETED] businesses/${biz.id}`);
      }
    } else {
      skipped++;
    }
  }
  console.log(`  Done: migrated=${migrated}  skipped=${skipped}  errors=${errors}`);
}

// ─── Step 2: migrate flat listingDrafts ─────────────────────────────────────

async function migrateListingDrafts() {
  console.log('\n=== Step 2: listingDrafts → users/{uid}/businesses/{bizId}/listingDrafts ===');
  const snap = await db.collection('listingDrafts').get();
  if (snap.empty) { console.log('  No flat listingDrafts found.'); return; }

  let migrated = 0, skipped = 0, errors = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const uid   = data.uid;
    const bizId = data.businessId;
    if (!uid || !bizId) {
      console.warn(`  [WARN] listingDrafts/${d.id} missing uid/businessId — skipping`);
      errors++;
      continue;
    }
    const destRef = db.doc(`users/${uid}/businesses/${bizId}/listingDrafts/${d.id}`);
    const copied  = await copyDoc(d.ref, destRef, `listingDrafts/${d.id}`);
    if (copied) {
      migrated++;
      if (DELETE && !DRY) { await d.ref.delete(); console.log(`  [DELETED] listingDrafts/${d.id}`); }
    } else { skipped++; }
  }
  console.log(`  Done: migrated=${migrated}  skipped=${skipped}  errors=${errors}`);
}

// ─── Step 3: migrate flat publishJobs ───────────────────────────────────────

async function migratePublishJobs() {
  console.log('\n=== Step 3: publishJobs → users/{uid}/businesses/{bizId}/publishJobs ===');
  const snap = await db.collection('publishJobs').get();
  if (snap.empty) { console.log('  No flat publishJobs found.'); return; }

  let migrated = 0, skipped = 0, errors = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const uid   = data.uid;
    const bizId = data.businessId;
    if (!uid || !bizId) {
      console.warn(`  [WARN] publishJobs/${d.id} missing uid/businessId — skipping`);
      errors++;
      continue;
    }
    const destRef = db.doc(`users/${uid}/businesses/${bizId}/publishJobs/${d.id}`);
    const copied  = await copyDoc(d.ref, destRef, `publishJobs/${d.id}`);
    if (copied) {
      migrated++;
      if (DELETE && !DRY) { await d.ref.delete(); console.log(`  [DELETED] publishJobs/${d.id}`); }
    } else { skipped++; }
  }
  console.log(`  Done: migrated=${migrated}  skipped=${skipped}  errors=${errors}`);
}

// ─── Step 4: migrate flat pendingPosts ──────────────────────────────────────

async function migratePendingPosts() {
  console.log('\n=== Step 4: pendingPosts → users/{uid}/businesses/{bizId}/pendingPosts ===');
  const snap = await db.collection('pendingPosts').get();
  if (snap.empty) { console.log('  No flat pendingPosts found.'); return; }

  let migrated = 0, skipped = 0, errors = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const uid   = data.uid;
    const bizId = data.businessId;
    if (!uid || !bizId) {
      console.warn(`  [WARN] pendingPosts/${d.id} missing uid/businessId — skipping`);
      errors++;
      continue;
    }
    const destRef = db.doc(`users/${uid}/businesses/${bizId}/pendingPosts/${d.id}`);
    const copied  = await copyDoc(d.ref, destRef, `pendingPosts/${d.id}`);
    if (copied) {
      migrated++;
      if (DELETE && !DRY) { await d.ref.delete(); console.log(`  [DELETED] pendingPosts/${d.id}`); }
    } else { skipped++; }
  }
  console.log(`  Done: migrated=${migrated}  skipped=${skipped}  errors=${errors}`);
}

// ─── Step 5: migrate flat platformConnections ────────────────────────────────

async function migratePlatformConnections() {
  console.log('\n=== Step 5: platformConnections → users/{uid}/businesses/{bizId}/platformConnections/{platform} ===');
  console.log('  (Old doc ID was {bizId}_{platform}; new doc ID is just {platform})');
  const snap = await db.collection('platformConnections').get();
  if (snap.empty) { console.log('  No flat platformConnections found.'); return; }

  let migrated = 0, skipped = 0, errors = 0;
  for (const d of snap.docs) {
    const data     = d.data();
    const uid      = data.uid;
    const bizId    = data.businessId;
    const platform = data.platform;
    if (!uid || !bizId || !platform) {
      console.warn(`  [WARN] platformConnections/${d.id} missing uid/businessId/platform — skipping`);
      errors++;
      continue;
    }
    const destRef = db.doc(`users/${uid}/businesses/${bizId}/platformConnections/${platform}`);
    const copied  = await copyDoc(d.ref, destRef, `platformConnections/${d.id} → .../platformConnections/${platform}`);
    if (copied) {
      migrated++;
      if (DELETE && !DRY) { await d.ref.delete(); console.log(`  [DELETED] platformConnections/${d.id}`); }
    } else { skipped++; }
  }
  console.log(`  Done: migrated=${migrated}  skipped=${skipped}  errors=${errors}`);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('BlastyBiz Firestore subcollection migration');
  console.log('==========================================');
  console.log('NOTE: aiRequestDedup stays flat by design (uid+requestId keyed, TTL-managed).\n');

  await migrateBusinesses();
  await migrateListingDrafts();
  await migratePublishJobs();
  await migratePendingPosts();
  await migratePlatformConnections();

  console.log('\n==========================================');
  if (DRY) {
    console.log('DRY RUN complete — no data was written.');
  } else if (DELETE) {
    console.log('Migration + cleanup complete. Verify Firestore console before running queries.');
  } else {
    console.log('Copy complete. Verify new paths in Firestore console, then re-run with --delete to clean up old docs.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
