'use strict';
const {providerId}=require('./provider-api');
const fail=(status,message)=>{throw Object.assign(Error(message),{httpStatus:status});};
const millis=v=>v?.toMillis?.()||(v instanceof Date?v.getTime():Date.parse(v))||0;
function createFacebookAuthorization({db,clock=Date.now}) {
  const ref=id=>{
    if(!providerId(id))fail(400,'Invalid authorization request.');
    return db.collection('oauthNonces').doc(id);
  };
  function validate(p,uid,businessId) {
    if(!p||p.phase!=='authorization-request'||p.schema!=='facebook-page/v1'||p.uid!==uid||!providerId(p.businessId)||!/^\d{5,32}$/.test(p.pageId)||p.businessId!==businessId)fail(403,'Open this authorization with the BlastyBiz account and business it was issued for.');
    if(millis(p.expiresAt)<=clock())fail(410,'This authorization link has expired. Request a new link through the Authorization Engine.');
    if(p.requiredPlatform!==undefined&&p.requiredPlatform!=='instagram')fail(403,'Invalid requested platform.');
    if(p.requiredPlatform==='instagram'&&!/^[a-z0-9._]{1,30}$/.test(p.instagramUsername||''))fail(403,'Invalid requested Instagram account.');
    return p;
  }
  async function load(id,uid,businessId) {
    const p=validate((await ref(id).get()).data(),uid,businessId);
    if(!(await db.doc(`users/${uid}/businesses/${businessId}`).get()).exists)fail(404,'This business is no longer available.');
    if(p.requiredPlatform!==undefined&&p.requiredPlatform!=='instagram')fail(403,'Invalid requested platform.');
    if(p.requiredPlatform==='instagram'&&!/^[a-z0-9._]{1,30}$/.test(p.instagramUsername||''))fail(403,'Invalid requested Instagram account.');
    return p;
  }
  async function inspect(id,uid,businessId) {
    const p=await load(id,uid,businessId);
    const c=(await db.doc(`users/${uid}/businesses/${businessId}/platformConnections/facebook`).get()).data();
    const instagram=p.requiredPlatform==='instagram'?(await db.doc(`users/${uid}/businesses/${businessId}/platformConnections/instagram`).get()).data():null;
    const facebookConnected=c?.status==='connected'&&c.pageId===p.pageId;
    const instagramConnected=instagram?.status==='connected'&&instagram.pageId===p.pageId&&/^\d{5,32}$/.test(instagram.igUserId||'')&&(instagram.igUsername||instagram.username||'').toLowerCase()===p.instagramUsername;
    return {requestId:id,businessId,pageId:p.pageId,pageName:p.pageName,requiredPlatform:p.requiredPlatform||'facebook',instagramUsername:p.instagramUsername||'',
      facebookConnected,connected:p.status==='connected'&&facebookConnected&&(p.requiredPlatform!=='instagram'||instagramConnected)};
  }
  return {ref,validate,load,inspect};
}
module.exports={createFacebookAuthorization};
