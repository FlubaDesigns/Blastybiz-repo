(function(){
  'use strict';
  let overrides={}, seen={}, persist=null, ready=false, queue=[];
  function record(id,field=false){const seed=(field?BBBlastySeed.fields:BBBlastySeed.events)[id];return seed?{...seed,...(overrides[field?'fields':'events']?.[id]||{})}:null;}
  function message(id,context={},field=false){let text=record(id,field)?.message||'';return text.replace(/\{\{(\w+)\}\}/g,(_,key)=>String(context[key]??''));}
  async function fire(id,context={}){
    if(!ready){queue.push([id,context]);return false;}
    const spec=record(id);if(!spec||!spec.enabled)return false;
    if(spec.behavior==='ONCE'&&seen[id])return false;
    if(spec.behavior==='WHEN NEEDED'&&!context.needed)return false;
    if(spec.behavior==='OPTIONAL'&&!context.help)return false;
    let caption=document.getElementById('blasty-event-message');
    if(!caption){caption=document.createElement('p');caption.id='blasty-event-message';caption.setAttribute('role','status');caption.setAttribute('aria-live','polite');const host=document.querySelector('#ad-workspace,#cb-header-msg,.pub-page,main')||document.body;host.prepend(caption);}
    caption.textContent=message(id,context);
    for(const action of spec.animation||[])window.PBMascot?.[action]?.();
    if(spec.behavior==='ONCE'){
      seen[id]=true;
      try{if(persist)await persist({...seen});}catch(e){delete seen[id];console.warn('Blasty first-use acknowledgment was not saved.');}
    }
    return true;
  }
  window.BBBlasty={fire,message,record,configure(data={}){overrides=data;},initialize(state={},save=null){seen=state;persist=save;ready=true;const waiting=queue;queue=[];waiting.forEach(([id,c])=>fire(id,c));},get events(){return BBBlastySeed.events;},get fields(){return BBBlastySeed.fields;}};
})();
