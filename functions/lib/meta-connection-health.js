'use strict';
const {META_GRAPH_BASE,providerId}=require('./provider-api');
const timeKey=v=>v?.seconds!==undefined?`${v.seconds}:${v.nanoseconds||0}`:v?String(v.toMillis?.()??v.stamp??(v instanceof Date?v.getTime():Date.parse(v))):'';
function sameBinding(a,b){return !!b&&a.status===b.status&&timeKey(a.connectedAt)===timeKey(b.connectedAt)&&['pageId','igUserId'].every(k=>(a[k]||'')===(b[k]||''));}
// User-grant expiry is not Page-token expiry. Ask the provider about the exact
// saved destination; network/rate-limit/server failures are not revocation.
async function checkMetaDestination({platform,connection,accessToken,axios}){
 if(!['facebook','instagram'].includes(platform))throw Error('Unsupported Meta platform');
 if(!accessToken||!providerId(connection.pageId)||(platform==='instagram'&&!providerId(connection.igUserId)))return {state:'invalid',reason:'missing_binding'};
 try{
  const response=await axios.get(META_GRAPH_BASE+'/'+connection.pageId,{headers:{Authorization:'Bearer '+accessToken},params:{fields:platform==='instagram'?'id,instagram_business_account':'id'},timeout:20000});
  if(response.data?.id!==connection.pageId)return {state:'invalid',reason:'destination_changed'};
  if(platform==='instagram'&&response.data.instagram_business_account?.id!==connection.igUserId)return {state:'invalid',reason:'destination_changed'};
  return {state:'valid',reason:'provider_verified'};
 }catch(error){
  const status=error.response?.status,code=error.response?.data?.error?.code;
  if([400,401,403].includes(status)&&[102,190,10,200].includes(code))return {state:'invalid',reason:'provider_rejected',providerStatus:status,providerCode:code};
  return {state:'unknown',reason:'verification_unavailable',...(Number.isInteger(status)?{providerStatus:status}:{})};
 }
}
// A concurrent reconnect/disconnect or token rotation always wins. This writes
// connection metadata only: never credentials, jobs, schedules, or approvals.
async function saveVerifiedMetaConnection({db,admin,ref,expected,accessToken,allowExpired=false}){
 if(expected.status!=='connected'&&!(allowExpired&&expected.status==='expired'))return false;
 return db.runTransaction(async tx=>{
  const current=(await tx.get(ref)).data();
  const tokens=(await tx.get(ref.collection('private').doc('tokens'))).data()||{};
  if(!sameBinding(expected,current)||tokens.accessToken!==accessToken)return false;
  tx.update(ref,{status:'connected',expiresAt:null,userTokenExpiresAt:current.userTokenExpiresAt||current.expiresAt||null,credentialVerifiedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp()});
  return true;
 });
}
module.exports={checkMetaDestination,saveVerifiedMetaConnection,sameBinding};
