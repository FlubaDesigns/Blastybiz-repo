/**
 * BlastyBiz — OAuth endpoints and platform connection management
 * initiateGoogleOAuth, googleOAuthCallback, initiateFacebookOAuth, facebookOAuthCallback,
 * disconnectPlatform, checkPlatformTokenExpiry
 */
'use strict';
const {sameConnection,saveGoogleRefresh}=require('../lib/connection-state');
const {checkMetaDestination,saveVerifiedMetaConnection}=require('../lib/meta-connection-health');
const {metaRevokeToken,revokeMeta}=require('../lib/meta-revoke');
const { META_GRAPH_VERSION, META_GRAPH_BASE, providerId, googlePostsUrl } = require('../lib/provider-api');

const {
  onRequest, onSchedule, admin, db, axios,
  APP_BASE_URL, ALLOWED_ORIGINS, sendResendEmail,
  userBizRef, userBizConnsRef,
  _getConnTokens, _setConnTokens,
  checkUidRateLimit, setCors, withAuth, verifyBearer,
  makeUnsubSig, _unsubSecret,
} = require('../lib/shared');

const selection = require('../lib/oauth-selection').createOAuthSelection({db,admin,axios});
const {createOAuthBinding,validHash,cookieName}=require('../lib/oauth-binding');
const binding=createOAuthBinding({db});
const facebookAuthorization=require('../lib/facebook-authorization').createFacebookAuthorization({db});
function connectionUrl(platform, businessId, uid, returnTo, extra={}, appOrigin=APP_BASE_URL) {
  const {selection,state,...query}=extra;
  return appOrigin + '/BlastyBiz-Connected.html?' + new URLSearchParams({connected:platform,bizId:businessId,ownerUid:uid,...(returnTo==='onboarding'?{returnTo}:{}),...(selection?{pending:'1'}:{}),...query}) + (selection?'#'+new URLSearchParams({selection,state}):'');
}
// Top-level POST establishes a first-party callback cookie, including on browsers
// that block third-party cookies. The same-origin bridge never puts its secret in a URL.
exports.oauthStart = onRequest({invoker:'public',region:'us-central1'},async (req,res)=>{
  setCors(req,res);
  if(req.method==='OPTIONS')return res.status(204).send('');
  res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
  if(req.method!=='POST')return res.status(405).send('POST only');
  try {
    const result=await binding.start(req.body?.state,req.body?.verifier,req.headers?.origin);
    res.set('Set-Cookie',result.cookie);return res.redirect(303,result.url);
  }catch(e){return res.status(403).send('Connection could not start. Return to BlastyBiz and reconnect in the same browser tab.');}
});
exports.oauthDestination = onRequest({invoker:'public'}, withAuth(async (req,res,decoded)=>{
  res.set('Cache-Control','no-store');
  try {
    if (req.method!=='POST') return res.status(405).json({error:'POST only'});
    const input=req.body||{};
    const result=input.action==='authorizationRequest'?await facebookAuthorization.inspect(input.requestId,decoded.uid,input.businessId):input.action==='inspect'?await selection.inspect(input.selection,decoded.uid,input.verifier):input.cancel===true?await selection.cancel(input.selection,decoded.uid,input.verifier):await selection.confirm(input.selection,decoded.uid,input.choiceId,input.verifier);
    return res.json(result);
  } catch(e) {
    return res.status(e.httpStatus||502).json({error:e.httpStatus?e.message:'Could not verify the provider destination. Reconnect or try again.'});
  }
}));

