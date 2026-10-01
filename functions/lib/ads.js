'use strict';

// Reusable creative lives below the existing Campaign. listingDrafts remains
// the working/prepared Blast store; publishJobs remains the only delivery queue.
const { PLATFORM_CAPABILITY_MAP, postImages } = require('./platforms');
const fail = (status, message) => { throw Object.assign(new Error(message), {httpStatus:status}); };
const id = value => {
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail(400,'Invalid record identifier.');
  return value;
};
const clone = value => JSON.parse(JSON.stringify(value));
const text = (v, limit=12000) => {
  if(typeof v!=='string'||v.length>limit) fail(400,'Invalid or overlong creative text.');
  return v.trim();
};
const allowed = ['name','offer','price','cta','context','pickupArea','pickupZip','mentions','platforms','imageRefs','knownImageIds','adaptations','platformStatus'];
function cleanCreative(input, previous={}) {
  if(!input||typeof input!=='object'||Array.isArray(input)) fail(400,'Creative is required.');
  const result={...previous};
  for(const key of Object.keys(input)) {
    if(!allowed.includes(key)) continue;
    const v=input[key];
    if(['name','offer','price','cta','context'].includes(key)) result[key]=text(v,key==='name'?200:12000);
    if(key==='pickupArea'||key==='pickupZip')result[key]=text(v,key==='pickupZip'?10:300);
    if(key==='mentions') {
      if(!v||typeof v!=='object'||Array.isArray(v)) fail(400,'Invalid mention settings.');
      result.mentions=require('./business-form').mentions(v);
    }
    if(key==='platforms') {
      if(!Array.isArray(v)||v.length>30||v.some(p=>!Object.hasOwn(PLATFORM_CAPABILITY_MAP,p))) fail(400,'Choose supported destinations.');
      result.platforms=[...new Set(v)];
    }
    if(key==='knownImageIds') {
      if(!Array.isArray(v)||v.length>1000)fail(400,'Invalid known photo selection.');
      result[key]=[...new Set(v.map(id))];
    }
    if(key==='imageRefs') {
      if(!Array.isArray(v)||v.length>30) fail(400,'Choose up to 30 images.');
      result.imageRefs=v.map(image=>({id:id(image?.id)})); // resolve canonical metadata inside transaction
    }
    if(key==='adaptations'||key==='platformStatus') {
      if(!v||typeof v!=='object'||Array.isArray(v)) fail(400,'Invalid platform copy.');
      result[key]={};
      for(const [p,value] of Object.entries(v)) {
        if(!Object.hasOwn(PLATFORM_CAPABILITY_MAP,p)) fail(400,'Unsupported destination.');
        result[key][p]=key==='adaptations'?text(value):(['approved','excluded','needs-review'].includes(value)?value:'needs-review');
      }
    }
  }
  return result;
}
function freezePacket(ad, campaign, overrides) {
  const data=overrides?cleanCreative(overrides,ad):clone(ad);
  const platforms=(data.platforms||[]).filter(p=>data.platformStatus?.[p]!=='excluded');
  if(!platforms.length) fail(400,'Select a destination before preparing a Blast.');
  const images=(data.imageRefs||[]).map(i=>i.url).filter(Boolean);
  const packet={version:1,adId:ad.id,campaignId:ad.campaignId,campaignName:campaign.name||'',adName:data.name||'Ad',adRevision:ad.revision,
    offer:data.offer||'',price:data.price||'',cta:data.cta||'',context:data.context||'',mentions:data.mentions||{},
    ...(Object.hasOwn(data,'pickupArea')||Object.hasOwn(data,'pickupZip')?{pickupArea:data.pickupArea||'',pickupZip:data.pickupZip||''}:{}),
    adaptations:{},imageRefs:clone(data.imageRefs||[]),imagesByPlatform:{},enabledPlatforms:[...platforms],
    copyBehavior:'reuse',override:!!overrides};
  for(const p of platforms) {
    const copy=data.adaptations?.[p];
    if(typeof copy!=='string'||!copy.trim()) fail(409,'Review required: missing copy for '+p+'.');
    if(data.platformStatus?.[p]!=='approved') fail(409,'Review and approve '+p+' before running this Ad.');
    packet.adaptations[p]=copy;
    packet.imagesByPlatform[p]=clone(postImages(p,images));
    if(p==='instagram'&&!packet.imagesByPlatform[p].length) fail(409,'Review required: Instagram needs a selected image.');
  }
  return packet;
}
function event(eventId,type,fields,sourceAdId) {
  return {eventId,type,fields,at:new Date().toISOString(),...(sourceAdId?{sourceAdId}:{})};
}
function invalidateStaleApprovals(before,next) {
  const inputs=['offer','price','cta','context','pickupArea','pickupZip','mentions','platforms','imageRefs'];
  if(!inputs.some(k=>JSON.stringify(before[k])!==JSON.stringify(next[k])))return;
  next.platformStatus={...(next.platformStatus||{})};
  for(const p of next.platforms||[]) {
    if(next.adaptations?.[p]===before.adaptations?.[p])next.platformStatus[p]='needs-review';
  }
}
function createAdService(db,admin) {
  const stamp=()=>admin.firestore.FieldValue.serverTimestamp();
  return async function manage(uid,body) {
    const {action}=body;
    if(!['list','get','create','derive','save','prepare','updatePrepared'].includes(action))fail(400,'Unknown Ad action.');
    const businessId=id(body.businessId),campaignId=id(body.campaignId);
    const biz=db.doc('users/'+uid+'/businesses/'+businessId),camp=biz.collection('campaigns').doc(campaignId);
    const ads=camp.collection('ads'),drafts=biz.collection('listingDrafts');
    if(action==='list') {
      const [bs,cs]=await Promise.all([biz.get(),camp.get()]);
      if(!bs.exists||!cs.exists)fail(404,'Business or campaign not found.');
      if(cs.data().status==='archived')fail(409,'This campaign is archived.');
      const [rows,runs]=await Promise.all([ads.get(),drafts.where('campaignId','==',campaignId).get()]);
      const counts={};
      for(const run of runs.docs){const d=run.data();if(d.packet&&d.adId)counts[d.adId]=(counts[d.adId]||0)+1;}
      return {ads:rows.docs.map(d=>({...d.data(),id:d.id,blastCount:counts[d.id]||0}))};
    }
    const adId=id(body.adId);
    return db.runTransaction(async tx=>{
      const bs=await tx.get(biz),cs=await tx.get(camp);
      if(!bs.exists||!cs.exists) fail(404,'Business or campaign not found.');
      const campaign=cs.data();
      if(campaign.status==='archived') fail(409,'This campaign is archived.');
      const ref=ads.doc(adId),snap=await tx.get(ref),ad=snap.exists?{...snap.data(),id:adId}:null;
      if(action==='get') {if(!ad)fail(404,'Ad not found.');return {ad};}
      if(action==='create'||action==='derive') {
        const requestId=id(body.requestId);
        if(ad) {
          if(ad.requestId===requestId)return {ad};
          fail(409,'Ad already exists.');
        }
        let source=null;
        if(action==='derive') {
          const sourceSnap=await tx.get(ads.doc(id(body.sourceAdId)));
          if(!sourceSnap.exists)fail(404,'Source Ad not found.');
          source=sourceSnap.data();
        }
        const base=source?Object.fromEntries(allowed.filter(k=>source[k]!==undefined).map(k=>[k,clone(source[k])])):
          {name:'New Ad',offer:'',price:'',cta:'',context:'',mentions:require('./business-form').profileMentions(bs.data()),platforms:campaign.platformsEnabled||[],imageRefs:[],adaptations:{},platformStatus:{}};
        const creative=cleanCreative(body.creative||{},base);
        await resolveImages(tx,camp,creative,!!body.creative?.imageRefs);
        creative.platformStatus=Object.fromEntries((creative.platforms||[]).map(p=>[p,'needs-review']));
        const made={...creative,id:adId,campaignId,businessId,uid,requestId,revision:1,status:'draft',
          ...(source?{sourceAdId:body.sourceAdId}:{}),events:[event(requestId,source?'derived_from':'created',Object.keys(creative),source?body.sourceAdId:undefined)]};
        tx.create(ref,{...made,createdAt:stamp(),updatedAt:stamp()});return {ad:made};
      }
      if(!ad) fail(404,'Ad not found.');
      if(action==='save'&&(ad.events||[]).some(e=>e.eventId===body.requestId))return {ad,prepared:[]};
      if(!['prepare','updatePrepared'].includes(action)&&body.expectedRevision!==ad.revision) fail(409,'This Ad changed elsewhere. Reload before saving.');
      if(action==='save') {
        const creative=cleanCreative(body.creative||{},ad);
        await resolveImages(tx,camp,creative,!!body.creative?.imageRefs);
        const fields=allowed.filter(k=>JSON.stringify(creative[k])!==JSON.stringify(ad[k]));
        if(!fields.length)return {ad,prepared:[]};
        const prepared=await tx.get(drafts.where('adId','==',adId).where('campaignId','==',campaignId));
        const stale=prepared.docs.filter(d=>d.data().packet&&d.data().status!=='approved').map(d=>({id:d.id,adRevision:d.data().packet.adRevision}));
        const requestId=id(body.requestId);
        invalidateStaleApprovals(ad,creative);
        const included=(creative.platforms||[]).filter(p=>creative.platformStatus?.[p]!=='excluded');
        const ready=included.length>0&&included.every(p=>creative.adaptations?.[p]?.trim()&&creative.platformStatus?.[p]==='approved');
        const updated={...creative,status:ready?'ready':'draft',revision:ad.revision+1,events:[...(ad.events||[]),event(requestId,fields.includes('imageRefs')?'images_edited':fields.includes('platforms')?'platforms_changed':'copy_edited',fields)].slice(-200)};
        tx.set(ref,{...updated,updatedAt:stamp()});
        return {ad:updated,prepared:stale};
      }
      if(action==='prepare'||action==='updatePrepared') {
        const blastId=id(body.blastId),dr=drafts.doc(blastId),old=await tx.get(dr);
        if(action==='prepare'&&old.exists) {
          if(old.data().packet&&old.data().adId===adId&&old.data().campaignId===campaignId)return {blastId,packet:old.data().packet,reused:true};
          fail(409,'Blast identity already used.');
        }
        if(body.expectedRevision!==ad.revision)fail(409,'This Ad changed elsewhere. Reload before saving.');
        if(action==='updatePrepared'&&(!old.exists||old.data().adId!==adId||old.data().campaignId!==campaignId))fail(404,'Prepared Blast not found.');
        if(old.exists&&['approved','canceled'].includes(old.data().status))fail(409,'This Blast has been sent; its packet is frozen.');
        let effective=ad;
        if(body.scope==='this_run') {
          effective=cleanCreative(body.creative||{},ad);
          await resolveImages(tx,camp,effective,!!body.creative?.imageRefs);
        }
        if(body.scope==='this_run')invalidateStaleApprovals(ad,effective);
        const packet=freezePacket(effective,campaign);
        packet.override=body.scope==='this_run';
        const status=Object.fromEntries(packet.enabledPlatforms.map(p=>[p,'approved']));
        const data={uid,businessId,campaignId,campaignName:campaign.name||'',adId,adName:packet.adName,
          packet,adaptations:packet.adaptations,imagesByPlatform:packet.imagesByPlatform,enabledPlatforms:packet.enabledPlatforms,
          platformStatus:status,status:'prepared',revision:(old.data()?.revision||0)+1,
          ...(old.exists?{}:{createdAt:stamp()}),updatedAt:stamp()};
        if(old.data()?.scheduleAdPath){data.status='scheduled';data.approvalStatus='required';data.approvedPacketRevision=null;}
        tx.set(dr,data,{merge:true});
        return {blastId,packet,requiresExplicitSend:true};
      }
      fail(400,'Unknown Ad action.');
    });
  };
}
async function resolveImages(tx,campaign,creative,changed) {
  if(!changed)return;
  const resolved=[];
  for(const i of creative.imageRefs||[]) {
    const record=await tx.get(campaign.collection('images').doc(id(i.id)));
    if(!record.exists||record.data().retired)fail(409,'A selected image is no longer available.');
    const m=record.data();
    if(typeof m.url!=='string'||!m.url.startsWith('https://'))fail(400,'Image URL is invalid.');
    resolved.push({id:i.id,url:m.url,path:m.path||'',alt:m.alt||'',...(m.sourceImageId?{sourceImageId:m.sourceImageId}:{}),...(m.transform?{transform:m.transform}:{})});
  }
  creative.imageRefs=resolved;
}
module.exports={createAdService,cleanCreative,freezePacket};
