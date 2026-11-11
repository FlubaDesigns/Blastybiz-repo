(function(){
 'use strict';

const PLATFORM_META=Object.fromEntries(BBPlatforms.records.map(p=>[p.id,{name:p.name,icon:p.icon}]));

const STATUS_CONFIG = {
  canceled:         { label: 'Canceled', cls: 'pill-pending', rowCls: '' },
  success:          { label: 'Live',        cls: 'pill-live',    rowCls: 'status-live' },
  manual_required:  { label: 'Action Needed', cls: 'pill-manual', rowCls: 'status-manual' },
  manual_posted: {label:'Posted by you',cls:'pill-live',rowCls:'status-live'},
  manual_skipped: {label:'Skipped',cls:'pill-pending',rowCls:''},
  manual_lapsed: {label:'Expired — not posted',cls:'pill-pending',rowCls:''},
  skipped: {label:'Skipped',cls:'pill-pending',rowCls:''},
  manual_completed: { label: 'Posted',      cls: 'pill-live',    rowCls: 'status-live' },
  processing:       { label: 'Publishing', cls: 'pill-running', rowCls: 'status-running' },
  manual_ready: { label: 'Action Needed', cls: 'pill-manual', rowCls: 'status-manual' },
  manual_followup:  { label: 'Action Needed', cls: 'pill-manual', rowCls: 'status-manual' },
  running:          { label: 'Publishing',  cls: 'pill-running', rowCls: 'status-running' },
  pending:          { label: 'Waiting',     cls: 'pill-pending', rowCls: '' },
  failed:           { label: 'Failed',      cls: 'pill-failed',  rowCls: 'status-failed' },
  needs_connection: { label: 'Not connected yet', cls: 'pill-manual', rowCls: 'status-manual' },
  retry_pending:    { label: 'Retrying',    cls: 'pill-running', rowCls: 'status-running' },
};

 const delivered=new Set(['success','manual_posted','manual_completed']);
 const terminal=new Set([...delivered,'manual_skipped','manual_lapsed','skipped','canceled']);
 const ready=new Set(['manual_required','manual_followup','manual_ready']);

function historyRows(drafts,jobs){
  const byId=new Map(drafts.map(d=>[d.id,d])),groups=new Map();
  const time=v=>v?.toDate?.()?.toISOString()|| (typeof v==='string'?v:null);
  for(const job of jobs){
    const key=job.draftId||job.blastId||job.jobId;
    if(!key)continue;
    const draft=byId.get(job.draftId)||{},packet=draft.packet||draft;
    if(!groups.has(key))groups.set(key,{draftId:job.draftId||null,key,campaignId:draft.campaignId||job.campaignId,adId:draft.adId||job.adId,
      reusable:draft.status==='approved',image:null,listing:packet.adName||draft.blastName||job.adName||job.listingName||draft.businessName||'Blast',jobs:[],time:null});
    const group=groups.get(key);group.jobs.push(job);
    const url=job.payload?.imageUrls?.[0]||packet.imageRefs?.[0]?.url;
    if(!group.image&&typeof url==='string'&&/^https:\/\//.test(url))group.image=url;
    const stamp=time(job.publishedAt||job.manualConfirmedAt||job.updatedAt||job.createdAt);
    if(stamp&&(!group.time||Date.parse(stamp)>Date.parse(group.time)))group.time=stamp;
  }
  return [...groups.values()].map(group=>({...group,
    posted:group.jobs.filter(j=>delivered.has(j.status)).length,
    postedPlatforms:group.jobs.filter(j=>delivered.has(j.status)).map(j=>j.platform),
    postedTimes:group.jobs.filter(j=>delivered.has(j.status)).map(j=>time(j.publishedAt||j.manualConfirmedAt||j.updatedAt||j.createdAt)).filter(Boolean),
    platforms:group.jobs.map(j=>j.platformName||PLATFORM_META[j.platform]?.name||j.platform),
    summary:group.jobs.map(j=>(j.platformName||PLATFORM_META[j.platform]?.name||j.platform)+': '+(STATUS_CONFIG[j.status]?.label||'Unknown status')).join(' · ')
  })).sort((a,b)=>(Date.parse(b.time)||0)-(Date.parse(a.time)||0));
}
const reuseRequests=new Map();
async function reusePost(row,ctx) {
  const key='bb-reuse:'+JSON.stringify([ctx.userId,ctx.businessId,row.campaignId,row.adId,row.draftId]);
  let pending=reuseRequests.get(key);
  if(!pending){
    try{const saved=JSON.parse(sessionStorage.getItem(key));if(/^[a-f0-9-]{36}$/.test(saved?.adId)&&/^[a-f0-9-]{36}$/.test(saved?.requestId))pending={adId:saved.adId,requestId:saved.requestId};}catch(_){}
    pending ||= {adId:crypto.randomUUID(),requestId:crypto.randomUUID()};reuseRequests.set(key,pending);
    try{sessionStorage.setItem(key,JSON.stringify(pending));}catch(_){}
  }
  if(pending.result)return pending.result;
  if(pending.promise)return pending.promise;
  pending.promise=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/manageAd',{method:'POST',signal:controller.signal,
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+await ctx.token()},
        body:JSON.stringify({action:'derive',businessId:ctx.businessId,campaignId:row.campaignId,sourceAdId:row.adId,sourceBlastId:row.draftId,adId:pending.adId,requestId:pending.requestId})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Could not reuse this post. Try again.');
      pending.result=data.ad;try{sessionStorage.removeItem(key);}catch(_){}return data.ad;
    }finally{clearTimeout(timer);pending.promise=null;}
  })();
  return pending.promise;
}
function postCard({title,image,alt}) {
  const card=document.createElement('article');card.className='bb-return-post row';
  const heading=document.createElement('div');heading.className='flex-row bb-list-heading';
  const name=document.createElement('h3');name.textContent=title;heading.append(name);card.append(heading);
  const columns=document.createElement('div');columns.className=image?'col-1-2':'col-full';
  if(image){const media=document.createElement('div');media.className='col-left';const img=document.createElement('img');img.className='bb-return-photo';img.src=image;img.alt=alt||'Saved post photo';img.loading='lazy';media.append(img);columns.append(media);}
  const content=document.createElement('div');content.className='col-right bb-return-copy';columns.append(content);card.append(columns);
  return {card,heading,content};
}
function renderHistory(host,rows,ctx) {
  host.replaceChildren();
  if(!rows.length){host.textContent='No recent posts yet.';return;}
  const link=(text,href)=>{const a=document.createElement('a');a.className='btn';a.textContent=text;a.href=href;return a;};
  for(const row of rows){
    const {card,heading,content}=postCard({title:row.listing,image:row.image,alt:'Photo from '+row.listing});
    const summary=document.createElement('p');summary.textContent=row.summary;content.append(summary);
    const time=document.createElement('p');time.className='muted';time.textContent=row.time?new Date(row.time).toLocaleString():'Date unavailable';content.append(time);
    const actions=document.createElement('div');actions.className='flex-row';
    if(row.draftId){
      actions.append(link('Results','BlastyBiz-Publishing-Status.html?'+new URLSearchParams({bizId:ctx.businessId,draftId:row.draftId})));
      const more=BBMore.create('Post options');more.body.append(link('View saved post','BlastyBiz-Listing-Preview.html?'+new URLSearchParams({bizId:ctx.businessId,draftId:row.draftId})));heading.append(more.menu);
    }
    if(row.reusable&&row.campaignId&&row.adId){
      const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Use again';
      const message=document.createElement('p');message.setAttribute('role','status');
      button.onclick=async()=>{
        if(button.disabled||!ctx.isCurrent())return;button.disabled=true;message.textContent='Creating your draft…';
        try{
          await ctx.beforeReuse?.();if(!ctx.isCurrent())return;
          const ad=await reusePost(row,ctx);
          if(ctx.isCurrent()&&ctx.navigate('BlastyBiz.html?'+new URLSearchParams({bizId:ctx.businessId,cid:row.campaignId,adId:ad.id,tab:'create'}))===false){button.disabled=false;message.textContent='Your new draft is saved. Finish saving your current edits, then open it with Use again.';}
        }
        catch(error){if(ctx.isCurrent()){message.textContent=error.name==='AbortError'?'Still waiting for confirmation. Try again to open the same draft.':error.message;button.disabled=false;}}
      };
      actions.append(button);content.append(message);
    }
    content.append(actions);host.append(card);
  }
}
window.BBLifecycleStatus={historyRows,renderHistory,postCard};
// The workspace uses the same delivery-state definitions, without installing status-page UI.
if(!document.getElementById('progress-count'))return;

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500)}

