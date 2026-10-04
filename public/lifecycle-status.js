(function(){
 'use strict';

const PLATFORM_META=Object.fromEntries(BBPlatforms.records.map(p=>[p.id,{name:p.name,icon:p.icon}]));

const STATUS_CONFIG = {
  canceled:         { label: 'Canceled', cls: 'pill-pending', rowCls: '' },
  success:          { label: 'Live',        cls: 'pill-live',    rowCls: 'status-live' },
  manual_required:  { label: 'Action Needed', cls: 'pill-manual', rowCls: 'status-manual' },
  manual_posted: {label:'Posted by you',cls:'pill-live',rowCls:'status-live'},
  manual_skipped: {label:'Skipped',cls:'pill-pending',rowCls:''},
  manual_lapsed: {label:'Not posted',cls:'pill-pending',rowCls:''},
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
  const expanded = new Set([...list.querySelectorAll('details.platform-row[open]')].map(row => row.dataset.jobid));
  list.replaceChildren();
  jobs.forEach(job => {
    const meta = PLATFORM_META[job.platform] || { name: job.platform, icon: '●' };
    const status = STATUS_CONFIG[job.status] || { label: job.status, cls: 'pill-pending', rowCls: '' };
    const manual = ['manual_required', 'manual_followup', 'manual_ready'].includes(job.status);
    const row = document.createElement('details');
    row.className = 'platform-row ' + status.rowCls;
    row.dataset.jobid = job.jobId;
    row.setAttribute('name', 'publishing-platforms');
    row.open = expanded.has(job.jobId);
    const header = document.createElement('summary');
    header.className = 'platform-heading';
    const icon = document.createElement('span');
    icon.className = 'platform-icon ' + (meta.piClass || 'pi-default'); icon.setAttribute('aria-hidden','true'); icon.textContent = meta.icon;
    const info = document.createElement('span'); info.className = 'platform-info';
    const name = document.createElement('span'); name.className = 'platform-name'; name.textContent = meta.name;
    const pill = document.createElement('span'); pill.className = 'status-pill ' + status.cls; pill.textContent = status.label;
    info.append(name,pill); header.append(icon,info);
    { const expand = document.createElement('span'); expand.className = 'platform-expand'; expand.setAttribute('aria-hidden','true'); expand.textContent = '⌄'; header.append(expand); }
    row.append(header);
    {
      const content = document.createElement('div');
      content.className = 'platform-content';
      const message = document.createElement('p');
      message.className = 'platform-msg';
      message.textContent = manual ? 'Copy your listing, then open the platform to post it.' : (job.customerVisibleMessage || status.label);
      content.append(message);
      if(manual){const copyText=document.createElement('textarea');copyText.readOnly=true;copyText.value=job.payload?.adaptedContent||'';copyText.className='manual-textarea';copyText.setAttribute('aria-label','Post text for '+meta.name);content.append(copyText);}
      const actions = document.createElement('div');
      actions.className = 'action-btns';
      if (manual) {
        const copy = document.createElement('button');
        copy.type = 'button'; copy.className = 'btn-copy'; copy.textContent = 'Copy Listing';
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
  if(!navigator.clipboard?.writeText){message('Select and copy the text above, then open the platform.');return;}
  navigator.clipboard.writeText(text).then(()=>message('Text copied. Share or save the photos, then open the platform.')).catch(()=>message('Select and copy the text above, then open the platform.'));
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
 const delivered=new Set(['success','manual_posted','manual_completed']);
 const terminal=new Set([...delivered,'manual_skipped','manual_lapsed','skipped','canceled']);
 const ready=new Set(['manual_required','manual_followup','manual_ready']);
 function button(label,action){const b=document.createElement('button');b.type='button';b.className='btn-copy';b.textContent=label;b.onclick=action;return b;}
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
     panel.replaceChildren();const text=document.createElement('p');text.textContent=summary.complete?'This Blast is complete. '+summary.delivered+' destinations were posted.':summary.delivered+' posted · '+summary.manual+' ready for you · '+(summary.total-summary.terminal-summary.manual)+' still in progress or needing attention.';panel.append(text);
     if(summary.manual)panel.append(button('Skip Remaining',()=>act('skipRemaining',{draftId:context.blastId})));
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
 window.renderJobs=function(jobs){
   currentJobs=jobs;renderPlatformRows(jobs);
   const done=jobs.filter(j=>terminal.has(j.status)).length,posted=jobs.filter(j=>delivered.has(j.status)).length;
   document.getElementById('progress-count').textContent=done+' of '+jobs.length+' complete · '+posted+' posted';document.getElementById('progress-bar').style.width=(jobs.length?done/jobs.length*100:0)+'%';document.getElementById('hours-saved').textContent=(jobs.filter(j=>j.status==='success').length*.8).toFixed(1);
   document.querySelectorAll('#platform-list .platform-row').forEach(row=>{
     const job=jobs.find(j=>j.jobId===row.dataset.jobid);if(!job)return;
     const actions=row.querySelector('.action-btns');if(!actions)return;
     if(ready.has(job.status)){
       const match=(job.manualInstructions||'').match(/(?:Go to|Visit|Open) (?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s→]*)?)/i);
       const destinations={yelp:'https://biz.yelp.com/',craigslist:'https://www.craigslist.org/',fbmarket:'https://www.facebook.com/marketplace/',nextdoor:'https://nextdoor.com/',applemaps:'https://businessconnect.apple.com/',bing:'https://www.bingplaces.com/'};
       const destination=match?'https://'+match[1]:destinations[job.platform];
       if(destination){const a=document.createElement('a');a.href=destination;a.target='_blank';a.rel='noopener';a.textContent='Open Platform';a.className='btn-copy';actions.append(a);}
       actions.append(button('Mark as Posted',()=>act('posted',job)),button('Skip This One',()=>act('skipPlatform',job)));
       const help=document.createElement('details');help.className='platform-instructions';
       const summary=document.createElement('summary');summary.textContent='Instructions';
       const copy=document.createElement('p');copy.textContent=job.manualInstructions||'Copy your listing, open the platform, add your photos, and publish. Then return here and mark it as posted.';
       help.append(summary,copy);row.querySelector('.platform-content').append(help);
     }else if(['failed','needs_connection'].includes(job.status)){
       if(job.status==='failed'&&!job.publicationUncertain)actions.append(button('Retry',()=>act('retry',job)));
       actions.append(button('Skip This One',()=>act('skipPlatform',job)));
     }
     const resources=document.createElement('div');resources.className='platform-resources';
     const photos=(job.payload?.imageUrls||[]).filter(url=>/^https:\/\//.test(url)).map(url=>({url}));
     if(photos.length){
       const share=document.createElement('div');share.className='qp-photo-share';resources.append(share);
       const media=document.createElement('div');resources.append(media);
       BBPhotoHandoff.renderPhotos(media,job.platform,photos,!ready.has(job.status));
       if(ready.has(job.status))BBPhotoHandoff.renderShare(share,job.platform,photos,()=>job.payload?.adaptedContent||'');
     }
     if(resources.childElementCount){const content=row.querySelector('.platform-content');content.insertBefore(resources,content.querySelector('.platform-instructions'));}
   });
   void completion();
 };
 window.BBLifecycleStatus={initialize(ctx,user){context=ctx;userInfo=user;BBLifecycle.configure(ctx);const host=document.getElementById('content-state'),label=document.createElement('label');label.className='bb-reminder';const input=document.createElement('input');input.type='checkbox';input.checked=user.manualRemindersEnabled!==false;label.append(input,document.createTextNode('Remind me to finish manual posts'));host.append(label);input.onchange=async()=>{input.disabled=true;try{await BBLifecycle.api('reminders',{enabled:input.checked});window.BBBlasty?.fire('reminder.manual_explain');}catch(e){input.checked=!input.checked;window.showToast(e.message);}finally{input.disabled=false;}};}};
})();

