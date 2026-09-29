'use strict';
// Run without --apply to inspect. Execute with the Authorization Engine's
// existing BlastyBiz identity after this pass is reviewed and released.
const { PLATFORM_DEFAULTS } = require('../functions/lib/platforms');
function correctionPatch(data = {}) {
  const patch = {};
  for (const def of PLATFORM_DEFAULTS) {
    const current = data[def.slug];
    if (!current || typeof current !== 'object' || Array.isArray(current)) continue;
    for (const key of ['capabilityLevel', 'deliveryMode', 'proOnly']) {
      if (current[key] !== def[key]) patch[def.slug + '.' + key] = def[key];
    }
  }
  return patch;
}
const heldJobPatch = {
  planGated:false,status:'manual_required',customerLabel:'Action needed',
  customerVisibleMessage:'Your content is ready — copy it below.'
};
const isHeld = data => data?.planGated === true && data.status === 'pending';
async function migrateHeldJobs(db, apply=false) {
  const jobs=[];let cursor=null;
  while(true){
    let query=db.collectionGroup('publishJobs').where('planGated','==',true).orderBy('__name__').limit(200);
    if(cursor)query=query.startAfter(cursor);
    const page=await query.get();if(!page.docs.length)break;
    for(const row of page.docs){
      if(!isHeld(row.data()))continue;
      let changed=false;
      if(apply)changed=await db.runTransaction(async tx=>{
        const current=await tx.get(row.ref);
        if(!current.exists||!isHeld(current.data()))return false;
        tx.update(row.ref,heldJobPatch);return true;
      });
      jobs.push({path:row.ref.path,patch:heldJobPatch,applied:changed});
    }
    cursor=page.docs[page.docs.length-1];if(page.docs.length<200)break;
  }
  return jobs;
}
async function migrate(db, apply = false) {
  const ref = db.doc('config/platforms');
  let patch;
  if (!apply) {
    const snap=await ref.get();patch=correctionPatch(snap.exists?snap.data():{});
  }else{
    patch=await db.runTransaction(async tx=>{
      const snap=await tx.get(ref),changes=correctionPatch(snap.exists?snap.data():{});
      if(Object.keys(changes).length)tx.update(ref,changes);
      return changes;
    });
  }
  // Each job is rechecked transactionally. Interrupted runs can safely resume;
  // no publisher is called and the original payload/history is preserved.
  const jobs=await migrateHeldJobs(db,apply);
  return {applied:apply,patch,jobs};
}
module.exports = { correctionPatch, migrate, migrateHeldJobs, heldJobPatch };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(a => !['--apply', '--project=blastybiz-9523e'].includes(a)) || !args.includes('--project=blastybiz-9523e')) {
    throw Error('Explicit --project=blastybiz-9523e required; optional --apply');
  }
  const admin = require('../functions/node_modules/firebase-admin');
  admin.initializeApp({projectId:'blastybiz-9523e'});
  migrate(admin.firestore(), args.includes('--apply')).then(result => console.log(JSON.stringify(result,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
