/* The existing Campaign form edits one selected Ad. No second Campaign store. */
(function(){
  'use strict';
  let ad=null, campaign='', business='', epoch=0, busy=false, dirty=false, pending=null;
  const uuid=()=>crypto.randomUUID();
  const el=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const context=()=>({businessId:window.activeBizId,campaignId:activeCampaignId});
  async function api(action,body={}) {
    const ctx=context();
    if(!ctx.businessId||!ctx.campaignId||!window._bbGetToken)throw Error('Select a business and campaign first.');
    const response=await _bbFetchWithTimeout('https://us-central1-blastybiz-9523e.cloudfunctions.net/manageAd',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await window._bbGetToken()},
      body:JSON.stringify({...ctx,action,...body})
    },60000);
    const data=await response.json();if(!response.ok)throw Error(data.error||'Could not save the Ad.');return data;
  }
  function tell(message){el('ad-message').textContent=message;}
  async function task(fn){if(busy)return;busy=true;document.querySelectorAll('#ad-workspace button').forEach(b=>b.disabled=true);try{await fn();}catch(e){tell(e.message);}finally{busy=false;document.querySelectorAll('#ad-workspace button').forEach(b=>b.disabled=false);}}
  function mount(){
    if(el('ad-workspace'))return;
    const host=el('campaign-content');if(!host)return;
    const box=document.createElement('section');box.id='ad-workspace';box.className='card';
    box.innerHTML='<h2>Ads in this campaign</h2><div id="ad-list"></div><button type="button" data-action="new">New Ad</button> <button type="button" data-action="migration">Legacy preview</button><p id="ad-message" role="status" aria-live="polite"></p><div id="ad-current" hidden><h3 id="ad-title"></h3><p>Edit this Ad in the form below, then save. Campaign context and older Blasts stay preserved.</p><button type="button" data-action="save">Update the Ad</button> <button type="button" data-action="run">Run Again</button> <button type="button" data-action="derive">Use As Starting Point</button><label>Call to action<input id="ad-cta" type="text" maxlength="12000"></label><label>Anything else about this Ad?<textarea id="ad-context" rows="3"></textarea></label><h3>Images</h3><div class="ad-images"><div><h4>Business Images</h4><div id="ad-business-images"></div></div><div><h4>Campaign Images</h4><div id="ad-campaign-images"></div><button type="button" data-action="upload">Upload image</button></div><div><h4>Images for This Ad</h4><div id="ad-selected-images"></div></div></div><div id="ad-run-choice" hidden><h3>Run this Ad again</h3><button type="button" data-action="as-is">Run As-Is</button> <button type="button" data-action="change-run">Change This Run</button><div id="ad-run-edit" hidden><p>Adjust the copy and images in the form. Choose where to save those changes.</p><button type="button" data-action="run-only">This Run Only</button> <button type="button" data-action="update-and-run">Update the Ad</button></div></div><div id="ad-prepared"></div></div>';
    host.prepend(box);
    const style=document.createElement('style');style.textContent='#ad-workspace{padding:18px;margin-bottom:16px}#ad-workspace button{min-height:44px;margin:4px;padding:8px 12px}#ad-workspace label{display:block;margin:12px 0}#ad-workspace input,#ad-workspace textarea{display:block;width:100%;box-sizing:border-box}.ad-images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.ad-image{display:inline-flex;flex-direction:column;width:104px;vertical-align:top}.ad-image img{width:80px;height:80px;object-fit:cover}.ad-row{padding:12px 0;border-bottom:1px solid #555}.ad-copy{width:100%;min-height:100px}@media(max-width:700px){.ad-images{grid-template-columns:1fr}}';document.head.appendChild(style);
    box.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)task(()=>act(b.dataset.action,b.dataset.id));});
    box.addEventListener('input',()=>{dirty=true;});
  }
  async function list(){
    const requested=JSON.stringify(context());const result=await api('list');if(requested!==JSON.stringify(context()))return [];
    el('ad-list').innerHTML=result.ads.map(a=>'<div class="ad-row"><strong>'+esc(a.name)+'</strong><p>'+esc(a.createdAt?new Date(a.createdAt._seconds?a.createdAt._seconds*1000:a.createdAt).toLocaleDateString():'')+' · '+esc((a.platforms||[]).join(', '))+' · '+esc(a.status)+' · '+(a.blastCount||0)+' Blasts · revision '+a.revision+'</p><button type="button" data-action="view" data-id="'+esc(a.id)+'">View</button></div>').join('')||'<p>No Ads yet. Create an Ad or inspect your legacy creative.</p>';
    return result.ads;
  }
  async function open(){
    mount();if(!el('ad-workspace'))return;
    const seq=++epoch;campaign=activeCampaignId;business=window.activeBizId;ad=null;dirty=false;pending=null;window._bbActiveAd=null;
    el('ad-current').hidden=true;tell('Loading Ads…');
    try{const rows=await list();if(seq!==epoch)return;const wanted=new URLSearchParams(location.search).get('adId');if(wanted&&rows.some(a=>a.id===wanted))await fill(rows.find(a=>a.id===wanted));else if(rows.length===1&&rows[0].id==='first')await fill(rows[0]);tell(rows.length?'Choose an Ad or make a new one.':'Open Legacy preview to preserve existing creative, or make a New Ad.');}
    catch(e){if(seq===epoch)tell(e.message);}
  }
  function fill(next){
    ad=next;window._bbActiveAd=ad;dirty=false;pending=null;window._currentDraftId=null;window._bbPendingDraft=null;
    for(const [field,key] of Object.entries({'biz-ad-name':'name','biz-offer':'offer','biz-price':'price','ad-cta':'cta','ad-context':'context'})){if(el(field))el(field).value=ad[key]||'';}
    if(typeof platforms!=='undefined'){
      platforms=platforms.map(p=>({...p,enabled:(ad.platforms||[]).includes(p.id),adaptedContent:(ad.adaptations?.[p.id]||'').replace(/\n/g,'<br/>'),_reviewStatus:ad.platformStatus?.[p.id]||'needs-review'}));
      if(typeof renderStep5Review==='function')renderStep5Review();
    }
    Object.assign(ynState,Object.fromEntries(['name','role','address','phone','email','website'].map(k=>[k,'no'])),ad.mentions||{});
    for(const [field,value] of Object.entries(ynState)){for(const choice of ['yes','no'])el('yn-'+field+'-'+choice)?.classList.toggle('yn-active',value===choice);}
    el('ad-current').hidden=false;window.BBBlasty?.fire('images.campaign_repository_intro');window.BBBlasty?.fire('images.ad_selection_intro');el('ad-title').textContent=activeCampaignName+' / '+ad.name;
    el('ad-run-choice').hidden=true;el('ad-run-edit').hidden=true;el('ad-prepared').replaceChildren();
    if(typeof renderStep3Platforms==='function')renderStep3Platforms();
    if(typeof checkAdaptBtn==='function')checkAdaptBtn();
    return images();
  }
  function creative(){
    if(!ad)throw Error('Choose or create an Ad first.');
    return {name:el('biz-ad-name').value.trim()||'Untitled Ad',offer:el('biz-offer').value,price:el('biz-price').value,cta:el('ad-cta').value,context:el('ad-context').value,
      mentions:{...ynState},platforms:platforms.filter(p=>p.enabled).map(p=>p.id),imageRefs:(ad.imageRefs||[]).map(i=>({id:i.id})),
      adaptations:Object.fromEntries(platforms.filter(p=>p.enabled&&p.adaptedContent).map(p=>[p.id,p.adaptedContent.replace(/<br\s*\/?\s*>/gi,'\n')])),
      platformStatus:Object.fromEntries(platforms.filter(p=>p.enabled).map(p=>[p.id,p._reviewStatus==='approved'?'approved':'needs-review']))};
  }
  async function save(){
    const values=creative();if(pending?.action!=='save')pending={action:'save',requestId:uuid(),values};
    const data=await api('save',{adId:ad.id,expectedRevision:ad.revision,requestId:pending.requestId,creative:pending.values});
    ad=data.ad;window._bbActiveAd=ad;
    platforms=platforms.map(p=>({...p,_reviewStatus:ad.platformStatus?.[p.id]||'needs-review'}));
    if(typeof renderStep5Review==='function')renderStep5Review();
    dirty=false;pending=null;tell('Ad saved. Past Blasts retain their original copy and images.');await list();
    el('ad-prepared').innerHTML=(data.prepared||[]).map(b=>'<p>Prepared Blast '+esc(b.id)+' still contains the older Ad. <button type="button" data-action="update-prepared" data-id="'+esc(b.id)+'">Update It Too</button> <button type="button" data-action="leave-prepared">Leave It</button></p>').join('');
    return data;
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
    if(action==='new'||action==='derive'){
      if(dirty&&!confirm('Discard unsaved form changes?'))return;
      if(pending?.action!==action)pending={action,adId:uuid(),requestId:uuid()};
      const {adId,requestId}=pending;
      const data=await api(action==='new'?'create':'derive',{adId,requestId,...(action==='derive'?{sourceAdId:ad.id}:{}),creative:{name:action==='derive'?ad.name+' copy':'New Ad'}});
      await fill(data.ad);await list();tell('Edit the Ad below. Save when ready.');return;
    }
    if(action==='view'){
      window.BBBlasty?.fire('ad.existing_campaign_open',{needed:true});
      if(dirty&&!confirm('Discard unsaved form changes?'))return;
      await fill((await api('get',{adId:id})).ad);tell('Ad opened. Changes are saved only when you choose Update the Ad.');return;
    }
    if(action==='migration'){
      const result=await api('previewLegacy');
      tell('Preview: '+(result.wouldCreate?'one legacy Ad':'existing legacy Ad')+' from campaign '+campaign+(result.proposal.legacySource?.draftId?' and draft '+result.proposal.legacySource.draftId:'')+'. Historical records will stay unchanged.');
      if(confirm('Create/open this legacy Ad from the preview?')){
        const made=await api('materializeLegacy',{sourceHash:result.sourceHash});await fill(made.ad);await list();
      }return;
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
      dirty=true;await images();tell('Image selected. Save the Ad or choose This Run Only.');window.BBBlasty?.fire('images.first_ad_image_selected');return;
    }
    if(action==='remove-image'){ad.imageRefs=(ad.imageRefs||[]).filter(i=>i.id!==id);dirty=true;await images();tell('Selection removed; the campaign image is preserved.');}
  }
  document.addEventListener('input',e=>{if(['biz-ad-name','biz-offer','biz-price','ad-context','ad-cta'].includes(e.target.id))dirty=true;});
  window.BBAds={markDirty:()=>{if(ad)dirty=true;},open,refreshImages:images,save,creative,prepareCurrent:()=>task(()=>prepare('this_run')),get active(){return ad;},get dirty(){return dirty;},get busy(){return busy;},api};
})();
