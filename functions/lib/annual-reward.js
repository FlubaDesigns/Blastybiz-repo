'use strict';
// BlastyBiz owns eligibility and this one saved claim. QR Gear owns the product,
// personalized packet, fulfillment and tracking. Agency is deliberately excluded.
const {createHash, randomUUID} = require('node:crypto');
const qualifies = value => value?.plan === 'pro' && value?.billingPeriod === 'annual';
const digest = value => createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const queueId = uid => 'annual-shirt-' + digest(uid);
const claimId = uid => 'bb-shirt-' + digest(uid).slice(0,48);
const rewardPath = '/BlastyBiz-Rewards.html';
const fail = (status,message) => { throw Object.assign(Error(message),{httpStatus:status}); };
const locked = claim => Boolean(claim?.approvedAt || claim?.preview?.orderId);
const connection = config => ['partnerId','storeId','channelId','catalogId','productId'].every(k=>validId(config?.[k]));
const binding = config => Object.fromEntries(['partnerId','storeId','channelId','catalogId','productId'].map(k=>[k,config[k]]));
const artworkHash = (selection,artwork,config) => digest(JSON.stringify({selection,logoHash:artwork.logoHash,websiteUrl:artwork.websiteUrl,binding:binding(config)}));

// Called within the existing signed payment transaction, after all reads.
function awardInTransaction({tx,db,uid,pending,payment,eventId,user,stamp}) {
  if (!qualifies(pending) || user.annualProReward || !validId(payment.id)) return;
  const money=payment.amount_money || payment.amountMoney;
  if (!Number.isSafeInteger(pending.amountCents) || pending.amountCents<=0 ||
      Number(money?.amount)!==pending.amountCents || money?.currency!=='USD') return;
  const reward={claimId:claimId(uid),plan:'pro',billingPeriod:'annual',paymentId:payment.id,
    orderId:payment.order_id||payment.orderId,customerId:payment.customer_id||payment.customerId||'',
    planVariationId:pending.subscriptionPlanId,amountCents:pending.amountCents,eventId,
    status:'earned',createdAt:stamp};
  tx.set(db.collection('users').doc(uid),{annualProReward:reward},{merge:true});
  tx.create(db.collection('setupNudges').doc(queueId(uid)),{kind:'annual-pro-reward',uid,
    sent:false,sendAfter:stamp,createdAt:stamp,deliveryStatus:'queued'});
}

function verifyPayment(claim,payment,subscription) {
  if (!qualifies(claim) || !validId(claim.customerId) || !validId(claim.orderId) || !validId(claim.planVariationId) ||
      !Number.isSafeInteger(claim.amountCents) || claim.amountCents<=0 || !payment || payment.id!==claim.paymentId || payment.status!=='COMPLETED' ||
      (payment.orderId||payment.order_id)!==claim.orderId ||
      (payment.customerId||payment.customer_id)!==claim.customerId ||
      Number((payment.amountMoney||payment.amount_money)?.amount)!==claim.amountCents ||
      (payment.amountMoney||payment.amount_money)?.currency!=='USD' ||
      Number((payment.refundedMoney||payment.refunded_money)?.amount||0)>0)
    fail(403,'This shirt requires a verified, unrefunded annual Pro payment.');
  if (!subscription || (claim.subscriptionId && subscription.id!==claim.subscriptionId) || (subscription.customerId||subscription.customer_id)!==claim.customerId ||
      (subscription.planVariationId||subscription.plan_variation_id)!==claim.planVariationId)
    fail(409,'Your annual subscription confirmation is still pending. Please refresh shortly.');
  if (!['ACTIVE','CANCELED'].includes(subscription.status)) fail(409,'Your annual subscription is not confirmed yet.');
  if (subscription.status==='CANCELED') {
    const through=subscription.chargedThroughDate||subscription.charged_through_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(through||'') || through < new Date().toISOString().slice(0,10))
      fail(403,'This annual subscription no longer has a paid claim period.');
  }
}