exports.initiateGoogleOAuth = onRequest({ invoker: 'public', secrets: ['GOOGLE_CLIENT_ID'] }, withAuth(async (req, res, decoded) => {
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  const uid = decoded.uid;
  const { businessId, returnTo, verifierHash } = req.query;
  const appOrigin=req.headers?.origin;
  if(!ALLOWED_ORIGINS.has(appOrigin)||!validHash(verifierHash))return res.status(400).json({error:'Start this connection from BlastyBiz in the same browser tab.'});
  if (!providerId(businessId)) { res.status(400).json({ error: 'Invalid businessId' }); return; }
  if (!(await checkUidRateLimit('oauthInitRateLimit', uid, 20, 60 * 60 * 1000))) {
    return res.status(429).json({ error: 'Too many connection attempts. Please try again in an hour.' });
  }
  const bizSnap = await userBizRef(uid, businessId).get();
  if (!bizSnap.exists) { return res.status(403).json({ error: 'Forbidden' }); }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) { res.status(503).json({ error: 'Google OAuth not configured' }); return; }
  const nonce = require('crypto').randomUUID();
  const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/googleOAuthCallback';
  const scope = 'https://www.googleapis.com/auth/business.manage';
  const url =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&access_type=offline&prompt=consent` +
    `&state=${encodeURIComponent(nonce)}`;
  await db.collection('oauthNonces').doc(nonce).set({
    uid,businessId,platform:'google',phase:'start',appOrigin,verifierHash,authorizationUrl:url,
    returnTo:returnTo==='onboarding'?returnTo:'',expiresAt:new Date(Date.now()+10*60*1000)
  });
  res.set('Cache-Control','no-store');
  res.json({state:nonce,url:appOrigin+'/BlastyBiz-OAuth-Start.html?state='+encodeURIComponent(nonce)});
}));

exports.googleOAuthCallback = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  let businessId, uid, returnTo, appOrigin, verifierHash;
  res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
  try { ({businessId,uid,returnTo,appOrigin,verifierHash} = await binding.consume(state, 'google',req.headers?.cookie)); }
  catch(e) { return res.status(400).send('Invalid or expired OAuth state. Please try connecting again.'); }
  res.set('Set-Cookie',`${cookieName(state)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  const errorRedirect = connectionUrl('google',businessId,uid,returnTo,{error:'google'},appOrigin);
  if (!code) return res.redirect(errorRedirect);

  try {
    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', null, {
      params: {
        code, client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://us-central1-blastybiz-9523e.cloudfunctions.net/googleOAuthCallback',
        grant_type: 'authorization_code'
      }
    });
    const { access_token, refresh_token, expires_in } = tokenResp.data;

    if (!access_token) throw Error('Google did not return an access token.');
    const choices=await selection.googleChoices(access_token);
    const selectionId=await selection.prepare({uid,businessId,returnTo,verifierHash,state,platform:'google',choices,accessToken:access_token,refreshToken:refresh_token||'',tokenExpiresAt:new Date(Date.now()+(expires_in||3600)*1000)});
    // Even one destination requires authenticated, same-tab confirmation.
    res.redirect(connectionUrl('google',businessId,uid,returnTo,{selection:selectionId,state},appOrigin));
  } catch(e) {
    console.error('googleOAuthCallback failed:', e.response?.status || e.httpStatus || 'provider_error');
    res.redirect(errorRedirect);
  }
});

