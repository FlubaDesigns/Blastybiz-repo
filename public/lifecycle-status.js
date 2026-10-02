(function(){
 'use strict';
 let userInfo={},currentJobs=[],working=false,context=null,claiming=false;
 const delivered=new Set(['success','manual_posted','manual_completed']);
 const terminal=new Set([...delivered,'manual_skipped','manual_lapsed','skipped','canceled']);
 const ready=new Set(['manual_required','manual_followup','manual_ready']);
 function button(label,action){const b=document.createElement('button');b.type='button';b.className='btn-copy';b.textContent=label;b.onclick=action;return b;}
 async function act(action,job) {
   if(working)return;
   if(action!=='retry'&&!confirm(action==='posted'?'Confirm you posted this copy and its images on '+job.platform+'?':action==='skipRemaining'?'Skip all remaining manual destinations for this Blast?':'Skip '+job.platform+' for this Blast only?'))return;
   working=true;try{await BBLifecycle.api(action,{blastId:job.draftId||context.blastId,jobId:job.jobId,confirm:true});window.BBBlasty?.fire(action==='posted'?'post.manual_confirmed':'post.manual_skipped',{platform:job.platform,needed:true});}catch(e){window.showToast(e.message);}finally{working=false;}
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
 const original=window.renderJobs;
 window.renderJobs=function(jobs){
   currentJobs=jobs;original(jobs);
   const done=jobs.filter(j=>terminal.has(j.status)).length,posted=jobs.filter(j=>delivered.has(j.status)).length;
   document.getElementById('progress-count').textContent=done+' of '+jobs.length+' complete · '+posted+' posted';document.getElementById('progress-bar').style.width=(jobs.length?done/jobs.length*100:0)+'%';document.getElementById('hours-saved').textContent=(posted*.8).toFixed(1);
   document.querySelectorAll('#platform-list .platform-row').forEach(row=>{
     const job=jobs.find(j=>j.jobId===row.dataset.jobid);if(!job)return;
     const actions=row.querySelector('.action-btns');if(!actions)return;
     if(ready.has(job.status)){
       const match=(job.manualInstructions||'').match(/(?:Go to|Visit|Open) (?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s→]*)?)/i);
       const destinations={yelp:'https://biz.yelp.com/',craigslist:'https://www.craigslist.org/',fbmarket:'https://www.facebook.com/marketplace/',nextdoor:'https://nextdoor.com/',applemaps:'https://businessconnect.apple.com/',bing:'https://www.bingplaces.com/'};
       const destination=match?'https://'+match[1]:destinations[job.platform];
       if(destination){const a=document.createElement('a');a.href=destination;a.target='_blank';a.rel='noopener';a.textContent='Open Platform';a.className='btn-copy';actions.append(a);}
       actions.append(button('Mark as Posted',()=>act('posted',job)),button('Skip This One',()=>act('skipPlatform',job)));
       const resources=document.createElement('div');resources.className='platform-resources';
       (job.payload?.imageUrls||[]).filter(url=>/^https:\/\//.test(url)).forEach((url,i)=>{
         const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.textContent='Photo '+(i+1);resources.append(link);
       });
       const help=document.createElement('details');help.className='platform-instructions';
       const summary=document.createElement('summary');summary.textContent='Instructions';
       const copy=document.createElement('p');copy.textContent=job.manualInstructions||'Copy your listing, open the platform, add your photos, and publish. Then return here and mark it as posted.';
       help.append(summary,copy);resources.append(help);row.querySelector('.platform-content').append(resources);
     }else if(['failed','needs_connection'].includes(job.status)){
       if(job.status==='failed'&&!job.publicationUncertain)actions.append(button('Retry',()=>act('retry',job)));
       actions.append(button('Skip This One',()=>act('skipPlatform',job)));
     }
   });
   void completion();
 };
 window.BBLifecycleStatus={initialize(ctx,user){context=ctx;userInfo=user;BBLifecycle.configure(ctx);const host=document.getElementById('content-state'),label=document.createElement('label');label.className='bb-reminder';const input=document.createElement('input');input.type='checkbox';input.checked=user.manualRemindersEnabled!==false;label.append(input,document.createTextNode('Remind me to finish manual posts'));host.append(label);input.onchange=async()=>{input.disabled=true;try{await BBLifecycle.api('reminders',{enabled:input.checked});window.BBBlasty?.fire('reminder.manual_explain');}catch(e){input.checked=!input.checked;window.showToast(e.message);}finally{input.disabled=false;}};}};
})();

