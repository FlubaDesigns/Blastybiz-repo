/* Provider/model choices come from the authenticated admin API. */
(function () {
  'use strict';
  window.createAdminAiSettings = function ({request, document: doc = document}) {
    const el=id=>doc.getElementById(id), provider=el('ai-provider'), fast=el('ai-fast-model'), smart=el('ai-smart-model'), save=el('ai-save-button');
    let providers=[], active=null, ready=false, busy=false;
    const option=(id,label,disabled=false)=>{const o=doc.createElement('option');o.value=id;o.textContent=label;o.disabled=disabled;return o;};
    function lock() {for(const n of [provider,fast,smart])n.disabled=!ready||busy;save.disabled=!ready||busy||!providers.find(p=>p.id===provider.value)?.configured;}
    function models(p, values={}) {
      for(const [select,key] of [[fast,'fastModel'],[smart,'smartModel']]) {
        select.replaceChildren();
        for(const m of p?.models||[]) select.append(option(m.id,m.label));
        if(values[key]&&!Array.from(select.options).some(o=>o.value===values[key]))select.append(option(values[key],values[key]+' (saved)'));
        if(values[key])select.value=values[key];
      }
      lock();
    }
    provider.addEventListener('change',()=>models(providers.find(p=>p.id===provider.value),active?.provider===provider.value?active:{}));
    save.addEventListener('click',async()=>{
      if(!ready||busy||save.disabled||!fast.value||!smart.value)return;
      const chosen={provider:provider.value,fastModel:fast.value,smartModel:smart.value};
      busy=true;lock();el('ai-save-msg').textContent='Checking and saving…';
      try {
        await request('adminSetAiSettings',chosen);active=chosen;
        el('ai-settings-status').textContent='Active: '+providers.find(p=>p.id===chosen.provider).label+' · '+chosen.fastModel+' · '+chosen.smartModel;
        el('ai-save-msg').textContent='Saved.';el('ai-health-banner').hidden=true;
      } catch(e) {el('ai-save-msg').textContent=e.message||'Could not save. Existing settings are unchanged.';}
      finally {busy=false;lock();}
    });
    lock();
    return {async load() {
      ready=false;lock();
      try {
        const data=await request('adminGetAiSettings');
        if(!Array.isArray(data.providers)||!data.providers.length||!data.provider||!data.fastModel||!data.smartModel)throw Error('AI settings unavailable. Reload to retry.');
        providers=data.providers;active=data;provider.replaceChildren();
        for(const p of providers)provider.append(option(p.id,p.label+(p.configured?'':' — unavailable'),!p.configured));
        if(!providers.some(p=>p.id===data.provider))provider.append(option(data.provider,data.provider+' (saved; unavailable)',true));
        provider.value=data.provider;ready=true;models(providers.find(p=>p.id===data.provider),data);
        el('ai-settings-status').textContent='Active: '+data.provider+' · '+data.fastModel+' · '+data.smartModel+(data.configured===false?' · default settings':'');
        el('ai-health-banner').hidden=!data.lastError;
        if(data.lastError)el('ai-health-banner').textContent='The last AI request failed. Check the provider and model before saving.';
        return data;
      } catch(e) {el('ai-settings-status').textContent='AI settings unavailable. Reload to retry.';ready=false;lock();throw e;}
    }};
  };
})();
