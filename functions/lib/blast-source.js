'use strict';
// Frozen Blast content and delivery payloads share one reader for reuse and scheduling.
const {createHash}=require('node:crypto');
const {PLATFORM_CAPABILITY_MAP}=require('./platforms');
const fail=(status,message)=>{throw Object.assign(Error(message),{httpStatus:status});};
const id=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v))fail(400,'Invalid record identifier.');return v;};
async function readSourcePacket(tx,br,campaign,ad,sourceId) {
     const source=await tx.get(br.collection('listingDrafts').doc(id(sourceId)));
     if(!source.exists||source.data().status!=='approved'||source.data().adId!==ad.id||source.data().campaignId!==ad.campaignId)fail(409,'The approved source post is unavailable. Open the Ad and review it.');
     const saved=source.data(),original=saved.packet||saved;
     // Delivery payloads are the historical truth, including a sent subset of
     // destinations. Original-format drafts do not have a nested packet.
     const jobs=await tx.get(br.collection('publishJobs').where('draftId','==',source.id));
     if(jobs.empty) {
       if(saved.packet)return saved.packet;
       fail(409,'The source post has no publishing record. Open the Ad and review it.');
     }
     const adaptations={},imagesByPlatform={};
     for(const row of jobs.docs) {
       const job=row.data(),p=job.platform,payload=job.payload;
       if(job.campaignId!==ad.campaignId||(job.adId&&job.adId!==ad.id)||!Object.hasOwn(PLATFORM_CAPABILITY_MAP,p)||typeof payload?.adaptedContent!=='string'||!payload.adaptedContent.trim()||!Array.isArray(payload.imageUrls)||payload.imageUrls.some(u=>typeof u!=='string'||!/^https:\/\//i.test(u)))fail(409,'The source publishing record is incomplete. Open the Ad and review it.');
       if(Object.hasOwn(adaptations,p)&&(adaptations[p]!==payload.adaptedContent||JSON.stringify(imagesByPlatform[p])!==JSON.stringify(payload.imageUrls)))fail(409,'The source has conflicting publishing records. Open the Ad and review it.');
       adaptations[p]=payload.adaptedContent;imagesByPlatform[p]=payload.imageUrls;
     }
     const pool=await tx.get(br.collection('campaigns').doc(ad.campaignId).collection('images'));
     const known=[...(original.imageRefs||[]),...pool.docs.filter(i=>!i.data().retired).map(i=>({...i.data(),id:i.id}))];
     const imageRefs=[...new Set(Object.values(imagesByPlatform).flat())].map(url=>{
       const image=known.find(i=>i.url===url);
       return {id:image?.id||'sent_'+createHash('sha256').update(url).digest('hex').slice(0,32),url,path:image?.path||'',alt:image?.alt||''};
     });
     return {version:1,adId:ad.id,campaignId:ad.campaignId,campaignName:original.campaignName||campaign.name||'',adName:original.adName||ad.name||'Ad',adRevision:original.adRevision||ad.revision,
       offer:original.offer||'',price:original.price||'',cta:original.cta||'',context:original.context||original.campaignContext||'',mentions:original.mentions||{},
       ...(original.pickupArea!==undefined?{pickupArea:original.pickupArea}:{}),...(original.pickupZip!==undefined?{pickupZip:original.pickupZip}:{}),
       adaptations,imagesByPlatform,imageRefs,enabledPlatforms:Object.keys(adaptations),copyBehavior:'reuse',override:!!original.override};
}
module.exports={readSourcePacket};
