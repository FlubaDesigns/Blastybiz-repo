/* Owner controls for the one Ad schedule and canonical Blast results. */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let context=null,dashboardEpoch=0,activeEditor=null;
 const fire=(event,values={})=>window.BBBlasty?.fire(event,{needed:true,...values});
 async function api(action,values={}) {
   const ctx=context;if(!ctx?.businessId)throw Error('Choose a business first.');
   const token=await ctx.token();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);let r;try{r=await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/manageBlast',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({businessId:ctx.businessId,action,...values})});}catch(error){if(error.name==='AbortError')throw Error('This request took too long. Your edits are kept here; try again.');throw error;}finally{clearTimeout(timer);}
   const data=await r.json();if(!r.ok)throw Error(data.error||'Your choice could not be saved.');return data;
 }
 function configure(c){context=c;}
 const date=(v,zone)=>v?new Date(v).toLocaleString(undefined,{timeZone:zone||undefined,timeZoneName:'short'}):'—';
 const localValue=(v,zone)=>{const p=BBSchedule.localParts(new Date(v),zone);return p.year+'-'+String(p.month).padStart(2,'0')+'-'+String(p.day).padStart(2,'0')+'T'+String(p.hour).padStart(2,'0')+':'+String(p.minute).padStart(2,'0');};
 function fromLocal(raw,zone){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))throw Error('Choose a future date and time.');const [ymd,hm]=raw.split('T'),[y,m,d]=ymd.split('-').map(Number),[h,min]=hm.split(':').map(Number);const value=BBSchedule.wallTime(y,m-1,d,h,zone,min);if(!Number.isFinite(value.getTime())||value<=new Date())throw Error('Choose a future date and time.');return value;}
 function hasUnsavedChanges(){if(!activeEditor?.host.isConnected)return false;const section=activeEditor.host.closest('.section');if(section&&!section.classList.contains('active'))return false;try{return JSON.stringify(activeEditor.value())!==activeEditor.saved;}catch(_){return true;}}
 function canLeave(){if(!hasUnsavedChanges())return true;if(!confirm('Your schedule changes are not saved. Leave and discard those changes?'))return false;activeEditor=null;return true;}

 // Friendly choices use real IANA zone IDs; conversion stays in BBSchedule.
 function timeZoneChoices(selected) {
   const common=[['America/New_York','Eastern Time (ET)'],['America/Chicago','Central Time (CT)'],['America/Denver','Mountain Time (MT)'],['America/Los_Angeles','Pacific Time (PT)'],['America/Anchorage','Alaska Time'],['Pacific/Honolulu','Hawaii Time'],['America/Phoenix','Arizona Time'],['America/Halifax','Atlantic Time'],['America/St_Johns','Newfoundland Time'],['UTC','Coordinated Universal Time (UTC)']];
   let supported=[];try{supported=Intl.supportedValuesOf('timeZone');}catch(_){}
   const extra=[...new Set([...supported,selected])].filter(zone=>!common.some(([id])=>id===zone)).map(zone=>{
     const name=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longGeneric'}).formatToParts(new Date()).find(p=>p.type==='timeZoneName').value;
     return [zone,name+' — '+zone.split('/').slice(1).join(' / ').replaceAll('_',' ')];
   }).sort((a,b)=>a[1].localeCompare(b[1]));
   const options=rows=>rows.map(([id,label])=>'<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(label)+'</option>').join('');
   return '<optgroup label="Common time zones">'+options(common)+'</optgroup><optgroup label="More time zones">'+options(extra)+'</optgroup>';
 }
 function form(host,initial={}) {
   const zone=initial.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
   host.innerHTML='<div class="bb-step-label">1 · WHEN</div><label>Next blast<input type="datetime-local" data-field="date" required></label><div class="bb-quick">'+[[24,'Tomorrow'],[72,'In 3 days'],[168,'Next week']].map(([h,t])=>'<button type="button" data-hours="'+h+'">'+t+'</button>').join('')+'</div><div class="bb-schedule-row"><label>Repeat<select data-field="frequency"><option value="once">Just once</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label><label data-field="recurring" hidden>Stop after<select data-field="count"><option value="0">Until I stop it</option><option value="4">4 blasts</option><option value="8">8 blasts</option><option value="12">12 blasts</option><option value="26">26 blasts</option></select></label></div><details class="bb-timezone"><summary data-zone-label></summary><label>Time zone<select data-field="timezone">'+timeZoneChoices(zone)+'</select></label><p class="bb-small">The date and time above use this time zone. Daylight saving time is handled automatically.</p></details><details data-repeat-options hidden><summary>Options for future repeats</summary><label>Wording<select data-field="copy"><option value="reuse">Keep approved wording</option><option value="refresh">Create fresh wording for my review</option><option value="ask">Ask me each time</option></select></label><label>Photos<select data-field="images"><option value="reuse">Keep approved photos</option><option value="remind">Remind me to change photos</option><option value="ask">Ask me each time</option></select></label><label>Approval<select data-field="approval"><option value="automatic">Use my approved post automatically</option><option value="always">Ask before every repeat</option><option value="attention">Ask when something needs attention</option></select></label></details><p data-field="resolved" role="status" hidden></p><p data-field="summary" class="bb-schedule-summary" aria-live="polite"></p>';
   const get=n=>host.querySelector('[data-field="'+n+'"]');
   const zoned=v=>localValue(v,get('timezone').value);
   const futureDay=days=>{const p=window.BBSchedule.localParts(new Date(),get('timezone').value),day=new Date(Date.UTC(p.year,p.month-1,p.day+days));return day.toISOString().slice(0,10)+'T'+String(p.hour).padStart(2,'0')+':'+String(p.minute).padStart(2,'0');};
   get('date').value=initial.nextRunAt||initial.firstRunAtUtc?zoned(initial.nextRunAt||initial.firstRunAtUtc):futureDay(1);
   get('frequency').value=initial.frequency||'once';get('count').value=initial.stopMode==='count'?String(initial.stopAfterCount):'0';
   if(!get('count').value){const option=document.createElement('option');option.value=String(initial.stopAfterCount);option.textContent=initial.stopAfterCount+' blasts';get('count').append(option);get('count').value=option.value;}
   get('copy').value=initial.copyBehavior||'reuse';get('images').value=initial.imageBehavior||'reuse';get('approval').value=initial.approvalBehavior||'automatic';
   function value(){const d=fromLocal(get('date').value,get('timezone').value);return {firstRunAtUtc:d.toISOString(),timezone:get('timezone').value,frequency:get('frequency').value,stopMode:Number(get('count').value)?'count':'never',stopAfterCount:Number(get('count').value),copyBehavior:get('copy').value,imageBehavior:get('images').value,approvalBehavior:get('approval').value};}
   function update(){
     host.querySelector('[data-zone-label]').textContent='Time zone · '+get('timezone').selectedOptions[0].textContent;
     const once=get('frequency').value==='once';get('recurring').hidden=once;host.querySelector('.bb-schedule-row').classList.toggle('bb-once',once);host.querySelector('[data-repeat-options]').hidden=once;
     host.querySelectorAll('[data-hours]').forEach(b=>b.setAttribute('aria-pressed','false'));
     try{const v=value();get('resolved').hidden=true;get('summary').textContent=scheduleSummary({...v,nextRunAt:v.firstRunAtUtc});}
     catch(e){get('resolved').hidden=false;get('resolved').textContent=e.message;get('summary').textContent='';}
   }
   host.addEventListener('change',update);
   host.addEventListener('click',e=>{const b=e.target.closest('[data-hours]');if(b){get('date').value=futureDay(Number(b.dataset.hours)/24);host.dispatchEvent(new Event('change',{bubbles:true}));b.setAttribute('aria-pressed','true');}});
   let savedKey=null,request=null;update();return {value,summary:()=>get('summary').textContent,requestId(){const key=JSON.stringify(value());if(key!==savedKey){savedKey=key;request=crypto.randomUUID();}return request;}};
 }
 function scheduleSummary(s){
   const time=s.nextRunAt||s.firstRunAtUtc;if(!time)return 'No upcoming blast';
   const when=new Intl.DateTimeFormat(undefined,{timeZone:s.timezone||undefined,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(time));
   const repeat={once:'Just once',weekly:'Weekly',biweekly:'Every 2 weeks',monthly:'Monthly',quarterly:'Quarterly'}[s.frequency]||s.frequency;
   return when+' · '+repeat+(s.frequency!=='once'&&s.stopMode==='count'?' · '+Math.max(0,s.stopAfterCount-(s.runsCompleted||0))+' remaining':'');
 }
 function photoPicker(host,state,request) {
   const originals=state.packet.imageRefs||[];let selected=[...originals],pool=[...state.imagePool],busy=false,generationId=null,generationPrompt='';
   host.innerHTML='<div class="bb-step-label">2 · YOUR NEXT POST</div><div class="bb-post-preview"><div data-selected class="bb-selected-photos"></div><div class="bb-post-caption"><strong>'+esc(state.packet.adName||'Your post')+'</strong><p>'+esc(Object.values(state.packet.adaptations)[0]||'')+'</p><details><summary>Read full post</summary>'+Object.entries(state.packet.adaptations).map(([p,t])=>'<h4>'+esc(p)+'</h4><p>'+esc(t)+'</p>').join('')+'</details></div></div><div class="bb-photo-choices"><button type="button" data-photo-mode="keep">Keep current</button><button type="button" data-photo-mode="library">Choose / upload</button><button type="button" data-photo-mode="ai">Create with AI</button></div><div data-library hidden><p>Tap photos to choose them for the next blast.</p><div data-pool class="bb-photo-pool"></div><label class="bb-upload-button">+ Upload a photo<input type="file" accept="image/*,.heic,.heif" data-upload></label></div><div data-ai hidden><label>What should the image show?<textarea data-prompt maxlength="2000" placeholder="Example: A bright, welcoming storefront with spring flowers. No text."></textarea></label><p class="bb-small">Uses 1 AI credit per creation attempt from your plan.</p><button type="button" data-generate>Create Image · 1 credit</button><button type="button" data-new-image hidden>Create Another · 1 credit</button><div data-generated hidden></div></div><p data-photo-message role="status"></p><label class="bb-check-row" data-repeat-images hidden><input type="checkbox" data-use-repeats>Use these photos for future repeats too</label><p class="bb-small" data-image-scope>Photo changes apply to the next blast only.</p>';
   const get=s=>host.querySelector(s),message=get('[data-photo-message]');
   function changed(){render();host.dispatchEvent(new Event('change',{bubbles:true}));}
   function render(){get('[data-selected]').innerHTML=selected.length?selected.map(i=>'<img src="'+esc(i.url)+'" alt="'+esc(i.alt||'Selected post photo')+'">').join(''):'<p class="bb-no-photo">Text-only post</p>';get('[data-pool]').innerHTML=pool.map(i=>'<button type="button" data-pick="'+esc(i.id)+'" aria-pressed="'+selected.some(s=>s.id===i.id)+'" aria-label="'+esc(i.alt||'Select photo')+'"><img src="'+esc(i.url)+'" alt="'+esc(i.alt||'Library photo')+'"><span>'+ (selected.some(s=>s.id===i.id)?'✓ Selected':'Choose')+'</span></button>').join('');}
   function setBusy(v){busy=v;host.querySelectorAll('button,input,textarea').forEach(x=>x.disabled=v);host.dispatchEvent(new Event('change',{bubbles:true}));}
   host.addEventListener('click',async e=>{
     const mode=e.target.closest('[data-photo-mode]');if(mode){const m=mode.dataset.photoMode;get('[data-library]').hidden=m!=='library';get('[data-ai]').hidden=m!=='ai';host.querySelectorAll('[data-photo-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===mode)));if(m==='keep'){selected=[...originals];changed();}return;}
     const pick=e.target.closest('[data-pick]');if(pick){const item=pool.find(i=>i.id===pick.dataset.pick);selected=selected.some(i=>i.id===item.id)?selected.filter(i=>i.id!==item.id):[...selected,item];changed();return;}
     if(e.target.closest('[data-use-generated]')){selected=[get('[data-generated]')._image];message.textContent='New image selected for your next blast.';changed();return;}
     if(e.target.closest('[data-generate],[data-new-image]')){
       const prompt=get('[data-prompt]').value.trim();if(!prompt){message.textContent='Describe the image you want first.';get('[data-prompt]').focus();return;}
       if(e.target.closest('[data-new-image]')||prompt!==generationPrompt||!generationId){generationId=crypto.randomUUID();generationPrompt=prompt;}
       setBusy(true);message.textContent='Creating your image… Keep this page open.';
       try{const result=await api('generateImage',{...request,prompt,requestId:generationId});const image=result.image;
         if(!pool.some(i=>i.id===image.id))pool.push(image);const preview=get('[data-generated]');preview._image=image;preview.hidden=false;preview.innerHTML='<img src="'+esc(image.url)+'" alt="'+esc(image.alt||'AI image preview')+'"><button type="button" data-use-generated>Use This Image</button>';get('[data-generate]').hidden=true;get('[data-new-image]').hidden=false;message.textContent='Preview your image, then tap Use This Image.';render();
       }catch(error){message.textContent=error.message;get('[data-generate]').textContent='Check Image';get('[data-new-image]').hidden=false;}finally{setBusy(false);}
     }
   });
   get('[data-upload]').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);message.textContent='Preparing your photo…';try{const photos=await import('./photo-library.js?v=20261002');const image=await photos.uploadCampaign(file,{businessId:context.businessId,campaignId:request.campaignId,onProgress:p=>{message.textContent='Uploading photo… '+p+'%';}});pool.push(image);selected=[image];message.textContent='Photo selected for your next blast.';changed();}catch(error){message.textContent=error.message;}finally{e.target.value='';setBusy(false);}};
   get('[data-use-repeats]').onchange=e=>{get('[data-image-scope]').textContent=e.target.checked?'These photos will also be used for future repeats.':'Photo changes apply to the next blast only.';};
   render();return {value:()=>({imageIds:selected.map(i=>i.id),applyImagesToRepeats:get('[data-use-repeats]').checked}),busy:()=>busy,repeat:v=>{get('[data-repeat-images]').hidden=!v;if(!v)get('[data-use-repeats]').checked=false;}};
 }
 async function scheduleEditor(host,request,onSaved,onCancel) {
   host.innerHTML='<p role="status">Loading your next post…</p>';
   try{
     const state=await api('editor',request);if(!host.isConnected)return;
     host.innerHTML='<div data-time></div><div data-photos></div><div class="bb-save-bar"><p data-summary></p><button type="button" class="bb-primary" data-save>Save Schedule</button><button type="button" class="bb-text-button" data-dismiss>Cancel</button><p class="bb-small">Saving approves this post for the selected time. Copy-and-paste platforms still need you to post.</p><p role="status" data-save-message></p></div>';
     const time=form(host.querySelector('[data-time]'),state.schedule),photos=photoPicker(host.querySelector('[data-photos]'),state,request),save=host.querySelector('[data-save]'),message=host.querySelector('[data-save-message]');
     host.querySelector('[data-time] [data-field=summary]').hidden=true;
     function update(){host.querySelector('[data-summary]').textContent=time.summary();try{photos.repeat(time.value().frequency!=='once');save.disabled=photos.busy();}catch(_){save.disabled=true;}}
     const values=()=>({schedule:[...host.querySelectorAll('[data-time] input,[data-time] select')].map(el=>[el.dataset.field,el.value]),...photos.value()});
     activeEditor={host,value:values,saved:JSON.stringify(values())};
     host.addEventListener('change',update);update();
     host.querySelector('[data-dismiss]').onclick=()=>{if(canLeave()){activeEditor=null;onCancel();}};
     let lastKey=null,requestId=null;
     save.onclick=async()=>{if(save.disabled)return;try{
       const payload={...request,sourceBlastId:state.sourceBlastId,expectedRevision:state.schedule.revision||0,reviewKey:state.reviewKey,reviewed:true,replacePrepared:true,schedule:time.value(),...photos.value()};
       const key=JSON.stringify(payload);if(key!==lastKey){lastKey=key;requestId=crypto.randomUUID();}
       host.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=true);message.textContent='Saving your schedule…';
       const result=await api('save',{...payload,requestId});fire('schedule.created');activeEditor=null;onSaved(result);
     }catch(error){message.textContent=error.message;host.querySelectorAll('button,input,select,textarea').forEach(x=>x.disabled=false);update();}};
   }catch(error){host.innerHTML='<p role="status">'+esc(error.message)+'</p><button type="button" data-reload>Try Again</button>';host.querySelector('button').onclick=()=>scheduleEditor(host,request,onSaved,onCancel);}
 }
 async function preview(data,blastId) {
   const host=document.getElementById('v1-publish-schedule');if(!host)return;
   host.classList.add('bb-life');
   if(!data?.adId){host.innerHTML='<h2>Scheduling</h2><p>Open the campaign and create an Ad before setting a schedule.</p>';return;}
   if(data.scheduleAdPath){host.innerHTML='<h2>'+esc(data.campaignName)+' / '+esc(data.adName)+'</h2><p>This is a scheduled Blast. Review or change it in Schedule.</p><a class="bb-button" href="BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,tab:'schedule'})+'">Open Schedule</a>';document.getElementById('publish-btn').hidden=true;return;}
   host.innerHTML='<h2>Send later</h2><p>Choose a time and review your photos in Schedule.</p>';
   const link=document.createElement('a');link.className='bb-button';link.textContent='Open Schedule';
   link.href='BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,tab:'schedule',cid:data.campaignId,adId:data.adId,scheduleAd:data.adId,scheduleCampaign:data.campaignId});host.append(link);

 }
 function futureSchedule(host,data) {
   if(!host||!data?.adId||!data?.campaignId||data.status!=='approved')return;
   host.hidden=false;host.classList.add('bb-life');
   const url='BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,tab:'schedule',cid:data.campaignId,adId:data.adId,scheduleAd:data.adId,scheduleCampaign:data.campaignId,sourceBlastId:context.blastId||new URLSearchParams(location.search).get('draftId')||''});
   host.innerHTML='<a class="bb-button bb-primary" href="'+esc(url)+'">Schedule your next blast →</a>';
 }
 function scheduleSetup(host,request) {
   host.hidden=false;host.classList.add('bb-life');
   const scheduleUrl='BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,tab:'schedule',cid:request.campaignId,adId:request.adId,scheduleAd:request.adId,scheduleCampaign:request.campaignId});
   function intro(){host.innerHTML='<h2>Plan your next blast</h2><p>Your post is ready to use again. Choose when it goes out and which photos to use.</p><button type="button" data-setup>Set Up a Schedule</button><a class="bb-button" href="'+esc(scheduleUrl)+'">View Schedules</a>';host.querySelector('[data-setup]').onclick=open;}
   function open(){host.innerHTML='<h2>Schedule your next blast</h2><div data-form></div>';scheduleEditor(host.querySelector('[data-form]'),request,confirmed,intro);}
   function confirmed(result){dashboard(true);const s=result.schedule;host.innerHTML='<div class="bb-schedule-success"><span aria-hidden="true">✓</span><h2>YOU’RE SCHEDULED</h2><p>'+esc(scheduleSummary(s))+'</p><p>Your next post and photos are saved.</p></div><button type="button" data-edit>Edit Schedule</button><button type="button" data-cancel>Cancel Schedule</button><a class="bb-button bb-primary" href="'+esc(scheduleUrl)+'">Done</a><p role="status"></p>';host.querySelector('[data-edit]').onclick=open;host.querySelector('[data-cancel]').onclick=async e=>{if(!confirm('Cancel this future schedule?'))return;e.target.disabled=true;try{await api('cancel',{...request,expectedRevision:s.revision});intro();dashboard(true);}catch(error){host.querySelector('[role=status]').textContent=error.message;e.target.disabled=false;}};}
   open();
 }
 async function dashboard(preserveEditor=false) {
   if(!preserveEditor&&!canLeave())return;
   const seq=++dashboardEpoch,wrap=document.getElementById('sched-campaigns-wrap');if(!wrap||!context)return;
   document.getElementById('sched-upcoming-card')?.setAttribute('hidden','');document.getElementById('sched-no-campaigns')?.setAttribute('hidden','');
   wrap.classList.add('bb-life');wrap.innerHTML='<p role="status">Loading schedules…</p>';
   try {
     const result=await api('list');if(seq!==dashboardEpoch)return;
     const rows=result.schedules,active=rows.filter(r=>r.schedule.enabled).sort((a,b)=>new Date(a.schedule.nextRunAt)-new Date(b.schedule.nextRunAt)),others=rows.filter(r=>!r.schedule.enabled);
     const setup=document.getElementById('schedule-editor'),route=new URLSearchParams(location.search),selected=window.BBAds?.active;
     if(setup&&!preserveEditor){
       const request=route.get('scheduleAd')&&route.get('scheduleCampaign')&&(!selected||selected.campaignId===route.get('scheduleCampaign'))?{adId:route.get('scheduleAd'),campaignId:route.get('scheduleCampaign'),sourceBlastId:route.get('sourceBlastId')||undefined}:selected?{adId:selected.id,campaignId:selected.campaignId}:null;
       if(request){
         scheduleSetup(setup,request);
       }else{setup.innerHTML='<p>Select your campaign in Create, then return here to schedule its next blast.</p>';}
     }
     const next=active[0];wrap.innerHTML='<h2>Next Up</h2><p>'+esc(next?next.campaignName+' / '+next.adName+' — '+scheduleSummary(next.schedule):'Nothing scheduled. You can still Send Now.')+'</p><p role="status" id="bb-schedule-message"></p><div data-active></div><details><summary>Paused and completed ('+others.length+')</summary><div data-others></div></details>';
     if(result.businessPaused){const resume=document.createElement('button');resume.textContent='Business scheduling is paused — Resume';resume.onclick=async()=>{try{await api('resumeBusiness');await dashboard();}catch(e){wrap.querySelector('#bb-schedule-message').textContent=e.message;}};wrap.prepend(resume);}
     const message=t=>{wrap.querySelector('#bb-schedule-message').textContent=t;};
     for(const row of rows) {
       const {schedule:s,upcoming:u}=row,card=document.createElement('article'),status=u?.approvalStatus==='required'&&s.enabled?'WAITING FOR APPROVAL':s.status||'active';
       const request={adId:row.adId,campaignId:row.campaignId,expectedRevision:s.revision};
       card.innerHTML='<h3>'+esc(row.campaignName)+' / '+esc(row.adName)+'</h3><strong>'+esc(status.toUpperCase())+'</strong>'+(s.pauseReason?'<p>'+esc(s.pauseReason)+'</p>':'')+'<p>Next: '+esc(scheduleSummary(s))+'</p><p>Copy: '+esc({reuse:'Keep approved wording',refresh:'Fresh wording for review',ask:'Ask each time'}[s.copyBehavior]||'Keep approved wording')+' · Photos: '+esc({reuse:'Keep approved photos',remind:'Remind me to change',ask:'Ask each time'}[s.imageBehavior]||'Keep approved photos')+' · Approval: '+esc({automatic:'Use approved post',always:'Ask every time',attention:'Ask when needed'}[s.approvalBehavior]||'Ask when needed')+'</p>'+(row.last?'<p>Last run: '+esc(date(row.last.startedAt,s.timezone))+' · '+(row.last.completion?.delivered||0)+' delivered · '+(row.last.completion?.manual||0)+' need you. <a href="'+esc(statusLink(context.businessId,row.last.id))+'">View status</a></p>':'')+'<button data-action="'+(s.enabled?'pause':'resume')+'" '+(s.status==='completed'?'hidden':'')+'>'+(s.enabled?'Pause':'Resume')+'</button><button data-action="skipNext" '+(!s.nextRunAt?'hidden':'')+'>Skip Next</button><button data-action="edit">Edit Schedule &amp; Photos</button><button data-action="cancel" '+(!s.enabled?'hidden':'')+'>Cancel Schedule</button><details><summary>Move only the next post</summary><p>'+esc(s.timezone||'Local time')+'</p><label>New date and time<input type="datetime-local" data-next value="'+esc(s.nextRunAt?localValue(s.nextRunAt,s.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone):'')+'"></label><button data-action="changeNext" '+(!s.nextRunAt?'hidden':'')+'>Change Next Time</button></details><div data-edit hidden></div><div data-review></div><p role="status"></p>';
       const review=card.querySelector('[data-review]');
       if(u){review.innerHTML='<details><summary>Review / Change Next Post</summary><p>'+esc(u.preparationState==='working'?'Preparing fresh copy…':u.copyFallbackReason==='allowance_ceiling'?'Fresh wording is unavailable this month. Saved approved copy is ready to reuse.':u.copyFallbackReason?'Refresh was unavailable. Saved copy is ready to review.':'Review these exact copy and image selections.')+'</p>'+Object.entries(u.packet.adaptations).map(([p,text])=>'<label>'+esc(p)+'<textarea data-copy="'+esc(p)+'">'+esc(text)+'</textarea></label>').join('')+'<div>'+row.imagePool.map(i=>'<label><input type="checkbox" data-image="'+esc(i.id)+'" '+(u.packet.imageRefs.some(x=>x.id===i.id)?'checked':'')+'><img src="'+esc(i.url)+'" alt="'+esc(i.alt||'Campaign image')+'">Use this image</label>').join('')+'</div><p>Changes below apply only to this Blast. <a href="BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,cid:row.campaignId,adId:row.adId})+'">Update the reusable Ad</a></p><button data-action="editNext">Save This Run Only</button><button data-action="refreshNext">Refresh Wording</button><label><input type="checkbox" data-reviewed> I reviewed this copy and want to keep these images</label><button data-action="approveNext">'+(s.copyBehavior==='ask'?'Approve — Reuse This Copy':'Approve This Blast')+'</button></details>';}
       if(!u&&s.nextRunAt){const prepare=document.createElement('button');prepare.dataset.action='prepareNext';prepare.textContent='Prepare / Review Next Post';review.append(prepare);}
       const route=new URLSearchParams(location.search);if(route.get('scheduleAd')===row.adId&&route.get('scheduleCampaign')===row.campaignId){const details=review.querySelector('details');if(details)details.open=true;if(route.get('scheduledBlastId')&&route.get('scheduledBlastId')!==u?.id)card.querySelector(':scope > [role=status]').textContent='That email preview is no longer current. Review the current next Blast before choosing an action.';}
       let editor=null;
       card.addEventListener('click',async e=>{
         const button=e.target.closest('[data-action]');if(!button)return;const action=button.dataset.action,local=card.querySelector(':scope > [role=status]');
         if(action==='edit'){if(!canLeave())return;const box=document.getElementById('schedule-editor')||card.querySelector('[data-edit]');scheduleSetup(box,request);box.scrollIntoView?.({block:'start',behavior:'smooth'});return;}
         if(action==='approveNext'&&!card.querySelector('[data-reviewed]')?.checked){local.textContent='Review the copy and images, then check the confirmation.';return;}
         if(['skipNext','save','cancel'].includes(action)&&!confirm(action==='cancel'?'Cancel this future schedule?':action==='save'?'Replace this schedule and any unsent prepared Blast? The stop-after count starts again.':'Skip only the next occurrence?'))return;
         const extras={};
         try {
           if(action==='save')Object.assign(extras,{schedule:editor.value(),requestId:editor.requestId(),replacePrepared:true});
           if(action==='changeNext'){const d=fromLocal(card.querySelector('[data-next]').value,s.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone);extras.nextRunAt=d.toISOString();}
           if(action==='approveNext')Object.assign(extras,{packetRevision:u.revision,keepImages:true,copyChoice:u.packet.copyBehavior==='refresh'?'refresh':'reuse'});
           if(action==='editNext')Object.assign(extras,{packetRevision:u.revision,adaptations:Object.fromEntries([...card.querySelectorAll('[data-copy]')].map(x=>[x.dataset.copy,x.value])),imageIds:[...card.querySelectorAll('[data-image]:checked')].map(x=>x.dataset.image)});
           if(action==='approveNext') {
             const changed=[...card.querySelectorAll('[data-copy]')].some(x=>x.value!==u.packet.adaptations[x.dataset.copy])||JSON.stringify([...card.querySelectorAll('[data-image]:checked')].map(x=>x.dataset.image).sort())!==JSON.stringify(u.packet.imageRefs.map(x=>x.id).sort());
             if(changed)throw Error('Save This Run Only before approving your changes.');
           }
           card.querySelectorAll('button').forEach(x=>x.disabled=true);local.textContent='Saving…';
           const saved=await api(action,{...request,...extras});if(action==='pause')fire('schedule.paused');
           await dashboard();const msg=document.getElementById('bb-schedule-message');if(msg)msg.textContent='Saved.'+(saved.overlaps?.length?' Overlap within one hour: '+saved.overlaps.map(o=>o.campaignName+' / '+o.adName).join(', '):'');
         }catch(err){local.textContent=err.message;card.querySelectorAll('button').forEach(x=>x.disabled=false);}
       });
       wrap.querySelector(s.enabled?'[data-active]':'[data-others]').append(card);
     }
     for(const old of result.legacy||[]) {
       const legacy=document.createElement('article');legacy.innerHTML='<h3>'+esc(old.campaignName)+' — Earlier schedule</h3><p>Next: '+esc(date(old.nextRunAt))+'</p><p>This earlier schedule can be paused here. Open the campaign to create and schedule an Ad.</p><a class="bb-button" href="BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,cid:old.campaignId})+'">Open campaign</a><button>Pause schedule</button>';
       legacy.querySelector('button').onclick=async()=>{try{await api('pauseLegacy',{blastId:old.id});await dashboard();}catch(e){message(e.message);}};wrap.append(legacy);
     }
     fire('schedule.next_up_summary',{summary:next?next.campaignName+' / '+next.adName+' — '+scheduleSummary(next.schedule):'Nothing scheduled right now.'});
   }catch(e){if(seq===dashboardEpoch)wrap.textContent=e.message;}
 }
 function statusLink(b,d){return 'BlastyBiz-Publishing-Status.html?'+new URLSearchParams({bizId:b,draftId:d});}
 window.BBLifecycle={configure,api,preview,futureSchedule,dashboard,statusLink,form,photoPicker,scheduleEditor,hasUnsavedChanges,canLeave};
})();

