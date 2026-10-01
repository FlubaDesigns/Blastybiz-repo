/* The same five pre-email fields are restored into the canonical setup form. */
(function(root){
  'use strict';
  const fields=[
    {key:'ownerName',signup:'su-name',setup:'f-ownerName',label:'Your name',guidance:'profile.ownerName'},
    {key:'businessName',signup:'su-business',setup:'f-bizName',label:'Business name',guidance:'profile.businessName'},
    {key:'ownerRole',signup:'su-role',setup:'f-role',label:'Role or title',guidance:'profile.role'},
    {key:'email',signup:'su-email',setup:'f-email',label:'Email',guidance:'profile.contactEmail'},
    {key:'phone',signup:'su-phone',setup:'f-phone',label:'Phone',guidance:'profile.phone'}
  ];
  function sellerType(value){return value==='personal'?'personal':'business';}
  function error(key,value,type){if(type==='personal'&&['businessName','ownerRole'].includes(key))return '';const v=String(value||'').trim();if(!v)return 'Please enter '+(fields.find(f=>f.key===key)?.label||key).toLowerCase()+'.';if(v.length>300)return 'Please shorten this answer.';if(key==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))return 'Enter a valid email.';if(key==='phone'&&v.replace(/\D/g,'').length<7)return 'Enter a complete phone number.';return '';}
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
  function collect(mode,doc=document){return {sellerType:sellerType(doc.getElementById(mode==='signup'?'su-sellerType':'f-sellerType')?.value),...Object.fromEntries(fields.map(f=>[f.key,doc.getElementById(f[mode])?.value.trim()||'']))};}
  root.BBSetup={fields,error,collect,sellerType,formatPhone,formatPhoneInput,validate(values){return fields.map(f=>({field:f,error:error(f.key,values[f.key],values.sellerType)})).filter(x=>x.error);}};
  if(typeof module!=='undefined')module.exports=root.BBSetup;
})(typeof window==='undefined'?globalThis:window);