exports.initiateFacebookOAuth = onRequest({ invoker: 'public', secrets: ['FACEBOOK_APP_ID'] }, withAuth(async (req, res, decoded) => {
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  const uid = decoded.uid;
  const { businessId, returnTo, verifierHash, authorizationRequest } = req.query;
  const appOrigin=req.headers?.origin;
  if(!ALLOWED_ORIGINS.has(appOrigin)||!validHash(verifierHash))return res.status(400).json({error:'Start this connection from BlastyBiz in the same browser tab.'});
  if (!providerId(businessId)) { res.status(400).json({ error: 'Invalid businessId' }); return; }
  if (!(await checkUidRateLimit('oauthInitRateLimit', uid, 20, 60 * 60 * 1000))) {
    return res.status(429).json({ error: 'Too many connection attempts. Please try again in an hour.' });
  }
  const bizSnap = await userBizRef(uid, businessId).get();
  if (!bizSnap.exists) { return res.status(403).json({ error: 'Forbidden' }); }
  if(authorizationRequest!==undefined){
    try { await facebookAuthorization.load(authorizationRequest,uid,businessId); }
    catch(e){return res.status(e.httpStatus||503).json({error:e.httpStatus?e.message:'Authorization request is unavailable. Try again.'});}
  }
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) { res.status(503).json({ error: 'Facebook OAuth not configured' }); return; }
  const nonce = require('crypto').randomUUID();
  const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/facebookOAuthCallback';
  const scope = 'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish';
  const url =
    `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    (authorizationRequest?'&auth_type=rerequest':'') +
    `&state=${encodeURIComponent(nonce)}`;
  await db.collection('oauthNonces').doc(nonce).set({
    uid,businessId,platform:'facebook',phase:'start',appOrigin,verifierHash,authorizationUrl:url,
    ...(authorizationRequest?{authorizationRequest}:{}),
    returnTo:returnTo==='onboarding'?returnTo:'',expiresAt:new Date(Date.now()+10*60*1000)
  });
  res.set('Cache-Control','no-store');
  res.json({state:nonce,url:appOrigin+'/BlastyBiz-OAuth-Start.html?state='+encodeURIComponent(nonce)});
}));

exports.facebookOAuthCallback = onRequest({ invoker: 'public', region: 'us-central1', secrets: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] }, async (req, res) => {
  const { code, state } = req.query;
  let businessId, uid, returnTo, appOrigin, verifierHash, authorizationRequest;
  res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
  try { ({businessId,uid,returnTo,appOrigin,verifierHash,authorizationRequest} = await binding.consume(state, 'facebook',req.headers?.cookie)); }
  catch(e) { return res.status(400).send('Invalid or expired OAuth state. Please try connecting again.'); }
  res.set('Set-Cookie',`${cookieName(state)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  const errorRedirect = connectionUrl('facebook',businessId,uid,returnTo,{error:'facebook',...(authorizationRequest?{authorizationRequest}:{})},appOrigin);
  if (!code) return res.redirect(errorRedirect);

  try {
    const redirectUri = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/facebookOAuthCallback';
    const tokenResp = await axios.get(META_GRAPH_BASE + '/oauth/access_token', {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: redirectUri, code
      }
    });
    const { access_token: shortLivedToken } = tokenResp.data;

    const longLivedResp = await axios.get(META_GRAPH_BASE + '/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        fb_exchange_token: shortLivedToken
      }
    });
    const longLivedToken = longLivedResp.data.access_token;
    const expiresIn = longLivedResp.data.expires_in || (60 * 24 * 3600);
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    if (!longLivedToken) throw Error('Facebook did not return an access token.');
    const choices=await selection.facebookChoices(longLivedToken);
    const selectionId=await selection.prepare({uid,businessId,returnTo,verifierHash,state,...(authorizationRequest?{authorizationRequest}:{}),platform:'facebook',choices,userAccessToken:longLivedToken,tokenExpiresAt:expiresAt});
    // Even one destination requires authenticated, same-tab confirmation.
    res.redirect(connectionUrl('facebook',businessId,uid,returnTo,{selection:selectionId,state,...(authorizationRequest?{authorizationRequest}:{})},appOrigin));
  } catch(e) {
    console.error('facebookOAuthCallback failed:', e.response?.status || e.httpStatus || 'provider_error');
    res.redirect(errorRedirect);
  }
});

