'use strict';
const {requireVerifier,validHash}=require('./oauth-binding');
const { randomUUID } = require('node:crypto');
const { META_GRAPH_BASE, providerId } = require('./provider-api');
const fail = (status, message) => { throw Object.assign(Error(message), {httpStatus:status}); };
const millis = value => value?.toMillis?.() || (value instanceof Date ? value.getTime() : Date.parse(value)) || 0;
function createOAuthSelection({db, admin, axios, clock=()=>Date.now()}) {
  const linkedin=require('./linkedin').createLinkedIn({axios});
  const requests=require('./facebook-authorization').createFacebookAuthorization({db,clock});
  const nonceRef = id => {
    if (!providerId(id)) fail(400, 'Invalid connection request.');
    return db.collection('oauthNonces').doc(id);
  };
  const business = p => db.doc(`users/${p.uid}/businesses/${p.businessId}`);
  const validate = (p, uid, verifier) => {
    if (!p || p.phase !== 'selection' || p.uid !== uid || millis(p.expiresAt) <= clock()) fail(403, 'This connection request has expired or belongs to another account. Please reconnect.');
    requireVerifier(p,verifier);
    if (millis(p.tokenExpiresAt)<=clock()) fail(403, 'Provider access has expired. Please reconnect.');
    if (!providerId(p.businessId) || !providerId(p.uid)) fail(400, 'Invalid business.');
  };
  // Follow cursors on our fixed provider endpoint, never provider-supplied URLs.
  async function pages(url, params, key, headers={}, meta=false) {
    const rows=[], seen=new Set(); let cursor;
    do {
      const r=await axios.get(url,{headers,params:{...params,...(cursor?{[meta?'after':'pageToken']:cursor}:{})},timeout:20000});
      const list=r.data?.[key];
      if (!Array.isArray(list) && list !== undefined) throw Error('Invalid provider response.');
      rows.push(...(list||[]));
      cursor=meta?(r.data.paging?.next ? r.data.paging?.cursors?.after : null):r.data.nextPageToken;
      if (meta && r.data.paging?.next && !cursor) throw Error('Provider pagination is incomplete.');
      if (rows.length>500 || (cursor && seen.has(cursor)) || seen.size>=50) throw Error('Too many destinations to safely load. Please narrow access at the provider and reconnect.');
      if (cursor) seen.add(cursor);
    } while(cursor);
    return rows;
  }
  async function googleChoices(accessToken) {
    const headers={Authorization:`Bearer ${accessToken}`};
    const accounts=await pages('https://mybusinessaccountmanagement.googleapis.com/v1/accounts',{},'accounts',headers);
    const choices=[], seen=new Set();
    for (const account of accounts) {
      const accountId=account.name?.match(/^accounts\/([A-Za-z0-9_-]+)$/)?.[1];
      if (!providerId(accountId)) continue;
      const locations=await pages(`https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations`,{readMask:'name,title,storefrontAddress',pageSize:100},'locations',headers);
      for (const location of locations) {
        const locationId=location.name?.match(/^locations\/([A-Za-z0-9_-]+)$/)?.[1];
        if (!providerId(locationId)) continue;
        const id=accountId+'_'+locationId;
        if (seen.has(id)) continue; seen.add(id);
        const address=(location.storefrontAddress?.addressLines||[]).join(', ');
        choices.push({id,accountId,locationId,label:[location.title||locationId,address,account.accountName||accountId].filter(Boolean).join(' — ')});
      }
      if (choices.length>500) throw Error('Too many Google locations. Narrow access and reconnect.');
    }
    return choices;
  }
  async function facebookChoices(userToken) {
    const grants=await axios.get(META_GRAPH_BASE+'/me/permissions',{params:{access_token:userToken},timeout:20000});
    const granted=new Set((grants.data.data||[]).filter(p=>p.status==='granted').map(p=>p.permission));
    if (!['pages_show_list','pages_read_engagement','pages_manage_posts'].every(p=>granted.has(p))) throw Error('Allow Page listing, reading and publishing permissions to connect Facebook.');
    const list=await pages(META_GRAPH_BASE+'/me/accounts',{access_token:userToken,fields:'id,name,access_token,tasks',limit:100},'data',{},true);
    const seen=new Set();
    return list.filter(p=>providerId(p.id)&&p.access_token&&Array.isArray(p.tasks)&&p.tasks.includes('CREATE_CONTENT')&&!seen.has(p.id)&&seen.add(p.id))
      .map(p=>({id:p.id,pageId:p.id,label:p.name||p.id,accessToken:p.access_token,instagramAuthorized:granted.has('instagram_basic')&&granted.has('instagram_content_publish')}));
  }
  async function prepare(p) {
    if(!validHash(p.verifierHash)||!providerId(p.state)) fail(400,'Missing browser binding. Please reconnect.');
    if(p.authorizationRequest){
      const request=await requests.load(p.authorizationRequest,p.uid,p.businessId);
      if(p.platform!=='facebook')fail(400,'This authorization is for Facebook.');
      p={...p,...(request.requiredPlatform==='instagram'?{requiredPlatform:'instagram',instagramUsername:request.instagramUsername}:{}),expectedPageId:request.pageId,pageName:request.pageName,choices:p.choices.filter(c=>c.id===request.pageId&&c.pageId===request.pageId)};
    }
    if (!p.choices.length&&!p.authorizationRequest) fail(409, 'No eligible destination was found. Check your provider permissions and reconnect.');
    if (Buffer.byteLength(JSON.stringify(p))>800000) fail(409,'Too many destinations. Narrow access and reconnect.');
    const id=randomUUID();
    await nonceRef(id).set({...p,phase:'selection',expiresAt:new Date(clock()+10*60*1000)});
    return id;
  }
  async function inspect(id, uid, verifier) {
    const p=(await nonceRef(id).get()).data(); validate(p,uid,verifier);
    if (!(await business(p).get()).exists) fail(404,'Business no longer exists.');
    if(p.authorizationRequest)await requests.load(p.authorizationRequest,uid,p.businessId);
    return {businessId:p.businessId,platform:p.platform,returnTo:p.returnTo||'',...(p.requiredPlatform==='instagram'?{requiredPlatform:'instagram',instagramUsername:p.instagramUsername||''}:{}),...(p.authorizationRequest?{authorizationRequest:p.authorizationRequest,expectedPageId:p.expectedPageId,pageName:p.pageName}:{}),choices:p.choices.map(c=>({id:c.id,label:c.label}))};
  }
  async function cancel(id,uid,verifier) {
    const ref=nonceRef(id);
    return db.runTransaction(async tx=>{
      const p=(await tx.get(ref)).data();
      if(!p)return {cancelled:true}; // Safe, idempotent retry after deletion.
      if(p.uid!==uid || p.phase!=='selection')fail(403,'This connection request belongs to another account.');
      requireVerifier(p,verifier);
      tx.delete(ref); // Owner can discard even an expired choice immediately.
      return {cancelled:true};
    });
  }
  async function confirm(id, uid, choiceId, verifier) {
    const ref=nonceRef(id), p=(await ref.get()).data(); validate(p,uid,verifier);
    const choice=p.choices.find(c=>c.id===choiceId);
    if (!choice) fail(400,'Choose one of the available destinations.');
    if(p.authorizationRequest){
      const request=await requests.load(p.authorizationRequest,uid,p.businessId);
      if(p.platform!=='facebook'||choice.pageId!==request.pageId||choice.id!==request.pageId)fail(409,'Facebook has not granted access to the requested Page.');
    }
    if(p.platform==='linkedin')await linkedin.verify(p.accessToken,choice);
    let igUserId='',igUsername='';
    if (p.platform==='facebook') {
      if(p.requiredPlatform==='instagram'&&!choice.instagramAuthorized)fail(409,'Instagram access was not granted. In Meta, edit previous settings and include your Instagram account before confirming. Your saved Facebook connection is unchanged.');
      // A failed lookup is not evidence that a Page has no Instagram account.
      const r=await axios.get(META_GRAPH_BASE+'/'+choice.pageId,{params:{fields:choice.instagramAuthorized?(p.requiredPlatform==='instagram'?'id,instagram_business_account{id,username}':'id,instagram_business_account'):'id',access_token:choice.accessToken},timeout:20000});
      if (r.data.id!==choice.pageId) fail(409,'Facebook returned a different Page. Reconnect.');
      igUserId=choice.instagramAuthorized?(r.data.instagram_business_account?.id||''):'';
      igUsername=String(r.data.instagram_business_account?.username||'').toLowerCase();
      if(p.requiredPlatform==='instagram'&&!igUserId)fail(409,'Meta has not exposed your Instagram account for this Page. In Instagram, open Edit profile → Facebook and finish linking this Page; in Meta permissions include your Instagram account. Then retry this confirmation. Facebook is already saved.');
      if(p.requiredPlatform==='instagram'&&p.instagramUsername&&igUsername!==p.instagramUsername)fail(409,'Meta returned a different Instagram account. Select @'+p.instagramUsername+' and this Facebook Page.');
      if (igUserId && !providerId(igUserId)) fail(409,'Invalid linked Instagram account.');
    }
    await db.runTransaction(async tx=>{
      const fresh=(await tx.get(ref)).data(); validate(fresh,uid,verifier);
      if (!fresh.choices.some(c=>c.id===choiceId)) fail(409,'Connection choice changed. Reconnect.');
      const br=business(p); if (!(await tx.get(br)).exists) fail(404,'Business no longer exists.');
      let requestRef;
      if(p.authorizationRequest){
        requestRef=requests.ref(p.authorizationRequest);
        const request=requests.validate((await tx.get(requestRef)).data(),uid,p.businessId);
        if(choice.pageId!==request.pageId||fresh.authorizationRequest!==p.authorizationRequest||request.requiredPlatform!==p.requiredPlatform||request.instagramUsername!==p.instagramUsername)fail(409,'Authorization request changed. Reconnect.');
      }
      const cr=br.collection('platformConnections').doc(p.platform);
      const common={uid,businessId:p.businessId,platform:p.platform,status:'connected',expiresAt:p.platform==='google'?p.tokenExpiresAt:null,...(p.platform==='facebook'?{userTokenExpiresAt:p.tokenExpiresAt}:{}),connectedAt:admin.firestore.FieldValue.serverTimestamp()};
      if(p.platform==='google') {
        tx.set(cr,{...common,accountId:choice.accountId,locationId:choice.locationId,locationName:choice.label},{merge:true});
        tx.set(cr.collection('private').doc('tokens'),{accessToken:p.accessToken,refreshToken:p.refreshToken||''});
      } else if(p.platform==='facebook') {
        tx.set(cr,{...common,pageId:choice.pageId,pageName:choice.label,instagramAuthorized:choice.instagramAuthorized,allPages:admin.firestore.FieldValue.delete()},{merge:true});
        tx.set(cr.collection('private').doc('tokens'),{accessToken:choice.accessToken,userAccessToken:p.userAccessToken});
        const ir=br.collection('platformConnections').doc('instagram');
        if(igUserId) {
          tx.set(ir,{...common,platform:'instagram',igUserId,pageId:choice.pageId,...(igUsername?{igUsername,username:igUsername,profileUrl:'https://www.instagram.com/'+igUsername+'/'}:{})},{merge:true});
          tx.set(ir.collection('private').doc('tokens'),{accessToken:choice.accessToken});
        } else {
          tx.set(ir,{uid,businessId:p.businessId,platform:'instagram',status:'disconnected',igUserId:'',pageId:choice.pageId,disconnectedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
          tx.delete(ir.collection('private').doc('tokens'));
        }
      } else if(p.platform==='linkedin') {
        tx.set(cr,{...common,organizationId:choice.organizationId,organizationUrn:choice.organizationUrn,pageName:choice.label,expiresAt:p.tokenExpiresAt},{merge:true});
        tx.set(cr.collection('private').doc('tokens'),{accessToken:p.accessToken});
      } else fail(400,'Unsupported provider.');
      if(p.platform==='google')tx.create(db.collection('importJobs').doc('google-'+id),{status:'queued',uid,bizId:p.businessId,queuedAt:admin.firestore.FieldValue.serverTimestamp()});
      if(requestRef)tx.update(requestRef,{status:'connected',connectedAt:admin.firestore.FieldValue.serverTimestamp()});
      tx.delete(ref); // Choice and credentials are consumed atomically.
    });
    return {businessId:p.businessId,platform:p.requiredPlatform==='instagram'?'instagram':p.platform,returnTo:p.returnTo||'',...(p.authorizationRequest?{authorizationRequest:p.authorizationRequest}:{})};
  }
  return {googleChoices,facebookChoices,prepare,inspect,confirm,cancel};
}
module.exports={createOAuthSelection};


