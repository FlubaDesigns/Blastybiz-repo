/* Dashboard projections of the canonical Ad, schedule and delivery records. */
(function(){
 'use strict';
 const time=v=>v?.toMillis?.()||v?.stamp||(typeof v==='string'?Date.parse(v):0)||0;
 function currentDraft(ads,drafts){
   return ads.filter(ad=>['draft','ready'].includes(ad.status)&&!ad.schedule?.enabled&&!drafts.some(d=>
     d.campaignId===ad.campaignId&&d.adId===ad.id&&['approved','completed'].includes(d.status)&&d.packet?.adRevision===ad.revision))
     .sort((a,b)=>time(b.updatedAt||b.createdAt)-time(a.updatedAt||a.createdAt)||a.id.localeCompare(b.id))[0];
 }
 function renderDraft(host,ads,drafts,businessId){
   const ad=currentDraft(ads,drafts);host.replaceChildren();
   const title=document.createElement('h2');title.textContent=ad?'Continue your draft':'Create your next post';host.append(title);
   const photo=ad?.imageRefs?.[0],{card,content}=BBLifecycleStatus.postCard({title:ad?(ad.name||'Untitled Ad'):'',image:photo?.url?.startsWith('https://')?photo.url:null,alt:photo?.alt});
   if(ad){const copy=document.createElement('p');copy.className='bb-return-excerpt';copy.textContent=Object.values(ad.adaptations||{})[0]||ad.offer||'';content.append(copy);}
   const link=document.createElement('a');link.className='btn btn-primary';link.textContent=ad?'Continue your draft':'Create a post';
   link.href='BlastyBiz.html?'+new URLSearchParams({bizId:businessId,...(ad?{cid:ad.campaignId,adId:ad.id,tab:'create'}:{newcampaign:'1'})});content.append(link);host.append(card);
 }
 window.BBReturnVisits={currentDraft,renderDraft};
})();