function createAnnualRewardService({db,admin,getSquare,readKey,sendEmail,appUrl,fetchImpl=fetch,clock=Date.now}) {
  const userRef=uid=>db.collection('users').doc(uid);
  async function load(uid,requirePaid=true) {
    const [account,settings,sub]=await Promise.all([userRef(uid).get(),db.collection('settings').doc('qrReward').get(),db.collection('subscriptions').doc(uid).get()]);
    const user=account.data(),config=settings.data(),claim=user?.annualProReward;
    let billingAddress=null;
    if (!user || user.deletionRequestedAt) fail(403,'This account is unavailable.');
    if (claim && claim.claimId!==claimId(uid)) fail(409,'Your saved reward could not be verified.');
    if (claim?.binding && (!connection(config) || Object.entries(binding(config)).some(([key,value])=>claim.binding[key]!==value)))
      fail(409,'Your saved shirt connection needs review before continuing.');
    if (requirePaid) {
      if (!claim || !qualifies(claim)) fail(403,'The free shirt is included with annual Pro.');
      const subscriptionId=claim.subscriptionId||sub.data()?.squareSubscriptionId;
      if (!validId(subscriptionId)) fail(409,'Your annual subscription confirmation is still pending. Please refresh shortly.');
      const square=await getSquare();
      const [p,s]=await Promise.all([square.payments.get({paymentId:claim.paymentId}),square.subscriptions.get({subscriptionId})]);
      if(p.errors?.length||s.errors?.length)fail(503,'Payment confirmation is temporarily unavailable.');
      verifyPayment({...claim,subscriptionId},p.payment,s.subscription);
      const card=p.payment.cardDetails?.card,address=p.payment.billingAddress||card?.billingAddress;
      if(address){
        const values={name:[address.firstName,address.lastName].filter(Boolean).join(' ')||card?.cardholderName||'',
          address1:address.addressLine1,address2:[address.addressLine2,address.addressLine3].filter(Boolean).join(', '),
          city:address.locality,region:address.administrativeDistrictLevel1,postalCode:address.postalCode,country:address.country};
        billingAddress=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,typeof value==='string'?value.trim().slice(0,160):'']));
      }
      if (!claim.subscriptionId) await db.runTransaction(async tx=>{
        const current=(await tx.get(userRef(uid))).data()?.annualProReward;
        if(current?.paymentId===claim.paymentId&&!current.subscriptionId)tx.update(userRef(uid),{'annualProReward.subscriptionId':subscriptionId});
      });
      claim.subscriptionId=subscriptionId;
    }
    return {user,claim,config,billingAddress};
  }
  function requireConnection(config) {
    if (!connection(config)||config.enabled!==true)fail(503,'Your shirt is saved. QR Gear choices are being connected; please check back.');
  }
  async function remote(config,path,body,query={}) {
    requireConnection(config);
    const key=await readKey('QR_GEAR_BLASTYBIZ_PARTNER_API_KEY');
    if (!/^psk-[a-f0-9]{64}$/.test(key||''))fail(503,'The QR Gear connection is temporarily unavailable.');
    const url=new URL('/api/partner/rewards'+path,'https://qrgear-c1ffd.web.app');
    url.search=new URLSearchParams({partnerId:config.partnerId,...query}).toString();
    const response=await fetchImpl(url,{method:body?'POST':'GET',headers:{'X-API-Key':key,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(body?240000:30000)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)fail([400,403,404,409].includes(response.status)?response.status:503,
      [400,403,409].includes(response.status)&&typeof result.error==='string'?result.error:'QR Gear is temporarily unavailable. Retry to resume your saved shirt.');
    return result;
  }
  async function product(config) {
    const result=await remote(config,'/products',null,{channelId:config.channelId});
    if(result.store?.id!==config.partnerId||result.store?.storeId!==config.storeId||result.catalogId!==config.catalogId||!Array.isArray(result.products))
      fail(503,'The BlastyBiz reward catalog could not be verified.');
    const matches=result.products.filter(p=>p.id===config.productId&&p.storeId===config.storeId&&p.channelId===config.channelId);
    if(matches.length!==1)fail(503,'Your shirt is currently unavailable in the BlastyBiz catalog.');
    return matches[0];
  }
  function receipt(value,claim) {
    if(value?.claimId!==claim.claimId||!validId(value.previewId)||!['pending','ready','failed','approved','ordered','shipped'].includes(value.status))fail(503,'Your saved shirt preview could not be verified.');
    if(value.sourceHash!==claim.requestHash)fail(409,'Your saved preview is for another selection. Create or resume the matching preview.');
    for(const field of ['mockupUrl','artworkUrl'])if(value[field]&&!/^https:\/\//.test(value[field]))fail(503,'Your saved preview URL could not be verified.');
    return value;
  }
  async function saveRemote(uid,expected,result) {
    const preview=receipt(result,expected);
    await db.runTransaction(async tx=>{
      const current=(await tx.get(userRef(uid))).data()?.annualProReward;
      if(current?.claimId!==expected.claimId||current.requestHash!==expected.requestHash)fail(409,'Your selection changed. Refresh your saved shirt.');
      if(current.approvedAt&&current.preview?.previewId!==preview.previewId)fail(409,'Your approved preview cannot change.');
      if(current.preview?.orderId && !preview.orderId)return;
      tx.update(userRef(uid),{'annualProReward.preview':preview,'annualProReward.status':preview.status});
    });
    return preview;
  }
  async function approvedArtwork(uid,businessId,imageId,choice) {
    if(!validId(businessId))fail(400,'Choose your business.');
    const ref=userRef(uid).collection('businesses').doc(businessId),business=(await ref.get()).data();
    if(!business||business.status==='archived')fail(403,'Choose a business belonging to this account.');
    let url;
    try{url=new URL(/^https?:\/\//i.test(business.website)?business.website:'https://'+business.website);}catch{fail(400,'Save your business website before creating the shirt.');}
    if(url.protocol!=='https:'||url.username||url.password||url.href.length>500||!url.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname))fail(400,'Save a public HTTPS website in your business profile.');
    let bytes;
    if(choice==='qr-only') bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==','base64');
    else {
      if(!validId(imageId))fail(400,'Choose a saved PNG logo from your business library.');
      const image=(await ref.collection('images').doc(imageId).get()).data();
      if(!image||image.retired||typeof image.path!=='string'||!image.path.startsWith('photos/'+uid+'/global/')||image.path.split('/').some(x=>x==='.'||x==='..'))fail(400,'Choose an available logo from your own business library.');
      const file=admin.storage().bucket().file(image.path),[metadata]=await file.getMetadata();
      if(Number(metadata.size)>3_000_000||metadata.contentType!=='image/png')fail(400,'Upload a PNG logo under 3 MB for your shirt.');
      [bytes]=await file.download();
      if(bytes.length>3_000_000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail(400,'Choose a valid PNG logo under 3 MB.');
    }
    return {websiteUrl:url.href,logoData:'data:image/png;base64,'+bytes.toString('base64'),logoHash:digest(bytes)};
  }
  async function status(uid,{refresh=false}={}) {
    const loaded=await load(uid,false),{claim,config}=loaded;
    if(!claim)return {eligible:false,available:config?.enabled===true,message:config?.enabled===true?'A free personalized QR Gear shirt is included with annual Pro.':'The annual Pro QR Gear shirt offer is being prepared.'};
    if(!qualifies(claim))fail(403,'Only annual Pro qualifies for this shirt.');
    // Historical order/tracking remains visible even after the paid period ends.
    const paid=locked(claim)?null:await load(uid,true);
    let preview=claim.preview||null;
    if(refresh&&claim.requestHash&&connection(config)) {
      try{preview=await saveRemote(uid,claim,await remote(config,'/'+claim.claimId,null,{customerRef:digest(uid)}));}
      catch(e){if(e.httpStatus!==404||locked(claim))throw e;}
    }
    let offer=null,availability='';
    try{offer=await product(config);}catch(e){availability=e.httpStatus?e.message:'QR Gear choices are temporarily unavailable.';}
    return {eligible:true,claimId:claim.claimId,approved:locked(claim),selection:claim.selection||null,shipping:claim.shipping||null,billingAddress:paid?.billingAddress||null,
      preview,product:offer,availability,terms:config?.terms||'One free shirt per account with annual Pro. BlastyBiz covers shipping. Review the exact design and delivery address before claiming.'};
  }
  async function manage(uid,body={}) {
    const action=body.action||'status';
    if(action==='status')return status(uid,{refresh:body.refresh===true});
    const {claim,config}=await load(uid,true);requireConnection(config);
    if(action==='preview') {
      if(locked(claim))fail(409,'Your shirt is already approved.');
      const {businessId,imageId='',color,size,graphicChoice}=body;
      if(!['full','qr-only'].includes(graphicChoice))fail(400,'Choose full graphic or QR code only.');
      const offer=await product(config);
      if(offer.optionsError||!offer.availableVariants?.some(v=>v.color===color&&v.size===size))fail(409,'Choose an available size and color.');
      const artwork=await approvedArtwork(uid,businessId,imageId,graphicChoice);
      const selection={businessId,imageId:graphicChoice==='full'?imageId:'',color,size,graphicChoice};
      const requestHash=artworkHash(selection,artwork,config);
      await db.runTransaction(async tx=>{
        const current=(await tx.get(userRef(uid))).data()?.annualProReward;
        if(!current||current.claimId!==claim.claimId||locked(current))fail(409,'Your shirt claim changed. Refresh to continue.');
        if(current.previewLeaseUntil>clock()&&current.requestHash!==requestHash)fail(409,'Your previous preview is still generating. Please wait.');
        tx.update(userRef(uid),{'annualProReward.selection':selection,'annualProReward.binding':binding(config),'annualProReward.requestHash':requestHash,'annualProReward.previewLeaseUntil':clock()+300000});
      });
      const expected={...claim,requestHash};
      const result=await remote(config,'/preview',{claimId:claim.claimId,customerRef:digest(uid),channelId:config.channelId,
        productId:config.productId,color,size,graphicChoice,websiteUrl:artwork.websiteUrl,logoData:artwork.logoData,sourceHash:requestHash});
      await saveRemote(uid,expected,result);
      await db.runTransaction(async tx=>{
        const current=(await tx.get(userRef(uid))).data()?.annualProReward;
        if(current?.requestHash===requestHash)tx.update(userRef(uid),{'annualProReward.previewLeaseUntil':0});
      });
      return status(uid);
    }
    if(action==='approve') {
      if(body.approved!==true)fail(400,'Approve your exact shirt preview first.');
      if(claim.preview?.orderId)return status(uid,{refresh:true});
      if(!claim.preview||claim.preview.sourceHash!==claim.requestHash||body.previewId!==claim.preview.previewId||(!locked(claim)&&claim.preview.status!=='ready'))fail(409,'Review your current personalized preview first.');
      let shipping=claim.shipping;
      if(!locked(claim)) {
        shipping={};
        for(const key of ['name','address1','address2','city','region','postalCode','country']) {
          const value=typeof body.shipping?.[key]==='string'?body.shipping[key].trim():'';
          if(value.length>160||(key!=='address2'&&!value))fail(400,'Complete your shipping address.');shipping[key]=value;
        }
        if(!/^[A-Z]{2}$/.test(shipping.country))fail(400,'Use a two-letter country code.');
        if(config.countries?.length&&!config.countries.includes(shipping.country))fail(400,'This shipping destination is not included in the shirt offer.');
        const artwork=await approvedArtwork(uid,claim.selection.businessId,claim.selection.imageId,claim.selection.graphicChoice);
        const currentHash=artworkHash(claim.selection,artwork,config);
        if(currentHash!==claim.requestHash)fail(409,'Your business or shirt options changed. Create a fresh preview.');
      }
      const attempt=randomUUID();
      shipping=await db.runTransaction(async tx=>{
        const current=(await tx.get(userRef(uid))).data()?.annualProReward;
        if(current?.requestHash!==claim.requestHash||current.preview?.previewId!==body.previewId)fail(409,'Your preview changed. Refresh before approving.');
        if(current.approvalLeaseUntil>clock())fail(409,'Your approved shirt is being saved. Please refresh shortly.');
        if(!locked(current))tx.update(userRef(uid),{'annualProReward.shipping':shipping,'annualProReward.approvedAt':new Date(clock()).toISOString(),'annualProReward.status':'approving'});
        tx.update(userRef(uid),{'annualProReward.approvalAttempt':attempt,'annualProReward.approvalLeaseUntil':clock()+300000});
        return locked(current)?current.shipping:shipping;
      });
      try {
        const result=await remote(config,'/approve',{claimId:claim.claimId,customerRef:digest(uid),previewId:body.previewId,shipping,
          authorization:{websiteOrderId:claim.orderId,paymentId:claim.paymentId,subscriptionId:claim.subscriptionId,
            source:'blastybiz',plan:'pro',billingPeriod:'annual',verifiedAt:new Date(clock()).toISOString()}});
        await saveRemote(uid,claim,result);
      } catch(error) {
        // A confirmed validation rejection with no canonical order can be edited.
        // An ambiguous network/provider failure keeps the exact approval frozen.
        if([400,409].includes(error.httpStatus))try{
          const latest=receipt(await remote(config,'/'+claim.claimId,null,{customerRef:digest(uid)}),claim);
          if(!latest.orderId&&latest.previewId===body.previewId)await db.runTransaction(async tx=>{
            const current=(await tx.get(userRef(uid))).data()?.annualProReward;
            if(current?.approvalAttempt===attempt&&!current.preview?.orderId)tx.update(userRef(uid),{'annualProReward.approvedAt':null,'annualProReward.preview':latest,'annualProReward.status':latest.status});
          });
        }catch(_){ /* Keep frozen when the partner cannot confirm no order. */ }
        throw error;
      } finally {
        await db.runTransaction(async tx=>{
          const current=(await tx.get(userRef(uid))).data()?.annualProReward;
          if(current?.approvalAttempt===attempt)tx.update(userRef(uid),{'annualProReward.approvalLeaseUntil':0});
        });
      }
      return status(uid);
    }
    fail(400,'Unknown shirt action.');
  }
  async function deliver(uid) {
    const ref=db.collection('setupNudges').doc(queueId(uid)),snap=await ref.get();
    if(!snap.exists||snap.data().kind!=='annual-pro-reward'||snap.data().sent)return;
    const {user,claim,config}=await load(uid,true);requireConnection(config);
    if(!user.email||user.emailUnsubscribed||locked(claim)){await ref.update({sent:true,deliveryStatus:'skipped'});return;}
    const link=appUrl+rewardPath+'?ownerUid='+encodeURIComponent(uid);
    const subject='Your free QR Gear shirt is ready to personalize';
    const html='<h1>Your annual Pro shirt is waiting</h1><p>Your annual Pro purchase includes one free personalized QR Gear shirt. BlastyBiz covers shipping.</p><p>Choose your business, size and color, then approve your preview and delivery address.</p><p><a href="'+link+'">Choose my free shirt</a></p><p>Sign in with the BlastyBiz account that purchased annual Pro. You can leave and return to the same saved claim.</p>';
    const delivery=await db.runTransaction(async tx=>{
      const current=(await tx.get(ref)).data();
      if(!current||current.sent||current.needsReview||current.leaseUntil>clock())return null;
      const prior=current.delivery;
      if(prior&&clock()-prior.createdAt>23*3600000&&!['rejected','deferred'].includes(current.deliveryStatus)){
        tx.update(ref,{needsReview:true,deliveryStatus:'uncertain'});return null;
      }
      const next=prior&&clock()-prior.createdAt<=23*3600000?prior:{key:queueId(uid)+'-'+randomUUID(),createdAt:clock(),to:user.email,subject,html};
      tx.update(ref,{delivery:next,deliveryStatus:'sending',leaseUntil:clock()+120000});return next;
    });
    if(!delivery)return;
    try {
      await sendEmail({...delivery,idempotencyKey:delivery.key,strict:true});
      await ref.update({sent:true,deliveryStatus:'sent',leaseUntil:0,sentAt:new Date(clock()).toISOString()});
    }catch(e){await ref.update({deliveryStatus:e.providerRejected?'rejected':'uncertain',leaseUntil:0});throw e;}
  }
  return {manage,status,deliver};
}
module.exports={qualifies,queueId,claimId,rewardPath,awardInTransaction,verifyPayment,createAnnualRewardService};