exports.disconnectPlatform = onRequest(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  try {
    const decoded = await verifyBearer(req);
    const { bizId, platformId } = req.body;
    if (!providerId(bizId) || !platformId) return res.status(400).json({ error: 'Missing bizId or platformId' });
    if (!['google', 'facebook', 'instagram'].includes(platformId)) {
      return res.status(400).json({ error: 'Invalid platformId' });
    }

    const connRef = db.collection('users').doc(decoded.uid)
      .collection('businesses').doc(bizId)
      .collection('platformConnections').doc(platformId);
    const connSnap = await connRef.get();
    if (!connSnap.exists) return res.status(404).json({ error: 'Connection not found' });
    const privTokens = await _getConnTokens(connRef);
    const conn = { ...connSnap.data(), ...privTokens };

    if (platformId === 'google') {
      for (const tok of [conn.accessToken, conn.refreshToken].filter(Boolean)) {
        try {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: 'POST' });
        } catch(e) { console.warn('[disconnectPlatform] Google revoke failed:', e.message); }
      }
    }
    if (platformId === 'facebook' || platformId === 'instagram') {
      const token=await metaRevokeToken(connRef,platformId,privTokens,_getConnTokens);
      await revokeMeta(token,fetch,console.warn);
    }

    await connRef.update({ status: 'disconnected', disconnectedAt: admin.firestore.FieldValue.serverTimestamp() });
    await connRef.collection('private').doc('tokens').delete();

    if (platformId === 'facebook' || platformId === 'instagram') {
      const igRef = db.collection('users').doc(decoded.uid)
        .collection('businesses').doc(bizId)
        .collection('platformConnections').doc(platformId === 'facebook' ? 'instagram' : 'facebook');
      const igSnap = await igRef.get();
      if (igSnap.exists) {
        await igRef.update({ status: 'disconnected', disconnectedAt: admin.firestore.FieldValue.serverTimestamp() });
        await igRef.collection('private').doc('tokens').delete();
      }
    }

    res.json({ ok: true });
  } catch(e) {
    console.error('[disconnectPlatform]', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

exports.checkPlatformTokenExpiry = onSchedule(
  {
    schedule: 'every 30 minutes',
    region: 'us-central1',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  },
  async () => {
    // OAuth selections contain private credentials; erase abandoned expired choices.
    const abandoned=await db.collection('oauthNonces').where('expiresAt','<=',new Date()).limit(200).get();
    if(!abandoned.empty){const cleanup=db.batch();abandoned.docs.forEach(d=>cleanup.delete(d.ref));await cleanup.commit();}
    const cutoffShort = new Date(Date.now() + 5 * 60 * 1000);

    let tmplSubject = null, tmplHtml = null;
    try {
      const tmplSnap = await db.collection('emailTemplates')
        .where('type', '==', 'platform-expired').where('active', '==', true).limit(1).get();
      if (!tmplSnap.empty) {
        tmplSubject = tmplSnap.docs[0].data().subject;
        tmplHtml    = tmplSnap.docs[0].data().html;
      }
    } catch(e) { console.error('[checkPlatformTokenExpiry] template fetch failed:', e.message); }

    const snap = await db.collectionGroup('platformConnections')
      .where('status', '==', 'connected')
      .get();

    let refreshed = 0, expired = 0, skipped = 0;
    const toNotify = [];

    for (const docSnap of snap.docs) {
      const parts=docSnap.ref.path.split('/');
      if(parts.length!==6 || parts[0]!=='users' || parts[2]!=='businesses' || parts[4]!=='platformConnections' || !['google','facebook','instagram'].includes(docSnap.id)){skipped++;continue;}
      // Document fields are historical/client data; paths define ownership/provider.
      const conn = {...docSnap.data(),uid:parts[1],businessId:parts[3],platform:docSnap.id};

      const isFbOrIg = conn.platform === 'facebook' || conn.platform === 'instagram';
      const privTokens = await _getConnTokens(docSnap.ref);
      if (isFbOrIg) {
        const health=await checkMetaDestination({platform:conn.platform,connection:conn,accessToken:privTokens.accessToken,axios});
        console.log('META_CONNECTION_CHECK '+JSON.stringify({platform:conn.platform,...health}));
        if(health.state==='valid') {
          const saved=await saveVerifiedMetaConnection({db,admin,ref:docSnap.ref,expected:conn,accessToken:privTokens.accessToken});
          if(saved)refreshed++;else skipped++;
          continue;
        }
        if(health.state==='unknown'){skipped++;continue;}
        // Only an actual invalid binding/provider rejection may reach expiry.
      } else if (!conn.expiresAt) { skipped++; continue; }
      const expiresAt = isFbOrIg ? new Date(0) : (conn.expiresAt.toDate ? conn.expiresAt.toDate() : new Date(conn.expiresAt));
      if (!isFbOrIg && expiresAt > cutoffShort) { skipped++; continue; }
      const igRef = docSnap.ref.parent.parent.collection('platformConnections').doc('instagram');

      if (conn.platform === 'facebook' && privTokens.accessToken) {
        try {
          // Exchange the stored USER token, then reacquire the token for this exact Page.
          // Only attempt renewal after the existing Page credential was rejected.
          if (!privTokens.userAccessToken || !providerId(conn.pageId)) throw Error('Reconnect Facebook to refresh this Page.');
          const resp=await axios.get(META_GRAPH_BASE+'/oauth/access_token',{params:{grant_type:'fb_exchange_token',client_id:process.env.FACEBOOK_APP_ID,client_secret:process.env.FACEBOOK_APP_SECRET,fb_exchange_token:privTokens.userAccessToken},timeout:20000});
          const userToken=resp.data.access_token;
          if(!userToken)throw Error('Facebook refresh returned no user token.');
          const page=await axios.get(META_GRAPH_BASE+'/'+conn.pageId,{params:{fields:conn.instagramAuthorized===false?'id,access_token':'id,access_token,instagram_business_account',access_token:userToken},timeout:20000});
          if(page.data.id!==conn.pageId || !page.data.access_token)throw Error('Facebook Page access is no longer available.');
          const newExpiresAt=new Date(Date.now()+(resp.data.expires_in||60*24*3600)*1000);
          await db.runTransaction(async tx=>{
            const current=await tx.get(docSnap.ref),igSnap=await tx.get(igRef);
            if(!sameConnection(conn,current.data()))throw Error('Connection changed during refresh.');
            tx.set(docSnap.ref.collection('private').doc('tokens'),{accessToken:page.data.access_token,userAccessToken:userToken});
            tx.update(docSnap.ref,{expiresAt:null,userTokenExpiresAt:newExpiresAt,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
            if(igSnap.exists && igSnap.data().status==='connected') {
              const ig=igSnap.data();
              if(conn.instagramAuthorized!==false && ig.pageId===conn.pageId && ig.igUserId===page.data.instagram_business_account?.id) {
                tx.set(igRef.collection('private').doc('tokens'),{accessToken:page.data.access_token});
                tx.update(igRef,{expiresAt:null,userTokenExpiresAt:newExpiresAt,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
              } else {
                tx.update(igRef,{status:'disconnected',disconnectedAt:admin.firestore.FieldValue.serverTimestamp()});
                tx.delete(igRef.collection('private').doc('tokens'));
              }
            }
          });

          refreshed++;
          continue;
        } catch (e) {
          console.warn(`[checkPlatformTokenExpiry] Facebook refresh failed for biz ${conn.businessId}:`,
            Number.isInteger(e.response?.status) ? e.response.status : 'provider_error');
          // A failed proactive refresh does not invalidate a still-valid grant.
        }
      }

      if (conn.platform === 'google' && privTokens.refreshToken) {
        try {
          const resp = await axios.post('https://oauth2.googleapis.com/token', null, {
            params: {
              client_id:     process.env.GOOGLE_CLIENT_ID,
              client_secret: process.env.GOOGLE_CLIENT_SECRET,
              refresh_token: privTokens.refreshToken,
              grant_type:    'refresh_token',
            },
          });
          const { access_token, expires_in } = resp.data;
          const saved=await saveGoogleRefresh(db,admin,docSnap.ref,conn,access_token,new Date(Date.now()+(expires_in||3600)*1000));
          if(saved.changed)throw Error('Connection changed during refresh.');
          console.log(`[checkPlatformTokenExpiry] Refreshed Google token for ${docSnap.id}`);
          refreshed++;
          continue;
        } catch (e) {
          console.warn(`[checkPlatformTokenExpiry] Google refresh failed for ${docSnap.id}:`,
            Number.isInteger(e.response?.status) ? e.response.status : 'provider_error');
        }
      }

      if(expiresAt.getTime()>Date.now()){skipped++;continue;}
      try {
        // Re-read both generation and expiry: another worker may have refreshed
        // or the owner may have reconnected while this network call was pending.
        const marked=await db.runTransaction(async tx=>{
          const current=(await tx.get(docSnap.ref)).data();
          const expiry=current?.expiresAt?.toMillis?.() || new Date(current?.expiresAt).getTime();
          const currentTokens=(await tx.get(docSnap.ref.collection('private').doc('tokens'))).data()||{};
          if(!sameConnection(conn,current) || (isFbOrIg ? currentTokens.accessToken!==privTokens.accessToken : !Number.isFinite(expiry)||expiry>Date.now()))return false;
          tx.update(docSnap.ref,{status:'expired',updatedAt:admin.firestore.FieldValue.serverTimestamp()});
          return true;
        });
        if(!marked){skipped++;continue;}
        expired++;
      } catch(e) {
        console.error(`[checkPlatformTokenExpiry] Failed to mark expired for ${docSnap.id}:`,e.message);
        continue;
      }

      if (conn.uid) toNotify.push({ conn, docId: docSnap.id });
    }

    if (toNotify.length > 0) {
      const _uniqueUids  = [...new Set(toNotify.map(n => n.conn.uid))];
      const _userRefs    = _uniqueUids.map(uid => db.collection('users').doc(uid));
      const _userDocs    = await db.getAll(..._userRefs);
      const _userDataMap = Object.fromEntries(_userDocs.map(d => [d.id, d.exists ? d.data() : null]));

      for (const { conn, docId } of toNotify) {
        const userData = _userDataMap[conn.uid];
        if (!userData || !userData.email || userData.emailUnsubscribed) continue;

        try {
          const ownerName = userData.ownerName || userData.displayName || '';
          let businessName = '';
          try {
            const bizSnap = await userBizRef(conn.uid, conn.businessId).get();
            businessName = bizSnap.data()?.businessName || '';
          } catch(e) { /* non-fatal */ }

          const platformDisplay = conn.platform === 'google' ? 'Google Business Profile'
            : conn.platform.charAt(0).toUpperCase() + conn.platform.slice(1);

          const unsubUrl = `https://us-central1-blastybiz-9523e.cloudfunctions.net/unsubscribeEmail?uid=${encodeURIComponent(conn.uid)}&sig=${makeUnsubSig(conn.uid, _unsubSecret())}`;
          const connectUrl = `${APP_BASE_URL}/BlastyBiz-Connect.html`;

          const mergeData = {
            name:           ownerName || 'there',
            businessName:   businessName || (ownerName ? ownerName + '\'s Business' : 'your business'),
            platform:       platformDisplay,
            connectUrl,
            appUrl:         APP_BASE_URL,
            unsubscribeUrl: unsubUrl,
          };
          function applyExpiredTags(str) {
            return str.replace(/\{\{(\w+)\}\}/g, (_, k) => mergeData[k] || '');
          }

          const subject = tmplSubject
            ? applyExpiredTags(tmplSubject)
            : `Action needed — your ${platformDisplay} connection expired`;
          const html = tmplHtml
            ? applyExpiredTags(tmplHtml)
            : `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#0d1a0d;padding:28px 32px 22px">
    <img src="https://blastybiz-9523e.web.app/img/blastybiz-title.png" alt="BlastyBiz" width="160" style="display:block;border:0;height:auto" />
    <div style="font-size:11px;color:#4caf50;letter-spacing:3px;margin-top:8px;font-weight:700">LOCK. LOAD. BLAST.</div>
  </div>
  <div style="padding:32px">
    <h1 style="font-size:20px;font-weight:800;color:#0d1a0d;margin:0 0 12px">Your ${platformDisplay} connection needs a quick reconnect, ${mergeData.name}.</h1>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 16px">Your <strong>${platformDisplay}</strong> authorization for <strong>${mergeData.businessName}</strong> has expired. Auto-posting to ${platformDisplay} is paused until you reconnect.</p>
    <p style="font-size:15px;color:#333;line-height:1.75;margin:0 0 24px">It only takes a few seconds — just click the button below and authorize BlastyBiz again.</p>
    <a href="${connectUrl}" style="display:inline-block;background:#00C853;color:#0d1a0d;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:15px">Reconnect ${platformDisplay} &#8594;</a>
    <p style="font-size:13px;color:#888;margin-top:20px;line-height:1.6">Your content and campaigns are all still saved — nothing is lost.</p>
  </div>
  <div style="background:#f7f7f7;padding:16px 32px;border-top:1px solid #e8e8e8">
    <p style="font-size:12px;color:#999;margin:0">&#169; BlastyBiz, a Fluba Designs LLC brand. &bull; <a href="${unsubUrl}" style="color:#999">Unsubscribe</a></p>
  </div>
</div>`;

          await sendResendEmail({ to: userData.email, subject, html });
          console.log(`[checkPlatformTokenExpiry] Sent expiry email to ${userData.email} for ${docId}`);
        } catch(e) {
          console.error(`[checkPlatformTokenExpiry] Email failed for ${docId}:`, e.message);
        }
      }
    }

    console.log(`[checkPlatformTokenExpiry] Done — refreshed: ${refreshed}, expired: ${expired}, skipped: ${skipped}`);
  }
);


