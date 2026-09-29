/* Owner controls for the one Ad schedule and canonical Blast results. */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let context=null,dashboardEpoch=0;
 const fire=(event,values={})=>window.BBBlasty?.fire(event,{needed:true,...values});
 async function api(action,values={}) {
   const ctx=context;if(!ctx?.businessId)throw Error('Choose a business first.');
   const token=await ctx.token();const r=await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/manageBlast',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({businessId:ctx.businessId,action,...values})});
   const data=await r.json();if(!r.ok)throw Error(data.error||'Your choice could not be saved.');return data;
 }
 function configure(c){context=c;}
 const date=v=>v?new Date(v).toLocaleString():'—';
 const localValue=v=>{const d=new Date(v);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 function form(host,initial={}) {
   const zone=initial.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
   host.innerHTML='<label>First post <input type="datetime-local" data-field="date" required></label><p data-field="resolved" role="status"></p><div class="bb-quick">'+[[12,'In 12 hours'],[24,'Tomorrow'],[72,'In 3 days'],[168,'In 1 week']].map(([h,t])=>'<button type="button" data-hours="'+h+'">'+t+'</button>').join('')+'</div><label>Timezone <input data-field="timezone" value="'+esc(zone)+'"></label><div data-field="refire" hidden><label>Refire <select data-field="frequency"><option value="once">Just once</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></label><div data-field="recurring" hidden><label>Stop after <select data-field="count"><option value="0">Until I stop it</option><option value="4">4 Blasts</option><option value="8">8 Blasts</option><option value="12">12 Blasts</option><option value="26">26 Blasts</option></select></label><label>Copy <select data-field="copy"><option value="reuse">Reuse approved copy</option><option value="refresh">Refresh wording each time</option><option value="ask">Ask me each time</option></select></label><label>Images <select data-field="images"><option value="reuse">Reuse approved images</option><option value="remind">Remind me to replace them</option><option value="ask">Ask me each time</option></select></label><label>After the first three approved runs <select data-field="approval"><option value="always">Always ask me</option><option value="automatic">Auto-post if I do not respond</option><option value="attention">Only ask if something needs attention</option></select></label></div><p>Review required for your first three scheduled Blasts. Fresh copy and image choices always need your approval.</p><p>Manual destinations are prepared for you to post.</p></div><p data-field="summary" aria-live="polite"></p>';
   const get=n=>host.querySelector('[data-field="'+n+'"]');
   const zoned=v=>{const p=window.BBSchedule.localParts(new Date(v),get('timezone').value);return p.year+'-'+String(p.month).padStart(2,'0')+'-'+String(p.day).padStart(2,'0')+'T'+String(p.hour).padStart(2,'0')+':'+String(p.minute).padStart(2,'0');};
   if(initial.nextRunAt||initial.firstRunAtUtc)get('date').value=zoned(initial.nextRunAt||initial.firstRunAtUtc);
   get('frequency').value=initial.frequency||'once';get('count').value=initial.stopMode==='count'?String(initial.stopAfterCount):'0';
   if(!get('count').value)get('count').value='0';get('copy').value=initial.copyBehavior||'reuse';get('images').value=initial.imageBehavior||'reuse';get('approval').value=initial.approvalBehavior||'always';
   function value(){const raw=get('date').value;if(!raw)throw Error('Choose a future date and time.');const [ymd,hm]=raw.split('T'),[y,m,day]=ymd.split('-').map(Number),[h,min]=hm.split(':').map(Number);const d=window.BBSchedule.wallTime(y,m-1,day,h,get('timezone').value,min);if(!Number.isFinite(d.getTime())||d<=new Date())throw Error('Choose a future date and time.');return {firstRunAtUtc:d.toISOString(),timezone:get('timezone').value,frequency:get('frequency').value,stopMode:Number(get('count').value)?'count':'never',stopAfterCount:Number(get('count').value),copyBehavior:get('copy').value,imageBehavior:get('images').value,approvalBehavior:get('approval').value};}
   function update(){get('refire').hidden=!get('date').value;get('recurring').hidden=get('frequency').value==='once';try{const v=value();get('resolved').textContent=date(v.firstRunAtUtc)+' · '+v.timezone;get('summary').textContent='Starts '+date(v.firstRunAtUtc)+' · '+v.frequency+(v.frequency==='once'?'':v.stopMode==='count'?' · stops after '+v.stopAfterCount+' Blasts':' · until you pause it');}catch(e){get('resolved').textContent=get('date').value?e.message:'';get('summary').textContent='';}}
   host.addEventListener('change',e=>{update();if(e.target===get('frequency'))fire('schedule.refire_explain');});
   host.addEventListener('click',e=>{const b=e.target.closest('[data-hours]');if(b){get('date').value=zoned(Date.now()+Number(b.dataset.hours)*3600000);update();fire('schedule.time_choice_explain');}});
   let savedKey=null,request=null;update();return {value,requestId(){const key=JSON.stringify(value());if(key!==savedKey){savedKey=key;request=crypto.randomUUID();}return request;}};
 }
 function style(){if(document.getElementById('bb-lifecycle-style'))return;const s=document.createElement('style');s.id='bb-lifecycle-style';s.textContent='.bb-life label{display:block;margin:12px 0}.bb-life input:not([type=checkbox]),.bb-life select,.bb-life textarea{display:block;box-sizing:border-box;width:100%;padding:10px;min-height:44px}.bb-life button,.bb-life a.bb-button{min-height:44px;padding:10px 14px;margin:5px 5px 5px 0;display:inline-block}.bb-life article{padding:16px;margin:14px 0;border:1px solid #748078;border-radius:12px}.bb-life img{width:90px;height:90px;object-fit:cover;margin:5px}.bb-life textarea{min-height:110px}.bb-life [hidden]{display:none!important}.bb-life summary{padding:12px;cursor:pointer}.bb-life [role=status]{white-space:pre-wrap}';document.head.append(s);}
 async function preview(data,blastId) {
   style();const host=document.getElementById('v1-publish-schedule');if(!host)return;
   host.classList.add('bb-life');
   if(!data?.adId){host.innerHTML='<h2>Scheduling</h2><p>Open this campaign and use Legacy preview to create its reusable Ad before setting a new schedule.</p>';return;}
   if(data.scheduleAdPath){host.innerHTML='<h2>'+esc(data.campaignName)+' / '+esc(data.adName)+'</h2><p>This is a scheduled Blast. Review or change it in Schedule.</p><a class="bb-button" href="BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,tab:'schedule'})+'">Open Schedule</a>';document.getElementById('publish-btn').hidden=true;return;}
   host.innerHTML='<h2>When should I send this?</h2><label><input type="radio" name="bb-send" value="now" checked> Send Now</label><label><input type="radio" name="bb-send" value="schedule"> Schedule It</label><div data-form hidden></div><p role="status"></p>';
   const scheduleForm=form(host.querySelector('[data-form]')),btn=document.getElementById('publish-btn'),original=window._firestoreApprove;
   host.addEventListener('change',()=>{const later=host.querySelector('[value="schedule"]').checked;host.querySelector('[data-form]').hidden=!later;btn.textContent=later?'Schedule Blast':'Publish Blast';fire('schedule.intent_choice');});
   window._firestoreApprove=async function(keys){if(!host.querySelector('[value="schedule"]').checked)return original(keys);btn.disabled=true;try{
     const schedule=scheduleForm.value();const result=await api('save',{adId:data.adId,campaignId:data.campaignId,blastId,schedule,requestId:scheduleForm.requestId()});
     fire('schedule.created');host.querySelector('[role=status]').textContent='Scheduled. Nothing has been posted yet.'+(result.overlaps.length?' Another Ad uses overlapping destinations within the same hour: '+result.overlaps.map(o=>o.campaignName+' / '+o.adName).join(', '):'');
     btn.hidden=true;const link=document.createElement('a');link.className='bb-button';link.href='BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,tab:'schedule'});link.textContent='View Schedule';host.append(link);
   }catch(e){host.querySelector('[role=status]').textContent=e.message;}finally{btn.disabled=false;}};
 }
 async function dashboard() {
   style();const seq=++dashboardEpoch,wrap=document.getElementById('sched-campaigns-wrap');if(!wrap||!context)return;
   document.getElementById('sched-upcoming-card')?.setAttribute('hidden','');document.getElementById('sched-no-campaigns')?.setAttribute('hidden','');
   wrap.classList.add('bb-life');wrap.innerHTML='<p role="status">Loading schedules…</p>';
   try {
     const result=await api('list');if(seq!==dashboardEpoch)return;
     const rows=result.schedules,active=rows.filter(r=>r.schedule.enabled),others=rows.filter(r=>!r.schedule.enabled);
     const next=active[0];wrap.innerHTML='<h2>Next Up</h2><p>'+esc(next?next.campaignName+' / '+next.adName+' — '+date(next.schedule.nextRunAt):'Nothing scheduled. You can still Send Now.')+'</p><p role="status" id="bb-schedule-message"></p><div data-active></div><details><summary>Paused and completed ('+others.length+')</summary><div data-others></div></details>';
     if(result.businessPaused){const resume=document.createElement('button');resume.textContent='Business scheduling is paused — Resume';resume.onclick=async()=>{try{await api('resumeBusiness');await dashboard();}catch(e){wrap.querySelector('#bb-schedule-message').textContent=e.message;}};wrap.prepend(resume);}
     const message=t=>{wrap.querySelector('#bb-schedule-message').textContent=t;};
     for(const row of rows) {
       const {schedule:s,upcoming:u}=row,card=document.createElement('article'),status=u?.approvalStatus==='required'&&s.enabled?'WAITING FOR APPROVAL':s.status||'active';
       const request={adId:row.adId,campaignId:row.campaignId,expectedRevision:s.revision};
       card.innerHTML='<h3>'+esc(row.campaignName)+' / '+esc(row.adName)+'</h3><strong>'+esc(status.toUpperCase())+'</strong>'+(s.pauseReason?'<p>'+esc(s.pauseReason)+'</p>':'')+'<p>Next: '+esc(date(s.nextRunAt))+' · '+esc(s.frequency)+' · '+(s.stopMode==='count'?Math.max(0,s.stopAfterCount-s.runsCompleted)+' of '+s.stopAfterCount+' remaining':'Until I stop it')+'</p><p>Copy: '+esc(s.copyBehavior)+' · Images: '+esc(s.imageBehavior)+' · Review: '+esc(s.approvalBehavior)+'</p>'+(row.last?'<p>Last run: '+esc(date(row.last.startedAt))+' · '+(row.last.completion?.delivered||0)+' delivered · '+(row.last.completion?.manual||0)+' need you. <a href="'+esc(statusLink(context.businessId,row.last.id))+'">View status</a></p>':'')+'<button data-action="'+(s.enabled?'pause':'resume')+'" '+(s.status==='completed'?'hidden':'')+'>'+(s.enabled?'Pause':'Resume')+'</button><button data-action="skipNext" '+(!s.nextRunAt?'hidden':'')+'>Skip Next</button><button data-action="edit">Edit Schedule</button><label>Move only the next post<input type="datetime-local" data-next></label><button data-action="changeNext" '+(!s.nextRunAt?'hidden':'')+'>Change Next Time</button><div data-edit hidden></div><div data-review></div><p role="status"></p>';
       const review=card.querySelector('[data-review]');
       if(u){review.innerHTML='<details><summary>Review / Change Next Post</summary><p>'+esc(u.preparationState==='working'?'Preparing fresh copy…':u.copyFallbackReason==='allowance_ceiling'?'Fresh wording is unavailable this month. Saved approved copy is ready to reuse.':u.copyFallbackReason?'Refresh was unavailable. Saved copy is ready to review.':'Review these exact copy and image selections.')+'</p>'+Object.entries(u.packet.adaptations).map(([p,text])=>'<label>'+esc(p)+'<textarea data-copy="'+esc(p)+'">'+esc(text)+'</textarea></label>').join('')+'<div>'+row.imagePool.map(i=>'<label><input type="checkbox" data-image="'+esc(i.id)+'" '+(u.packet.imageRefs.some(x=>x.id===i.id)?'checked':'')+'><img src="'+esc(i.url)+'" alt="'+esc(i.alt||'Campaign image')+'">Use this image</label>').join('')+'</div><p>Changes below apply only to this Blast. <a href="BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,cid:row.campaignId,adId:row.adId})+'">Update the reusable Ad</a></p><button data-action="editNext">Save This Run Only</button><button data-action="refreshNext">Refresh Wording</button><label><input type="checkbox" data-reviewed> I reviewed this copy and want to keep these images</label><button data-action="approveNext">'+(s.copyBehavior==='ask'?'Approve — Reuse This Copy':'Approve This Blast')+'</button></details>';}
       if(!u&&s.nextRunAt){const prepare=document.createElement('button');prepare.dataset.action='prepareNext';prepare.textContent='Prepare / Review Next Post';review.append(prepare);}
       const route=new URLSearchParams(location.search);if(route.get('scheduleAd')===row.adId&&route.get('scheduleCampaign')===row.campaignId){const details=review.querySelector('details');if(details)details.open=true;if(route.get('scheduledBlastId')&&route.get('scheduledBlastId')!==u?.id)card.querySelector(':scope > [role=status]').textContent='That email preview is no longer current. Review the current next Blast before choosing an action.';}
       let editor=null;
       card.addEventListener('click',async e=>{
         const button=e.target.closest('[data-action]');if(!button)return;const action=button.dataset.action,local=card.querySelector(':scope > [role=status]');
         if(action==='edit'){const box=card.querySelector('[data-edit]');box.hidden=!box.hidden;if(!editor){editor=form(box,s);const save=document.createElement('button');save.dataset.action='save';save.textContent='Save Schedule';box.append(save);}return;}
         if(action==='approveNext'&&!card.querySelector('[data-reviewed]')?.checked){local.textContent='Review the copy and images, then check the confirmation.';return;}
         if(['skipNext','save'].includes(action)&&!confirm(action==='save'?'Replace this schedule and any unsent prepared Blast? The stop-after count starts again.':'Skip only the next occurrence?'))return;
         const extras={};
         try {
           if(action==='save')Object.assign(extras,{schedule:editor.value(),requestId:editor.requestId(),replacePrepared:true});
           if(action==='changeNext'){const d=new Date(card.querySelector('[data-next]').value);if(!Number.isFinite(d.getTime()))throw Error('Choose the next posting time.');extras.nextRunAt=d.toISOString();}
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
       const legacy=document.createElement('article');legacy.innerHTML='<h3>'+esc(old.campaignName)+' — Legacy schedule</h3><p>Next: '+esc(date(old.nextRunAt))+'</p><p>Open this campaign, use Legacy preview, then schedule its reusable Ad. Saving the Ad schedule retires the old rule.</p><a class="bb-button" href="BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,cid:old.campaignId})+'">Review legacy campaign</a><button>Pause legacy schedule</button>';
       legacy.querySelector('button').onclick=async()=>{try{await api('pauseLegacy',{blastId:old.id});await dashboard();}catch(e){message(e.message);}};wrap.append(legacy);
     }
     fire('schedule.next_up_summary',{summary:next?next.campaignName+' / '+next.adName+' — '+date(next.schedule.nextRunAt):'Nothing scheduled right now.'});
   }catch(e){if(seq===dashboardEpoch)wrap.textContent=e.message;}
 }
 function statusLink(b,d){return 'BlastyBiz-Publishing-Status.html?'+new URLSearchParams({bizId:b,draftId:d});}
 window.BBLifecycle={configure,api,preview,dashboard,statusLink,form};
})();
