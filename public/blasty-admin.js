import {getFirestore,doc,getDoc,setDoc} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
const db=getFirestore(),host=document.createElement('section');host.className='card';
host.innerHTML='<h2>Blasty events and field guidance</h2><p>Changes apply to the same event and field IDs throughout the site.</p><label>Response<select id="blasty-response"></select></label><label>Message<textarea id="blasty-message" rows="4"></textarea></label><label><input id="blasty-enabled" type="checkbox"> Enabled</label><label>Behavior<select id="blasty-behavior"><option>ONCE</option><option>WHEN NEEDED</option><option>ALWAYS</option><option>OPTIONAL</option></select></label><label>Actions, separated by commas<input id="blasty-actions"></label><button type="button" id="blasty-save">Save response</button><p id="blasty-admin-status" role="status"></p>';
(document.querySelector('main,.admin-wrap,.container')||document.body).appendChild(host);
const e=id=>document.getElementById(id),select=e('blasty-response');
for(const [kind,entries] of Object.entries({events:BBBlasty.events,fields:BBBlasty.fields}))for(const id of Object.keys(entries)){const option=document.createElement('option');option.value=kind+':'+id;option.textContent=id;select.appendChild(option);}
async function load(){const s=await getDoc(doc(db,'config','blasty'));BBBlasty.configure(s.exists()?s.data():{});show();}
function show(){const [kind,id]=select.value.split(':'),v=BBBlasty.record(id,kind==='fields');e('blasty-message').value=v.message||'';e('blasty-enabled').checked=v.enabled!==false;e('blasty-behavior').value=v.behavior||'WHEN NEEDED';e('blasty-actions').value=(v.animation||[]).join(', ');}
select.onchange=show;e('blasty-save').onclick=async()=>{
  const [kind,id]=select.value.split(':'),actions=e('blasty-actions').value.split(',').map(s=>s.trim()).filter(Boolean);
  if(actions.some(a=>typeof PBMascot[a]!=='function')){e('blasty-admin-status').textContent='Choose an existing mascot action.';return;}
  try{e('blasty-save').disabled=true;await setDoc(doc(db,'config','blasty'),{[kind]:{[id]:{message:e('blasty-message').value,enabled:e('blasty-enabled').checked,behavior:e('blasty-behavior').value,animation:actions}}},{merge:true});await load();e('blasty-admin-status').textContent='Saved.';}
  catch(err){e('blasty-admin-status').textContent='Not saved: '+err.message;}
  finally{e('blasty-save').disabled=false;}
};
load().catch(e=>document.getElementById('blasty-admin-status').textContent=e.message);
