/* Review imports before applying them to the existing setup controls and recovery cache. */
(function(root){
  const fields={businessName:'f-bizName',phone:'f-phone',email:'f-email',street:'f-street',city:'f-city',state:'f-state',zip:'f-zip',category:'f-category',story:'f-story',different:'f-different',awards:'f-awards',customer:'f-customer',other:'f-other'};
  root.mountSetupImport=function({getToken,getBizId}){
    const el=id=>document.getElementById(id),button=el('setup-import-button'),panel=el('setup-import-review'),status=el('setup-import-status');
    let busy=false,proposed=[];
    button.addEventListener('click',async()=>{
      if(busy||root.cbPersonal())return;
      if(!root._cbReady){status.textContent='Loading your saved details…';return;}
      const url=BBWebsite.normalize(el('setup-import-url').value),error=BBWebsite.error(url,true);
      if(error){status.textContent=error;return;}
      busy=true;button.disabled=true;panel.hidden=true;proposed=[];status.textContent='Reading your website…';
      const original=Object.fromEntries(Object.values(fields).map(id=>[id,el(id).value]));
      const originalWebsite=el('f-website').value;
      try{
        const data=await BBBusinessImport.extract({getToken,bizId:getBizId()||undefined,sourceUrl:url,setup:true});
        if(root.cbPersonal())return;
        panel.replaceChildren();
        const heading=document.createElement('p');heading.textContent='Review these details. Existing answers stay as they are.';panel.append(heading);
        for(const [key,id] of Object.entries(fields)){
          const value=(key in (data.profile||{})?data.profile[key]:data.aiContext[key]);
          if(typeof value!=='string'||!value.trim()||el(id).value.trim()||original[id].trim())continue;
          const label=document.createElement('label'),input=document.createElement('textarea');
          label.textContent=el(id).closest('.cb-field').querySelector('label').textContent;input.className='cb-ta';input.value=value;input.rows=2;input.maxLength=3000;label.append(input);panel.append(label);proposed.push({id,input});
        }
        if(!proposed.length){status.textContent='No missing details found. Your answers are unchanged.';return;}
        const apply=document.createElement('button');apply.type='button';apply.className='btn btn__primary';apply.textContent='Use these details';
        apply.addEventListener('click',()=>{
          if(root.cbPersonal()){panel.hidden=true;return;}
          for(const {id,input} of proposed){if(el(id).value.trim()||!input.value.trim())continue;el(id).value=input.value.trim();el(id).dispatchEvent(new Event('input',{bubbles:true}));}
          if(!originalWebsite.trim()&&!el('f-website').value.trim()){el('f-website').value=url;el('f-hasWebsite').value='yes';el('f-website').dispatchEvent(new Event('input',{bubbles:true}));}
          root.cbConfigureForm();panel.hidden=true;proposed=[];status.textContent='Added to your form. Review, then save your post.';
        });
        const cancel=document.createElement('button');cancel.type='button';cancel.className='btn btn__ghost';cancel.textContent='Discard';cancel.addEventListener('click',()=>{panel.hidden=true;proposed=[];status.textContent='Your answers are unchanged.';});
        const row=document.createElement('div');row.className='row';row.append(apply,cancel);panel.append(row);panel.hidden=false;status.textContent='Review before adding.';
      }catch(error){status.textContent=error.name==='AbortError'?'This is taking too long. You can fill in the form below.':error.message;}
      finally{busy=false;button.disabled=false;}
    });
  };
})(window);
