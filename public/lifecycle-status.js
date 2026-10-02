(function(){
 'use strict';
 let userInfo={},currentJobs=[],working=false,context=null,claiming=false;
 const delivered=new Set(['success','manual_posted','manual_completed']);
 const terminal=new Set([...delivered,'manual_skipped','manual_lapsed','skipped','canceled']);
 const ready=new Set(['manual_required','manual_followup','manual_ready']);
 function button(label,action){const b=document.createElement('button');b.type='button';b.className='btn-copy';b.textContent=label;b.style.cssText='min-height:44px;margin:6px';b.onclick=action;return b;}
 async function act(action,job) {
   if(working)return;
   if(action!=='retry'&&!confirm(action==='posted'?'Confirm you posted this copy and its images on '+job.platform+'?':action==='skipRemaining'?'Skip all remaining manual destinations for this Blast?':'Skip '+job.platform+' for this Blast only?'))return;
   working=true;try{await BBLifecycle.api(action,{blastId:job.draftId||context.blastId,jobId:job.jobId,confirm:true});window.BBBlasty?.fire(action==='posted'?'post.manual_confirmed':'post.manual_skipped',{platform:job.platform,needed:true});}catch(e){window.showToast(e.message);}finally{working=false;}
 }
 async function completion() {
   if(!context?.blastId||claiming)return;claiming=true;
   try {
     const {summary}=await BBLifecycle.api('reconcile',{blastId:context.blastId});
     let panel=document.getElementById('blast-truth');if(!panel){panel=document.createElement('section');panel.id='blast-truth';panel.className='card';document.getElementById('content-state').prepend(panel);}
     panel.replaceChildren();const text=document.createElement('p');text.textContent=summary.complete?'This Blast is complete. '+summary.delivered+' destinations were posted.':summary.delivered+' posted · '+summary.manual+' ready for you · '+(summary.total-summary.terminal-summary.manual)+' still in progress or needing attention.';panel.append(text);
     if(summary.manual)panel.append(button('Skip Remaining',()=>act('skipRemaining',{draftId:context.blastId})));
     if(!summary.launched)return;
     const result=await BBLifecycle.api('acknowledge',{blastId:context.blastId});
     if(summary.complete&&summary.delivered>0){const celebration=await BBLifecycle.api('acknowledge',{blastId:context.blastId,phase:'complete'});if(celebration.show)window.BBBlasty?.fire('onboard.ready_to_blast');}
     if(!result.show)return;
     const first=document.createElement('section');first.className='card';first.id='first-blast-completion';
     const title=document.createElement('h2');title.textContent='Your first Blast is underway';first.append(title);
     const copy=document.createElement('p');copy.textContent='I’ll remember your business, Ads, schedules, and choices. Next time, you can Run Again or build something new.';first.append(copy);
     for(const [label,tab] of [[summary.manual?'Finish Remaining Platforms':'View Status',null],['View Schedule','schedule'],['Create Another Campaign','create'],['Dashboard','dashboard']]) {
       if(!tab)first.append(button(label,()=>{first.remove();document.getElementById('action-card')?.scrollIntoView({behavior:'smooth'});}));
       else{const a=document.createElement('a');a.className='dash-btn';a.textContent=label;a.href=tab==='dashboard'?'BlastyBiz-Dashboard.html?bizId='+encodeURIComponent(context.businessId):'BlastyBiz.html?'+new URLSearchParams({bizId:context.businessId,tab});first.append(a);}
     }
     document.getElementById('content-state').prepend(first);
     window.BBBlasty?.fire('onboard.first_blast_complete',{ownerName:userInfo.ownerName||userInfo.displayName||'there',handoff:summary.manual?'The remaining manual destinations are ready for you.':'Your selected destinations are complete.'});
   }catch(e){console.warn('Blast milestone could not be loaded:',e.message);}finally{claiming=false;}
 }
 const original=window.renderJobs;
 window.renderJobs=function(jobs){
   currentJobs=jobs;original(jobs);
   const done=jobs.filter(j=>terminal.has(j.status)).length,posted=jobs.filter(j=>delivered.has(j.status)).length;
   document.getElementById('progress-count').textContent=done+' of '+jobs.length+' complete · '+posted+' posted';document.getElementById('progress-bar').style.width=(jobs.length?done/jobs.length*100:0)+'%';document.getElementById('hours-saved').textContent=(posted*.8).toFixed(1);
   document.querySelectorAll('#action-items [data-jobid]').forEach(item=>{
     const job=jobs.find(j=>j.jobId===item.dataset.jobid);if(!job)return;
     const actions=item.querySelector('.action-btns');actions.append(button('Mark as Posted',()=>act('posted',job)),button('Skip This One',()=>act('skipPlatform',job)));
     for(const url of job.payload?.imageUrls||[])if(/^https:\/\//.test(url)){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.textContent='View Image';link.className='btn-copy';actions.append(link);}
     const match=(job.manualInstructions||'').match(/(?:Go to|Visit|Open) ([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s→]*)?)/i);
     const destination=match?'https://'+match[1]:null;
     if(destination&&/^https:\/\//.test(destination)){const a=document.createElement('a');a.href=destination;a.target='_blank';a.rel='noopener';a.textContent='Open Platform';actions.append(a);}
   });
   document.querySelectorAll('#platform-list .platform-row').forEach((row,i)=>{const job=jobs[i];if(['failed','needs_connection'].includes(job.status)){if(job.status==='failed'&&!job.publicationUncertain)row.append(button('Retry',()=>act('retry',job)));row.append(button('Skip This One',()=>act('skipPlatform',job)));}});
   void completion();
 };
 window.BBLifecycleStatus={initialize(ctx,user){context=ctx;userInfo=user;BBLifecycle.configure(ctx);const host=document.getElementById('content-state'),label=document.createElement('label');label.className='bb-reminder';const input=document.createElement('input');input.type='checkbox';input.checked=user.manualRemindersEnabled!==false;label.append(input,document.createTextNode('Remind me to finish manual posts'));host.append(label);input.onchange=async()=>{input.disabled=true;try{await BBLifecycle.api('reminders',{enabled:input.checked});window.BBBlasty?.fire('reminder.manual_explain');}catch(e){input.checked=!input.checked;window.showToast(e.message);}finally{input.disabled=false;}};}};
})();