let scheduleFocused = false;
function focusFutureSchedule() {
  const host = document.getElementById('future-blast-schedule');
  if (scheduleFocused || location.hash !== '#future-blast-schedule' || !host || host.hidden ||
      document.getElementById('content-state').classList.contains('hidden')) return;
  scheduleFocused = true;
  requestAnimationFrame(() => host.scrollIntoView?.({block:'start'}));
}

function renderPlatformRows(jobs) {
  const list = document.getElementById('platform-list');
  const expanded = new Set([...list.querySelectorAll('.bb-more[open]')].map(menu => menu.closest('[data-jobid]').dataset.jobid));
  const visibleCopy = new Set([...list.querySelectorAll('textarea:not([hidden])')].map(copy => copy.closest('[data-jobid]').dataset.jobid));
  list.replaceChildren();
  jobs.forEach(job => {
    const meta = PLATFORM_META[job.platform] || { name: job.platform, icon: '●' };
    const status = STATUS_CONFIG[job.status] || { label: job.status, cls: 'pill-pending', rowCls: '' };
    const manual = ['manual_required', 'manual_followup', 'manual_ready'].includes(job.status);
    const row = document.createElement('article');
    row.className = 'platform-row ' + status.rowCls;
    row.dataset.jobid = job.jobId;
    const header = document.createElement('div');
    header.className = 'platform-heading flex-row';
    const icon = document.createElement('span');
    icon.className = 'platform-icon ' + (meta.piClass || 'pi-default'); icon.setAttribute('aria-hidden','true'); icon.textContent = meta.icon;
    const info = document.createElement('span'); info.className = 'platform-info';
    const name = document.createElement('span'); name.className = 'platform-name'; name.textContent = meta.name;
    const pill = document.createElement('span'); pill.className = 'status-pill ' + status.cls; pill.textContent = status.label;
    info.append(name,pill); header.append(icon,info);
    const options=BBMore.create('More options for '+meta.name); options.menu.open=expanded.has(job.jobId);header.append(options.menu);
    row.append(header);
    {
      const content = document.createElement('div');
      content.className = 'platform-content row';
      content.id='delivery-details-'+encodeURIComponent(job.jobId);
      content.hidden=terminal.has(job.status);
      const detail=button('Details',()=>{content.hidden=!content.hidden;});options.body.append(detail);
      const message = document.createElement('p');
      message.className = 'platform-msg';
      message.textContent = manual ? 'Copy your listing, then open the platform to post it.' : (job.status==='manual_lapsed'?'Expired — not posted. The manual posting deadline passed without a posting confirmation.'+(job.lapsedAt?' Closed '+new Date(job.lapsedAt).toLocaleDateString()+'.':''):(job.customerVisibleMessage || status.label));
      content.append(message);
      if(manual){const copyText=document.createElement('textarea');copyText.readOnly=true;copyText.value=job.payload?.adaptedContent||'';copyText.className='manual-textarea';copyText.setAttribute('aria-label','Post text for '+meta.name);copyText.hidden=!visibleCopy.has(job.jobId);content.append(copyText);options.body.append(button('View copy',()=>{copyText.hidden=!copyText.hidden;if(!copyText.hidden)copyText.focus();}));}
      const actions = document.createElement('div');
      actions.className = 'action-btns';
      if (manual) {
        const copy = document.createElement('button');
        copy.type = 'button'; copy.className = 'btn-copy'; copy.textContent = 'Copy text';
        copy.onclick = () => copyListing(job.jobId, job.payload?.adaptedContent || '',message);
        actions.append(copy);
      }
      if (job.status === 'needs_connection') {
        const connect = document.createElement('a');
        connect.href = 'BlastyBiz-Connect.html?' + new URLSearchParams({bizId:new URLSearchParams(location.search).get('bizId')||'',tab:'platforms'});
        connect.onclick=()=>context?.rememberConnection?.();
        connect.className = 'btn-copy'; connect.textContent = 'Connect'; actions.append(connect);
      }
      content.append(actions); row.append(content);
    }
    list.append(row);
  });

  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('content-state').classList.remove('hidden');
  focusFutureSchedule();}

