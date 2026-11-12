import {auth,db} from './firebase-init-v2.js?v=20261111-cleanup';
import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {collection,getDocsFromServer} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {uploadBusinessLogo} from './photo-library.js?v=20261112-shirt';
const el=id=>document.getElementById('reward-'+id);
let user,state,busy=false,imagesRequest=0,poll,addressesLoaded=false;
const shippingKeys=['name','address1','address2','city','region','postalCode','country'];
const statuses={pending:'Your personalized preview is being generated. You can return to this page later.',failed:'Your preview needs another attempt. Retry the same selection.',approved:'Your approved shirt is saved for fulfillment.',ordered:'Your shirt is in fulfillment.',shipped:'Your shirt has shipped.'};
async function api(body){
 const current=user,token=await current.getIdToken();
 const response=await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/manageQrReward',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
 const data=await response.json();if(current!==user)throw Error('The signed-in account changed.');
 if(!response.ok)throw Error(data.error||'Your shirt is temporarily unavailable.');return data;
}
function options(id,values,placeholder,selected){
 const select=el(id);select.replaceChildren(new Option(placeholder,''));
 for(const item of values)select.add(new Option(item.label||item,item.value||item));
 select.value=selected||'';
}
function sizes(selected=''){
 options('size',[...new Set((state?.product?.availableVariants||[]).filter(v=>v.color===el('color').value).map(v=>v.size))],'Choose a size',selected);
}
async function images(selected=''){
 const seq=++imagesRequest,businessId=el('business').value,uid=user.uid;
 options('image',[],'Choose a PNG logo','');
 if(!businessId)return;
 const snap=await getDocsFromServer(collection(db,'users',uid,'businesses',businessId,'images'));
 if(seq!==imagesRequest||user?.uid!==uid)return;
 options('image',snap.docs.filter(d=>!d.data().retired&&String(d.data().path).endsWith('.png')).map((d,i)=>({value:d.id,label:d.data().name||'Saved logo '+(i+1)})),'Choose a PNG logo',selected);
}
function invalidate(){
 if(state?.approved)return;
 el('consent').checked=false;el('approve').disabled=true;el('preview').hidden=true;
 el('logo-options').hidden=el('style').value==='qr-only';
}
function matching(){
 const s=state?.selection,p=state?.preview;
 return !!s&&p?.status==='ready'&&s.businessId===el('business').value&&s.color===el('color').value&&s.size===el('size').value&&s.graphicChoice===el('style').value&&(s.graphicChoice==='qr-only'||s.imageId===el('image').value);
}
function addressChoice(){
 const approved=!!state?.approved,same=el('same-address').checked;
 el('billing-fields').hidden=approved;el('billing-fields').disabled=approved||busy;
 el('address-choice').hidden=approved;el('same-address').disabled=approved||busy;
 el('shipping-fields').hidden=!approved&&same;el('shipping-fields').disabled=approved||busy||same;
 el('same-address').setAttribute('aria-expanded',String(!same));
 for(const key of shippingKeys)el('billing-'+key).required=same&&key!=='address2';
}
function addressChanged(){
 if(state?.approved)return;
 el('consent').checked=false;el('approve').disabled=true;addressChoice();
}
function render(){
 clearTimeout(poll);const p=state.preview;
 el('content').hidden=!state.eligible;el('upgrade').hidden=state.eligible||state.available===false;
 el('message').textContent=state.message||statuses[p?.status]||state.availability||(state.approved?'Your approval is saved. Continue your claim if it was interrupted.':'Your annual Pro purchase includes one free shirt.');
 if(!state.eligible)return;
 el('title').textContent=state.product?.name||'Your QR Gear shirt';el('description').textContent=state.product?.description||'';el('terms').textContent=state.terms||'';
 if(state.approved&&state.shipping)for(const key of shippingKeys)el(key).value=state.shipping[key]||'';
 el('options').disabled=state.approved||busy||!state.product;
 addressChoice();
 el('logo-options').hidden=el('style').value==='qr-only';
 const show=!!p?.mockupUrl&&/^https:\/\//.test(p.mockupUrl)&&(state.approved||matching());
 el('preview').hidden=!show;
 if(show){el('preview-link').href=p.mockupUrl;el('preview-image').src=p.mockupUrl;el('preview-caption').textContent=p.color+' · '+p.size+' · '+(p.graphicChoice==='qr-only'?'QR code only':'Full graphic');el('destination').href=p.websiteUrl;el('destination').textContent=p.websiteUrl;}
 const ordered=['ordered','shipped'].includes(p?.status);
 el('consent').disabled=state.approved||busy;if(state.approved)el('consent').checked=true;
 el('approve').textContent=state.approved?'Continue saved claim':'Claim my free shirt';
 el('approve').disabled=busy||ordered||(!state.approved&&(!matching()||!el('consent').checked));
 el('generate').disabled=busy||state.approved||p?.status==='pending'||Boolean(state.product?.optionsError);
 el('generate').textContent=p?.status==='failed'?'Retry my shirt preview':'Create my shirt preview';
 const track=p?.tracking?.url;el('tracking').hidden=!/^https:\/\//.test(track||'');if(!el('tracking').hidden)el('tracking').href=track;
 if(p?.status==='pending')poll=setTimeout(()=>run(()=>refresh(true)),30000);
}
async function refresh(remote=false){
 state=await api({action:'status',refresh:remote});
 if(state.selection){el('business').value=state.selection.businessId;el('style').value=state.selection.graphicChoice;await images(state.selection.imageId);}
 options('color',state.product?.availableColors||[],'Choose a color',state.selection?.color);sizes(state.selection?.size);
 if(!addressesLoaded){
  if(state.billingAddress)for(const key of shippingKeys)el('billing-'+key).value=state.billingAddress[key]||'';
  if(state.shipping)el('same-address').checked=false;
  addressesLoaded=true;
 }
 if(state.shipping)for(const key of shippingKeys)el(key).value=state.shipping[key]||'';
 render();
}
async function run(fn){
 if(busy||!user)return;busy=true;el('error').textContent='';el('refresh').disabled=true;
 if(state)render();
 try{await fn();}catch(e){el('error').textContent=e.message;}
 finally{busy=false;el('refresh').disabled=false;if(state)render();}
}
el('refresh').addEventListener('click',()=>run(()=>refresh(true)));
el('business').addEventListener('change',()=>{invalidate();run(()=>images());});
el('color').addEventListener('change',()=>{sizes();invalidate();});
for(const key of ['image','size','style'])el(key).addEventListener('change',invalidate);
el('consent').addEventListener('change',()=>{el('approve').disabled=busy||(!state?.approved&&(!matching()||!el('consent').checked));});
el('same-address').addEventListener('change',addressChanged);
for(const key of shippingKeys)for(const prefix of ['','billing-'])el(prefix+key).addEventListener('input',addressChanged);
el('upload').addEventListener('change',()=>run(async()=>{
 const file=el('upload').files[0],businessId=el('business').value;invalidate();
 const result=await uploadBusinessLogo(file,{businessId,onProgress:p=>{el('upload-status').textContent='Saving logo… '+p+'%';}});
 await images(result.id);el('upload-status').textContent='Logo saved in your business library.';
}));
el('generate').addEventListener('click',()=>run(async()=>{
 el('message').textContent='Creating your personalized shirt preview…';
 state=await api({action:'preview',businessId:el('business').value,imageId:el('image').value,color:el('color').value,size:el('size').value,graphicChoice:el('style').value});render();
}));
el('shipping').addEventListener('submit',event=>{
 event.preventDefault();if(!state?.approved&&(!matching()||!el('consent').checked))return;
 if(!state?.approved&&!el('shipping').reportValidity())return;
 const prefix=!state.approved&&el('same-address').checked?'billing-':'';
 const shipping=Object.fromEntries(shippingKeys.map(k=>[k,el(prefix+k).value.trim()]));shipping.country=shipping.country.toUpperCase();
 run(async()=>{
  try{state=await api({action:'approve',approved:true,previewId:state.preview.previewId,shipping});}
  catch(error){await refresh(true).catch(()=>{});throw error;}
 });
});
onAuthStateChanged(auth,async current=>{
 user=current;state=null;addressesLoaded=false;el('shipping').reset();clearTimeout(poll);el('content').hidden=true;
 if(!current?.emailVerified)return;
 const owner=new URLSearchParams(location.search).get('ownerUid');
 if(owner&&owner!==current.uid){el('error').textContent='Sign in with the account that received this reward email.';return;}
 await run(async()=>{
  const businesses=await getDocsFromServer(collection(db,'users',current.uid,'businesses'));
  options('business',businesses.docs.filter(d=>d.data().status!=='archived').map(d=>({value:d.id,label:d.data().businessName||d.data().name||'Your business'})),'Choose your business','');
  await refresh(true);
 });
});
