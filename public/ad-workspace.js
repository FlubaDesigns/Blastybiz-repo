/* The existing Campaign form edits one selected Ad. No second Campaign store. */
(function(){
  'use strict';
  let ad=null, campaign='', business='', epoch=0, busy=false, dirty=false, pending=null, loading=null, saving=null, loadError=null, editVersion=0, autoSaveTimer=null;
  const uuid=()=>crypto.randomUUID();
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const editFields=['biz-ad-name','biz-offer','biz-price','ad-context','ad-cta','ad-area','ad-zip'];
  const context=()=>({businessId:window.activeBizId,campaignId:activeCampaignId});
  async function api(action,body={}) {
    const ctx={...context(),...body};
    if(!ctx.businessId||!ctx.campaignId||!window._bbGetToken)throw Error('Select a business and campaign first.');
    const response=await _bbFetchWithTimeout('https://us-central1-blastybiz-9523e.cloudfunctions.net/manageAd',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await window._bbGetToken()},
      body:JSON.stringify({...body,...ctx,action})
    },60000);
    const data=await response.json();if(!response.ok)throw Error(data.error||'Could not save the Ad.');return data;
  }
  function tell(message){el('ad-message').textContent=message;}
  async function task(fn){if(busy)return;busy=true;document.querySelectorAll('#ad-workspace button,#ad-workspace select').forEach(b=>b.disabled=true);try{await fn();}catch(e){tell(e.message);window.showToast?.(e.message);}finally{busy=false;document.querySelectorAll('#ad-workspace button,#ad-workspace select').forEach(b=>b.disabled=false);}}
  function mount(){
    if(el('ad-workspace'))return;
    const host=el('campaign-content');if(!host)return;
    const box=document.createElement('section');box.id='ad-workspace';
    box.innerHTML='<p id="ad-message" role="status" aria-live="polite"></p><button type="button" id="ad-save-retry" data-action="save" hidden>Retry save</button><div id="ad-current" hidden><div id="ad-location-fields" hidden><label>ZIP code (optional)<input id="ad-zip" type="text" inputmode="numeric" maxlength="10" placeholder="ZIP code"></label><label>Area / pickup location (optional)<input id="ad-area" type="text" maxlength="300" placeholder="City, neighborhood, or pickup area"></label></div><label>Call to action (optional)<input id="ad-cta" type="text" maxlength="12000"></label><label>Extra details (optional)<textarea id="ad-context" rows="3"></textarea></label><div id="ad-prepared"></div></div>';
    const anchor=el('ad-form-anchor');
    if(anchor)anchor.parentNode.appendChild(box);else host.prepend(box);
    const style=document.createElement('style');style.textContent='#ad-workspace{padding:18px;margin-bottom:16px}#ad-workspace button{min-height:44px;margin:4px;padding:8px 12px}#ad-workspace label{display:block;margin:12px 0}#ad-workspace input,#ad-workspace textarea,#ad-workspace select{display:block;width:100%;box-sizing:border-box}.ad-copy{width:100%;min-height:100px}';document.head.appendChild(style);
    box.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)task(()=>act(b.dataset.action,b.dataset.id));});
  }

  async function list(){
    const requested=JSON.stringify(context());const result=await api('list');if(requested!==JSON.stringify(context()))return [];
    return result.ads;
  }
  function markDirty(){
    if(!ad)return;
    dirty=true;editVersion++;clearTimeout(autoSaveTimer);tell('Saving…');
    const seq=epoch;
    autoSaveTimer=setTimeout(()=>{if(seq===epoch)flushSave();},650);
  }
  async function flushSave(){
    if(!ad||!dirty||saving)return;
    const seq=epoch;
    try{await save();}catch(e){if(seq===epoch){tell('Not saved. '+e.message);el('ad-save-retry').hidden=false;}}
  }
  function open(){
    mount();if(!el('ad-workspace'))return Promise.resolve();
    clearTimeout(autoSaveTimer);el('ad-save-retry').hidden=true;
    const seq=++epoch;campaign=activeCampaignId;business=window.activeBizId;ad=null;dirty=false;pending=null;loadError=null;window._bbActiveAd=null;
    const host=el('campaign-content');host.inert=true;
    el('ad-current').hidden=true;tell('Loading saved details…');
    for(const field of ['biz-ad-name','biz-offer','biz-price','ad-context','ad-cta','ad-area','ad-zip'])if(el(field))el(field).value='';
    platforms=platforms.map(p=>({...p,enabled:false,adaptedContent:'',_reviewStatus:undefined}));
    window._currentDraftId=null;window._bbPendingDraft=null;window._bbPlatformPhotoSel={};
    loading=(async()=>{
      try{
        const rows=await list();if(seq!==epoch)return;
        const wanted=new URLSearchParams(location.search).get('adId');
        const selected=rows.find(a=>a.id===wanted)||rows.find(a=>a.id==='first')||rows[0];
        if(!selected)throw Error('This campaign has no saved ad. Your campaign details are preserved.');
        await fill(selected);if(seq!==epoch)return;tell('');
      }catch(e){if(seq===epoch){loadError=e;ad=null;window._bbActiveAd=null;tell(e.message);}}
      finally{if(seq===epoch)host.inert=false;}
    })();
    return loading;
  }
  async function ready(){await loading;if(loadError)throw loadError;if(!ad)throw Error('Open a saved campaign before continuing.');return ad;}
  function fill(next){
    ad=next;window._bbActiveAd=ad;dirty=false;pending=null;window._currentDraftId=null;window._bbPendingDraft=null;
    for(const [field,key] of Object.entries({'biz-ad-name':'name','biz-offer':'offer','biz-price':'price','ad-cta':'cta','ad-context':'context','ad-area':'pickupArea','ad-zip':'pickupZip'})){if(el(field))el(field).value=ad[key]||'';}
    if(typeof platforms!=='undefined'){
      platforms=platforms.map(p=>({...p,enabled:(ad.platforms||[]).includes(p.id),adaptedContent:(ad.adaptations?.[p.id]||'').replace(/\n/g,'<br/>'),_reviewStatus:ad.platformStatus?.[p.id]==='excluded'?'skipped':ad.platformStatus?.[p.id]||'needs-review'}));
      if(typeof renderStep5Review==='function')renderStep5Review();
    }
    for(const key of Object.keys(ynState))delete ynState[key];
    Object.assign(ynState,BBSetup.mentions(ad.mentions||BBSetup.profileMentions(window._bbProfileGlobal||{})));
    for(const [field,value] of Object.entries(ynState)){for(const choice of ['yes','no'])el('yn-'+field+'-'+choice)?.classList.toggle('yn-active',value===choice);}
    el('ad-location-fields').hidden=window._bbProfileGlobal?.sellerType!=='personal';
    el('ad-current').hidden=false;window.BBBlasty?.fire('images.campaign_repository_intro');window.BBBlasty?.fire('images.ad_selection_intro');
    el('ad-prepared').replaceChildren();
    if(typeof renderStep3Platforms==='function')renderStep3Platforms();
    if(el('offer-count'))el('offer-count').textContent=(ad.offer||'').length+' / 500';
    if(typeof checkAdaptBtn==='function')checkAdaptBtn();
    return images();
  }
  function creative(){
    if(!ad)throw Error('Choose or create an Ad first.');
    return {name:el('biz-ad-name').value.trim()||'Untitled Ad',offer:el('biz-offer').value,price:el('biz-price').value,cta:el('ad-cta').value,context:el('ad-context').value,
      ...(window._bbProfileGlobal?.sellerType==='personal'?{pickupArea:el('ad-area').value,pickupZip:el('ad-zip').value}:{}),
      mentions:{...ynState},platforms:platforms.filter(p=>p.enabled).map(p=>p.id),imageRefs:(ad.imageRefs||[]).map(i=>({id:i.id})),
      adaptations:Object.fromEntries(platforms.filter(p=>p.enabled&&p.adaptedContent).map(p=>[p.id,p.adaptedContent.replace(/<br\s*\/?\s*>/gi,'\n')])),
      platformStatus:Object.fromEntries(platforms.filter(p=>p.enabled).map(p=>[p.id,p._reviewStatus==='approved'?'approved':p._reviewStatus==='skipped'?'excluded':'needs-review']))};
  }
  async function persist(){
    await ready();
    const version=editVersion,seq=epoch;
    const values=creative();if(pending?.action!=='save'||JSON.stringify(pending.values)!==JSON.stringify(values))pending={action:'save',requestId:uuid(),values};
    const data=await api('save',{adId:ad.id,expectedRevision:ad.revision,requestId:pending.requestId,creative:pending.values});
    if(seq!==epoch)throw Error('The active campaign changed during save.');
    const editedDuringSave=version!==editVersion||JSON.stringify(creative())!==JSON.stringify(values);
    ad=editedDuringSave?{...data.ad,imageRefs:ad.imageRefs}:data.ad;window._bbActiveAd=ad;
    if(!editedDuringSave){
      platforms=platforms.map(p=>({...p,_reviewStatus:ad.platformStatus?.[p.id]==='excluded'?'skipped':ad.platformStatus?.[p.id]||'needs-review'}));
      if(typeof renderStep5Review==='function'&&!document.activeElement?.closest('[contenteditable]'))renderStep5Review();
    }
    el('ad-save-retry').hidden=true;
    dirty=editedDuringSave;pending=null;tell(dirty?'Saving your latest edits…':'Saved.');
    el('ad-prepared').innerHTML=(data.prepared||[]).map(b=>'<p>Prepared Blast '+esc(b.id)+' still contains the older Ad. <button type="button" data-action="update-prepared" data-id="'+esc(b.id)+'">Update It Too</button> <button type="button" data-action="leave-prepared">Leave It</button></p>').join('');
    return data;
  }
  async function save(){
    clearTimeout(autoSaveTimer);
    if(saving){await saving;return save();}
    saving=(async()=>{let result;do{result=await persist();}while(dirty);return result;})();
    try { const result=await saving;return result; } finally { saving=null; }
  }
  async function prepare(scope){
    if(!ad)throw Error('Choose an Ad first.');
    const values=scope==='this_run'?creative():null;
    if(pending?.action!=='prepare'||pending.scope!==scope||JSON.stringify(pending.values)!==JSON.stringify(values))pending={action:'prepare',scope,blastId:uuid(),values};
    const data=await api('prepare',{adId:ad.id,expectedRevision:ad.revision,blastId:pending.blastId,scope,...(pending.values?{creative:pending.values}:{})});
    pending=null;
    location.href='BlastyBiz-Listing-Preview.html?'+new URLSearchParams({bizId:business,draftId:data.blastId});
  }
  async function images(){
    if(!ad)return;const seq=epoch;
    const global=await window._bbLoadGlobalImages();
    if(seq!==epoch)return;
    window._globalImages=global.filter(image=>!image.retired);
    if(typeof refreshPhotoGridForScope==='function')refreshPhotoGridForScope();
  }
  async function choosePhoto(item){
    return task(async()=>{
      await ready();
      const seq=epoch;
      let id=item.id;
      if(!id && item.url && item.scope==='campaign'){
        id=await window._bbSaveCampaignImage(campaign,{url:item.url,path:item.path||''});
        item.id=id;
      }
      if(item.scope==='global'){
        await act('import-image',id);
        const pool=await window._bbLoadCampaignImages(campaign);
        id=pool.find(image=>image.sourceImageId===item.id||image.url===item.url)?.id;
        if(!id)throw Error('Photo could not be added to the campaign. Please retry.');
        if(typeof setPhotoScope==='function')setPhotoScope('campaign');
      }
      if(seq!==epoch)throw Error('The campaign changed. Choose the photo again.');
      await act(item.scope!=='global' && (ad.imageRefs||[]).some(image=>image.id===id)?'remove-image':'select-image',id);
      await save();
      if(typeof window.renderAllPhotos==='function')window.renderAllPhotos();
    });
  }

  async function act(action,id){
    if(action==='save'){await save();return;}
    if(action==='update-prepared'){
      await api('updatePrepared',{adId:ad.id,expectedRevision:ad.revision,blastId:id});
      tell('Prepared Blast updated. Open its preview and explicitly send or schedule it.');el('ad-prepared').replaceChildren();return;
    }
    if(action==='leave-prepared'){el('ad-prepared').replaceChildren();tell('Prepared Blasts retain their existing packets.');return;}
    if(action==='import-image'){
      const global=await window._bbLoadGlobalImages(),image=global.find(i=>i.id===id&&!i.retired);if(!image)throw Error('Image no longer available.');
      const pool=await window._bbLoadCampaignImages(campaign);
      if(!pool.some(i=>i.sourceImageId===id||i.url===image.url))await window._bbSaveCampaignImage(campaign,{url:image.url,path:image.path||'',alt:image.alt||'',sourceImageId:id});
      await images();return;
    }
    if(action==='select-image'){
      const pool=await window._bbLoadCampaignImages(campaign),image=pool.find(i=>i.id===id&&!i.retired);if(!image)throw Error('Image no longer available.');
      if(!(ad.imageRefs||[]).some(i=>i.id===id))ad.imageRefs=[...(ad.imageRefs||[]),image];
      markDirty();await images();tell('Saving…');window.BBBlasty?.fire('images.first_ad_image_selected');return;
    }
    if(action==='remove-image'){ad.imageRefs=(ad.imageRefs||[]).filter(i=>i.id!==id);markDirty();await images();tell('Selection removed; the campaign image is preserved.');}
  }
  document.addEventListener('input',e=>{
    if(editFields.includes(e.target.id))markDirty();
    const copy=e.target.closest('[contenteditable][id^="qp-copy-text-"]');
    if(copy){
      const id=copy.id.slice('qp-copy-text-'.length);
      platforms=platforms.map(p=>p.id===id?{...p,adaptedContent:(copy.innerText||copy.textContent||'').replace(/\n/g,'<br/>'),_reviewStatus:'needs-review'}:p);
      markDirty();
      if(typeof updateStep5UI==='function')updateStep5UI();
    }
  });
  // Commit mobile/autofill changes and flush when the user leaves the field.
  document.addEventListener('change',e=>{
    if(!editFields.includes(e.target.id)||!ad)return;
    if(!dirty)markDirty();
    flushSave();
  });
  document.addEventListener('focusout',e=>{
    if(editFields.includes(e.target.id)||e.target.closest('[contenteditable][id^="qp-copy-text-"]'))flushSave();
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushSave();});
  window.addEventListener('beforeunload',e=>{
    if(!dirty)return;
    flushSave();e.preventDefault();e.returnValue='';
  });
  window.BBAds={choosePhoto,markDirty,open,ready,refreshImages:images,save,creative,prepareCurrent:()=>task(()=>prepare('this_run')),get active(){return ad;},get dirty(){return dirty;},get busy(){return busy||!!saving;},api};
})();
