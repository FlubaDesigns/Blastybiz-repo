/**
 * migrate-businesses.js
 * Copies all docs from flat `businesses/{bizId}` to `users/{uid}/businesses/{bizId}`.
 * Copies the `documents` sub-collection too.
 * Safe to re-run (skips docs that already exist at the new path).
 * Does NOT delete the old docs — do that manually after verifying.
 *
 * Usage:
 *   node scripts/migrate-businesses.js [--dry-run]
 */
const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const DRY = process.argv.includes('--dry-run');
if (DRY) console.log('[DRY RUN] No writes will be made.\n');

async function migrateDocuments(oldBizRef, newBizRef) {
  const snap = await oldBizRef.collection('documents').get();
  if (snap.empty) return 0;
  let count = 0;
  for (const d of snap.docs) {
    const dest = newBizRef.collection('documents').doc(d.id);
    const existing = await dest.get();
    if (existing.exists) { console.log(`  [SKIP docs/${d.id}] already exists`); continue; }
    if (!DRY) await dest.set(d.data());
    console.log(`  ${DRY ? '[DRY]' : '[COPIED]'} documents/${d.id}`);
    count++;
  }
  return count;
}

async function main() {
  const snap = await db.collection('businesses').get();
  if (snap.empty) { console.log('No businesses found in flat collection. Nothing to migrate.'); return; }

  console.log(`Found ${snap.size} business doc(s) to migrate.\n`);
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const biz of snap.docs) {
    const data = biz.data();
    const uid = data.uid;
    if (!uid) {
      console.warn(`[WARN] businesses/${biz.id} has no uid field — skipping`);
      errors++;
      continue;
    }

    const newRef = db.doc(`users/${uid}/businesses/${biz.id}`);
    const existing = await newRef.get();
    if (existing.exists) {
      console.log(`[SKIP] businesses/${biz.id} → already at users/${uid}/businesses/${biz.id}`);
      skipped++;
      continue;
    }

    console.log(`[MIGRATING] businesses/${biz.id} (${data.businessName || 'no name'}) → users/${uid}/businesses/${biz.id}`);
    if (!DRY) await newRef.set(data);

    const subCount = await migrateDocuments(biz.ref, newRef);
    if (subCount) console.log(`  → Migrated ${subCount} documents sub-collection doc(s)`);
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}  Skipped (already exists): ${skipped}  Errors: ${errors}`);
  if (!DRY && migrated > 0) {
    console.log('\nVerify data at the new paths, then manually delete the old businesses/{bizId} docs.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
