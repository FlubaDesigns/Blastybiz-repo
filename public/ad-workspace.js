/* The existing Campaign form edits one selected Ad. No second Campaign store. */
(function(){
  'use strict';
  let ad=null, campaign='', business='', epoch=0, busy=false, dirty=false, pending=null, loading=null, saving=null, loadError=null, editVersion=0;
  const uuid=()=>crypto.randomUUID();
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  async function task(fn){if(busy)return;busy=true;document.querySelectorAll('#ad-workspace button,#ad-workspace select').forEach(b=>b.disabled=true);try{await fn();}catch(e){tell(e.message);}finally{busy=false;document.querySelectorAll('#ad-workspace button,#ad-workspace select').forEach(b=>b.disabled=false);}}
  function mount(){
    if(el('ad-workspace'))return;
    const host=el('campaign-content');if(!host)return;
    const box=document.createElement('section');box.id='ad-workspace';
    box.innerHTML='<p id="ad-message" role="status" aria-live="polite"></p><div id="ad-current" hidden><span id="ad-title" hidden></span><button type="button" data-action="save">Save details</button> <button type="button" data-action="run">Run Again</button> <button type="button" data-action="derive">Use As Starting Point</button><label>Call to action<input id="ad-cta" type="text" maxlength="12000"></label><label>Anything else about this Ad?<textarea id="ad-context" rows="3"></textarea></label><h3>Images</h3><div class="ad-images"><div><h4>Business Images</h4><div id="ad-business-images"></div></div><div><h4>Campaign Images</h4><div id="ad-campaign-images"></div><button type="button" data-action="upload">Upload image</button></div><div><h4>Images for This Ad</h4><div id="ad-selected-images"></div></div></div><div id="ad-run-choice" hidden><h3>Run this Ad again</h3><button type="button" data-action="as-is">Run As-Is</button> <button type="button" data-action="change-run">Change This Run</button><div id="ad-run-edit" hidden><p>Adjust the copy and images in the form. Choose where to save those changes.</p><button type="button" data-action="run-only">This Run Only</button> <button type="button" data-action="update-and-run">Update the Ad</button></div></div><div id="ad-prepared"></div></div>';
    const anchor=el('ad-form-anchor');
    if(anchor)anchor.parentNode.appendChild(box);else host.prepend(box);
    const style=document.createElement('style');style.textContent='#ad-workspace{padding:18px;margin-bottom:16px}#ad-workspace button{min-height:44px;margin:4px;padding:8px 12px}#ad-workspace label{display:block;margin:12px 0}#ad-workspace input,#ad-workspace textarea,#ad-workspace select{display:block;width:100%;box-sizing:border-box}.ad-images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.ad-image{display:inline-flex;flex-direction:column;width:104px;vertical-align:top}.ad-image img{width:80px;height:80px;object-fit:cover}.ad-copy{width:100%;min-height:100px}@media(max-width:700px){.ad-images{grid-template-columns:1fr}}';document.head.appendChild(style);
    box.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)task(()=>act(b.dataset.action,b.dataset.id));});
    box.addEventListener('input',markDirty);
  }

  async function list(){
    const requested=JSON.stringify(context());const result=await api('list');if(requested!==JSON.stringify(context()))return [];
    return result.ads;
  }
  function markDirty(){if(ad){dirty=true;editVersion++;}}
  function open(){
    mount();if(!el('ad-workspace'))return Promise.resolve();
    const seq=++epoch;campaign=activeCampaignId;business=window.activeBizId;ad=null;dirty=false;pending=null;loadError=null;window._bbActiveAd=null;
    const host=el('campaign-content');host.inert=true;
    el('ad-current').hidden=true;tell('Loading saved details…');
    for(const field of ['biz-ad-name','biz-offer','biz-price','ad-context','ad-cta'])if(el(field))el(field).value='';
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
    for(const [field,key] of Object.entries({'biz-ad-name':'name','biz-offer':'offer','biz-price':'price','ad-cta':'cta','ad-context':'context'})){if(el(field))el(field).value=ad[key]||'';}
    if(typeof platforms!=='undefined'){
      platforms=platforms.map(p=>({...p,enabled:(ad.platforms||[]).includes(p.id),adaptedContent:(ad.adaptations?.[p.id]||'').replace(/\n/g,'<br/>'),_reviewStatus:ad.platformStatus?.[p.id]==='excluded'?'skipped':ad.platformStatus?.[p.id]||'needs-review'}));
      if(typeof renderStep5Review==='function')renderStep5Review();
    }
    Object.assign(ynState,Object.fromEntries(['name','role','address','phone','email','website'].map(k=>[k,'no'])),ad.mentions||{});
    for(const [field,value] of Object.entries(ynState)){for(const choice of ['yes','no'])el('yn-'+field+'-'+choice)?.classList.toggle('yn-active',value===choice);}
    el('ad-current').hidden=false;window.BBBlasty?.fire('images.campaign_repository_intro');window.BBBlasty?.fire('images.ad_selection_intro');el('ad-title').textContent=activeCampaignName+' / '+ad.name;
    el('ad-run-choice').hidden=true;el('ad-run-edit').hidden=true;el('ad-prepared').replaceChildren();
    if(typeof renderStep3Platforms==='function')renderStep3Platforms();
    if(el('offer-count'))el('offer-count').textContent=(ad.offer||'').length+' / 500';
    if(typeof checkAdaptBtn==='function')checkAdaptBtn();
    return images();
  }
  function creative(){
    if(!ad)throw Error('Choose or create an Ad first.');
    return {name:el('biz-ad-name').value.trim()||'Untitled Ad',offer:el('biz-offer').value,price:el('biz-price').value,cta:el('ad-cta').value,context:el('ad-context').value,
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
      if(typeof renderStep5Review==='function')renderStep5Review();
    }
    dirty=editedDuringSave;pending=null;tell(dirty?'Saving your latest edits…':'Saved.');
    el('ad-prepared').innerHTML=(data.prepared||[]).map(b=>'<p>Prepared Blast '+esc(b.id)+' still contains the older Ad. <button type="button" data-action="update-prepared" data-id="'+esc(b.id)+'">Update It Too</button> <button type="button" data-action="leave-prepared">Leave It</button></p>').join('');
    return data;
  }
  async function save(){
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
    const [global,pool]=await Promise.all([window._bbLoadGlobalImages(),window._bbLoadCampaignImages(campaign)]);
    if(seq!==epoch)return;
    const selected=new Set((ad.imageRefs||[]).map(i=>i.id));
    const thumb=(i,action,label)=>'<button type="button" class="ad-image" data-action="'+action+'" data-id="'+esc(i.id)+'" draggable="'+(action==='select-image')+'"><img src="'+esc(i.url)+'" alt="'+esc(i.alt||'Campaign photo')+'">'+label+'</button>';
    el('ad-business-images').innerHTML=global.filter(i=>!i.retired).map(i=>thumb(i,'import-image','Add to campaign')).join('')||'<p>No business images.</p>';
    el('ad-campaign-images').innerHTML=pool.filter(i=>!i.retired&&!selected.has(i.id)).map(i=>thumb(i,'select-image','Use for this Ad')).join('')||'<p>All available images are selected.</p>';
    el('ad-selected-images').innerHTML=(ad.imageRefs||[]).map(i=>thumb(i,'remove-image','Remove from Ad')).join('')||'<p>Tap a campaign image to select it.</p>';
    el('ad-campaign-images').ondragstart=e=>{const b=e.target.closest('[data-id]');if(b)e.dataTransfer.setData('text/plain',b.dataset.id);};
    el('ad-selected-images').ondragover=e=>e.preventDefault();
    el('ad-selected-images').ondrop=e=>{e.preventDefault();task(()=>act('select-image',e.dataTransfer.getData('text/plain')));};
  }
  async function act(action,id){
    if(action==='derive'){
      if(dirty&&!confirm('Discard unsaved form changes?'))return;
      if(pending?.action!==action)pending={action,adId:uuid(),requestId:uuid()};
      const {adId,requestId}=pending;
      const data=await api('derive',{adId,requestId,sourceAdId:ad.id,creative:{name:ad.name+' copy'}});
      await fill(data.ad);await list();tell('Edit the Ad below. Save when ready.');return;
    }
    if(action==='save'){await save();return;}
    if(action==='run'){el('ad-run-choice').hidden=false;window.BBBlasty?.fire('ad.run_again_scope',{adName:ad.name,needed:true});return;}
    if(action==='as-is'){await prepare();return;}
    if(action==='change-run'){el('ad-run-edit').hidden=false;window.BBBlasty?.fire('ad.change_this_run_scope',{adName:ad.name,needed:true});return;}
    if(action==='run-only'){await prepare('this_run');return;}
    if(action==='update-and-run'){await save();await prepare();return;}
    if(action==='update-prepared'){
      await api('updatePrepared',{adId:ad.id,expectedRevision:ad.revision,blastId:id});
      tell('Prepared Blast updated. Open its preview and explicitly send or schedule it.');el('ad-prepared').replaceChildren();return;
    }
    if(action==='leave-prepared'){el('ad-prepared').replaceChildren();tell('Prepared Blasts retain their existing packets.');return;}
    if(action==='upload'){setPhotoScope('campaign');const input=el('img-input');if(input)input.click();else throw Error('Use Upload in the Campaign photo area below.');return;}
    if(action==='import-image'){
      const global=await window._bbLoadGlobalImages(),image=global.find(i=>i.id===id&&!i.retired);if(!image)throw Error('Image no longer available.');
      const pool=await window._bbLoadCampaignImages(campaign);
      if(!pool.some(i=>i.sourceImageId===id||i.url===image.url))await window._bbSaveCampaignImage(campaign,{url:image.url,path:image.path||'',alt:image.alt||'',sourceImageId:id});
      await images();return;
    }
    if(action==='select-image'){
      const pool=await window._bbLoadCampaignImages(campaign),image=pool.find(i=>i.id===id&&!i.retired);if(!image)throw Error('Image no longer available.');
      if(!(ad.imageRefs||[]).some(i=>i.id===id))ad.imageRefs=[...(ad.imageRefs||[]),image];
      markDirty();await images();tell('Image selected. Tap Save details to keep it.');window.BBBlasty?.fire('images.first_ad_image_selected');return;
    }
    if(action==='remove-image'){ad.imageRefs=(ad.imageRefs||[]).filter(i=>i.id!==id);markDirty();await images();tell('Selection removed; the campaign image is preserved.');}
  }
  document.addEventListener('input',e=>{
    if(['biz-ad-name','biz-offer','biz-price','ad-context','ad-cta'].includes(e.target.id))markDirty();
    const copy=e.target.closest('[contenteditable][id^="qp-copy-text-"]');
    if(copy){
      const id=copy.id.slice('qp-copy-text-'.length);
      platforms=platforms.map(p=>p.id===id?{...p,adaptedContent:(copy.innerText||copy.textContent||'').replace(/\n/g,'<br/>'),_reviewStatus:'needs-review'}:p);
      markDirty();
      if(typeof updateStep5UI==='function')updateStep5UI();
    }
  });
  window.BBAds={markDirty,open,ready,refreshImages:images,save,creative,prepareCurrent:()=>task(()=>prepare('this_run')),get active(){return ad;},get dirty(){return dirty;},get busy(){return busy||!!saving;},api};
})();
