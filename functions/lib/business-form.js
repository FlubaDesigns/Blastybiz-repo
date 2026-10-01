/* The same pre-email fields are restored into the canonical setup form. */
(function(root){
  'use strict';
  const fields=[
    {key:'ownerFirstName',signup:'su-name',setup:'f-ownerName',label:'First name',guidance:'profile.ownerName'},
    {key:'ownerLastName',signup:'su-last-name',setup:'f-ownerLastName',label:'Last name (optional)',guidance:'profile.ownerName'},
    {key:'businessName',signup:'su-business',setup:'f-bizName',label:'Business name',guidance:'profile.businessName'},
    {key:'ownerRole',signup:'su-role',setup:'f-role',label:'Role or title',guidance:'profile.role'},
    {key:'email',signup:'su-email',setup:'f-email',label:'Email',guidance:'profile.contactEmail'},
    {key:'phone',signup:'su-phone',setup:'f-phone',label:'Phone',guidance:'profile.phone'}
  ];
  // Explicit empty parts win over a legacy full name, so clearing a last name sticks.
  function nameParts(value={}) {
    const legacy=String(value.ownerName||'').trim().split(/\s+/);
    const ownerFirstName=String(value.ownerFirstName??legacy.shift()??'').trim();
    const ownerLastName=String(value.ownerLastName??(value.ownerFirstName===undefined?legacy.join(' '):'')).trim();
    return {ownerFirstName,ownerLastName,ownerName:[ownerFirstName,ownerLastName].filter(Boolean).join(' ')};
  }
  function mentions(value={}) {
    return Object.fromEntries(['firstName','lastName','role','address','phone','email','website'].map(k=>[k,(value[k]??(['firstName','lastName'].includes(k)?value.name:undefined))==='yes'?'yes':'no']));
  }
  function profileMentions(value={}) {
    const prefs={};
    for(const k of ['name','firstName','lastName','role','address','phone','email','website']){
      const key='ynMention'+k[0].toUpperCase()+k.slice(1);
      const v=value[key]??value.toggles?.[key];
      if(v!==undefined)prefs[k]=(v==='yes'||v===true)?'yes':'no';
    }
    return mentions(prefs);
  }
  function mentionedName(profile,prefs) {
    const parts=nameParts(profile),allowed=mentions(prefs);
    return [allowed.firstName==='yes'?parts.ownerFirstName:'',allowed.lastName==='yes'?parts.ownerLastName:''].filter(Boolean).join(' ');
  }
  function sellerType(value){return value==='personal'?'personal':'business';}
  function error(key,value,type){if(type==='personal'&&['businessName','ownerRole'].includes(key))return '';const v=String(value||'').trim();if(!v&&key==='ownerLastName')return '';if(!v)return 'Please enter '+(fields.find(f=>f.key===key)?.label||key).toLowerCase()+'.';if(v.length>300)return 'Please shorten this answer.';if(key==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))return 'Enter a valid email.';if(key==='phone'&&v.replace(/\D/g,'').length<7)return 'Enter a complete phone number.';return '';}
  function formatPhone(value){
    const raw=String(value||'');
    // Keep international numbers and extensions intact.
    if(!/^[+\d\s().-]*$/.test(raw))return raw;
    const digits=raw.replace(/\D/g,'');
    const country=digits.startsWith('1')&&(raw.trim().startsWith('+')||digits.length===11);
    if(raw.includes('+')&&!(raw.trim().startsWith('+1')&&country))return raw;
    const local=country?digits.slice(1):digits;
    if(local.length>10)return raw;
    const formatted=local.length>6?local.slice(0,3)+'-'+local.slice(3,6)+'-'+local.slice(6):local.length>3?local.slice(0,3)+'-'+local.slice(3):local;
    return (country?(raw.trim().startsWith('+')?'+1 ':'1-'):'')+formatted;
  }
  function formatPhoneInput(input,event){
    // Let Backspace/Delete work naturally across a separator; normalize on blur.
    if(event?.isComposing||event?.inputType?.startsWith('delete'))return;
    const before=input.value,formatted=formatPhone(before);
    if(before===formatted)return;
    const start=input.selectionStart,end=input.selectionEnd;
    const caret=offset=>{
      const count=(before.slice(0,offset).match(/\d/g)||[]).length;
      if(!count)return 0;
      let seen=0;
      for(let i=0;i<formatted.length;i++)if(/\d/.test(formatted[i])&&++seen===count)return i+1;
      return formatted.length;
    };
    input.value=formatted;
    if(event?.type==='input'&&start!==null&&end!==null)input.setSelectionRange(caret(start),caret(end));
  }
  function collect(mode,doc=document){const values={sellerType:sellerType(doc.getElementById(mode==='signup'?'su-sellerType':'f-sellerType')?.value),...Object.fromEntries(fields.map(f=>[f.key,doc.getElementById(f[mode])?.value.trim()||'']))};return {...values,...nameParts(values)};}
  root.BBSetup={fields,error,collect,sellerType,formatPhone,formatPhoneInput,nameParts,mentions,profileMentions,mentionedName,validate(values){values={...values,...nameParts(values)};return fields.map(f=>({field:f,error:error(f.key,values[f.key],values.sellerType)})).filter(x=>x.error);}};
  if(typeof module!=='undefined')module.exports=root.BBSetup;
})(typeof window==='undefined'?globalThis:window);
