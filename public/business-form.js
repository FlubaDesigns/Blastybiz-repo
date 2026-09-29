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
  function error(key,value){const v=String(value||'').trim();if(!v)return 'Please enter '+(fields.find(f=>f.key===key)?.label||key).toLowerCase()+'.';if(v.length>300)return 'Please shorten this answer.';if(key==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))return 'Enter a valid email.';if(key==='phone'&&v.replace(/\D/g,'').length<7)return 'Enter a complete phone number.';return '';}
  function collect(mode,doc=document){return Object.fromEntries(fields.map(f=>[f.key,doc.getElementById(f[mode])?.value.trim()||'']));}
  root.BBSetup={fields,error,collect,validate(values){return fields.map(f=>({field:f,error:error(f.key,values[f.key])})).filter(x=>x.error);}};
  if(typeof module!=='undefined')module.exports=root.BBSetup;
})(typeof window==='undefined'?globalThis:window);
