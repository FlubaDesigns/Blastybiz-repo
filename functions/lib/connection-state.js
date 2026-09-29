'use strict';
function timeKey(value) {
  if(value == null)return '';
  if(typeof value.seconds==='number')return value.seconds+':'+(value.nanoseconds||0);
  if(typeof value._seconds==='number')return value._seconds+':'+(value._nanoseconds||0);
  return String(value.toMillis?.() ?? (value instanceof Date ? value.getTime() : Date.parse(value)));
}
function sameConnection(expected,current) {
  return !!current && current.status==='connected' && timeKey(expected.connectedAt)===timeKey(current.connectedAt) &&
    ['accountId','locationId','pageId','igUserId'].every(k=>(expected[k]||'')===(current[k]||''));
}
// A reconnect replaces credentials and connectedAt atomically. Never merge a
// refresh from an older grant over that replacement; return its current binding.
async function saveGoogleRefresh(db,admin,ref,expected,accessToken,expiresAt) {
  if(!accessToken)throw Error('Google refresh returned no access token.');
  return db.runTransaction(async tx=>{
    const current=(await tx.get(ref)).data();
    const tokenRef=ref.collection('private').doc('tokens');
    if(!sameConnection(expected,current)) {
      const tokens=(await tx.get(tokenRef)).data()||{};
      return {changed:true,connection:current?{...current,...tokens}:null};
    }
    tx.set(tokenRef,{accessToken},{merge:true});
    tx.update(ref,{...(expiresAt?{expiresAt}:{}),updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    return {changed:false,connection:{...current,accessToken}};
  });
}
module.exports={sameConnection,saveGoogleRefresh};