function copyListing(jobId, text,feedback) {
  const message=t=>{if(feedback)feedback.textContent=t;else showToast(t);};
  const fallback=()=>{const row=[...document.querySelectorAll('[data-jobid]')].find(e=>e.dataset.jobid===jobId),copy=row?.querySelector('textarea');if(copy){copy.hidden=false;copy.focus();copy.select();}message('Select and copy the text, then open the platform.');};
  if(!navigator.clipboard?.writeText){fallback();return;}
  navigator.clipboard.writeText(text).then(()=>message('Text copied. Share or save the photos, then open the platform.')).catch(fallback);
}

function showEmptyState(msg) {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('content-state').classList.remove('hidden');
  focusFutureSchedule();
  document.getElementById('progress-count').textContent = '0 of 0 Complete';
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('platform-list').innerHTML =
    `<div class="empty-state-msg">${msg}</div>`;
  const hoursSaved = document.getElementById('hours-saved');
  if (hoursSaved) hoursSaved.textContent = '0'}

window.showToast=showToast;window.showEmptyState=showEmptyState;window.focusFutureSchedule=focusFutureSchedule;

 let userInfo={},currentJobs=[],working=false,context=null,claiming=false;
 function button(label,action){const b=document.createElement('button');b.type='button';b.className='btn-copy';b.textContent=label;b.onclick=()=>{const menu=b.closest('.bb-more');if(menu)menu.open=false;return action();};return b;}
 async function act(action,job) {
   if(working)return;
   if(action!=='retry'&&!confirm(action==='posted'?'Confirm you posted this copy and its images on '+job.platform+'?':action==='skipRemaining'?'Skip all remaining manual destinations for this Blast?':'Skip '+job.platform+' for this Blast only?'))return;
   working=true;try{await BBLifecycle.api(action,{blastId:job.draftId||context.blastId,jobId:job.jobId,confirm:true});window.BBBlasty?.fire(action==='posted'?'post.manual_confirmed':'post.manual_skipped',{platform:job.platform,needed:true});}catch(e){const feedback=[...document.querySelectorAll('[data-jobid]')].find(row=>row.dataset.jobid===job.jobId)?.querySelector('.platform-msg')||document.getElementById('blast-truth');if(feedback)feedback.textContent=e.message;window.showToast(e.message);}finally{working=false;}
 }
 async function completion() {
   if(!context?.blastId||claiming)return;claiming=true;
   try {
     const {summary}=await BBLifecycle.api('reconcile',{blastId:context.blastId});
     let panel=document.getElementById('blast-truth');if(!panel){panel=document.createElement('section');panel.id='blast-truth';panel.className='blast-summary';document.querySelector('.progress-card').insertBefore(panel,document.getElementById('platform-list'));}
     panel.replaceChildren();const text=document.createElement('p');text.textContent=summary.complete?(summary.delivered===summary.total?'All destinations were posted.':'This Blast is closed. '+outcomes(currentJobs)+'.'):summary.delivered+' posted · '+summary.manual+' ready for you · '+(summary.total-summary.terminal-summary.manual)+' still in progress or needing attention.';panel.append(text);
     if(summary.manual){const deadline=document.createElement('p');deadline.textContent=summary.manualExpiresAt?'Unconfirmed manual posts expire '+new Date(summary.manualExpiresAt).toLocaleString()+'.':'Unconfirmed manual posts expire '+summary.manualLapseDays+' days after the final reminder.';panel.append(deadline);}
     if(summary.manual){const options=BBMore.create('Blast options');options.body.append(button('Skip Remaining',()=>act('skipRemaining',{draftId:context.blastId})));panel.classList.add('flex-row','bb-list-heading');panel.append(options.menu);}
     if(!summary.launched)return;
     const result=await BBLifecycle.api('acknowledge',{blastId:context.blastId});
     if(summary.complete&&summary.delivered>0){const celebration=await BBLifecycle.api('acknowledge',{blastId:context.blastId,phase:'complete'});if(celebration.show)window.BBBlasty?.fire('onboard.ready_to_blast');}
     if(!result.show)return;
     const first=document.createElement('p');first.id='first-blast-completion';first.className='first-blast-note';
     first.textContent='Your first Blast is underway. Your next steps are below.';
     document.getElementById('content-state').prepend(first);
     window.BBBlasty?.fire('onboard.first_blast_complete',{ownerName:userInfo.ownerName||userInfo.displayName||'there',handoff:summary.manual?'The remaining manual destinations are ready for you.':'Your selected destinations are complete.'});
   }catch(e){console.warn('Blast milestone could not be loaded:',e.message);}finally{claiming=false;}
 }
 function outcomes(jobs){
   const count=statuses=>jobs.filter(j=>statuses.has(j.status)).length;
   return [count(delivered)+' posted',count(new Set(['manual_skipped','skipped']))+' skipped',count(new Set(['manual_lapsed']))+' expired',...(jobs.some(j=>j.status==='canceled')?[count(new Set(['canceled']))+' canceled']:[])].join(' · ');
 }
 window.renderJobs=function(jobs){
   currentJobs=jobs;renderPlatformRows(jobs);
   const done=jobs.filter(j=>terminal.has(j.status)).length,posted=jobs.filter(j=>delivered.has(j.status)).length;
   document.getElementById('progress-count').textContent=outcomes(jobs)+(done<jobs.length?' · '+(jobs.length-done)+' remaining':'');document.getElementById('progress-bar').style.width=(jobs.length?posted/jobs.length*100:0)+'%';document.getElementById('hours-saved').textContent=(jobs.filter(j=>j.status==='success').length*.8).toFixed(1);
   document.querySelectorAll('#platform-list .platform-row').forEach(row=>{
     const job=jobs.find(j=>j.jobId===row.dataset.jobid);if(!job)return;
     const actions=row.querySelector('.action-btns'),options=row.querySelector('.bb-more-list');if(!actions)return;
     if(ready.has(job.status)){
       const destination=BBPlatforms.destinationUrl(job.platform,job.manualInstructions);
       if(destination){const a=document.createElement('a');a.href=destination;a.target='_blank';a.rel='noopener';a.textContent='Open Platform';a.className='btn-copy';actions.append(a);}
       actions.append(button('Mark as Posted',()=>act('posted',job)));options.append(button('Skip This One',()=>act('skipPlatform',job)));
       const help=document.createElement('div');help.className='platform-instructions';
       const copy=document.createElement('p');copy.textContent=job.manualInstructions||'Copy your listing, open the platform, add your photos, and publish. Then return here and mark it as posted.';
       help.append(copy);options.append(help);
     }else if(['failed','needs_connection'].includes(job.status)){
       if(job.status==='failed'&&!job.publicationUncertain)actions.append(button('Retry',()=>act('retry',job)));
       options.append(button('Skip This One',()=>act('skipPlatform',job)));
     }
     const resources=document.createElement('div');resources.className='platform-resources';
     const photos=(job.payload?.imageUrls||[]).filter(url=>/^https:\/\//.test(url)).map(url=>({url}));
     if(photos.length){
       const share=document.createElement('div');share.className='qp-photo-share';options.append(share);
       const media=document.createElement('div');resources.append(media);
       BBPhotoHandoff.renderPhotos(media,job.platform,photos,!ready.has(job.status),options);
       if(ready.has(job.status))BBPhotoHandoff.renderShare(share,job.platform,photos,()=>job.payload?.adaptedContent||'');
     }
     if(resources.childElementCount){const content=row.querySelector('.platform-content');content.append(resources);}
   });
   void completion();
 };
 window.BBLifecycleStatus={historyRows,renderHistory,postCard,initialize(ctx,user){context=ctx;userInfo=user;BBLifecycle.configure(ctx);const host=document.getElementById('status-more-options'),label=document.createElement('label');
 document.querySelectorAll('[data-status-workspace]').forEach(link=>{link.href='BlastyBiz.html?'+new URLSearchParams({bizId:ctx.businessId,tab:link.dataset.statusWorkspace});});label.className='bb-reminder';const input=document.createElement('input');input.type='checkbox';input.checked=user.manualRemindersEnabled!==false;label.append(input,document.createTextNode('Remind me to finish manual posts (at most one email every 24 hours)'));host.append(label);input.onchange=async()=>{input.disabled=true;try{await BBLifecycle.api('reminders',{enabled:input.checked});window.BBBlasty?.fire('reminder.manual_explain');}catch(e){input.checked=!input.checked;window.showToast(e.message);}finally{input.disabled=false;}};}};
})();

