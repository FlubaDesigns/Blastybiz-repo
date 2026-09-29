'use strict';
// One transaction repairs pointers before retryable recursive cleanup.
async function deleteBusinessData(db, uid, bizId, {allowLast=false}={}) {
    const userRef = db.collection('users').doc(uid);
    const businesses = userRef.collection('businesses');
    const bizRef = businesses.doc(bizId);
    // Remove the parent and repair account pointers together. A cleanup retry
    // also works when the parent was already removed by an earlier request.
    const activeBusiness = await db.runTransaction(async tx => {
      const userSnap = await tx.get(userRef);
      const owned = await tx.get(businesses);
      if (!userSnap.exists) throw Object.assign(new Error('Account not found'), { httpStatus: 404 });
      const remaining = owned.docs.filter(d => d.id !== bizId).map(d => d.id).sort();
      if (!allowLast && owned.docs.some(d => d.id === bizId) && !remaining.length) {
        throw Object.assign(new Error('You need at least one business.'), { httpStatus: 409 });
      }
      const current = userSnap.data().activeBusiness;
      const next = remaining.includes(current) ? current : (remaining[0] || null);
      tx.delete(bizRef);
      tx.update(userRef, { activeBusiness: next, businessIds: remaining });
      return next;
    });
    await db.recursiveDelete(bizRef);
    return activeBusiness;
}
module.exports={deleteBusinessData};
