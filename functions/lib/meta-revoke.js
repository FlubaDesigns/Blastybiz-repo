'use strict';
const {META_GRAPH_BASE}=require('./provider-api');
async function metaRevokeToken(ref,platform,tokens,readTokens) {
  if(platform==='instagram') {
    const paired=await readTokens(ref.parent.doc('facebook'));
    return paired.userAccessToken || tokens.userAccessToken || tokens.accessToken;
  }
  return tokens.userAccessToken || tokens.accessToken;
}
async function revokeMeta(token,request=fetch,warn=console.warn) {
  if(!token)return;
  try {
    const response=await request(META_GRAPH_BASE+'/me/permissions?access_token='+encodeURIComponent(token),{method:'DELETE'});
    if(!response.ok)warn('[Meta revoke] Provider rejected revocation (HTTP '+response.status+').');
  } catch(_) { warn('[Meta revoke] Network error while revoking the user grant.'); }
}
module.exports={metaRevokeToken,revokeMeta};
