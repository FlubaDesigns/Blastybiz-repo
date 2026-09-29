import {auth} from './firebase-init-v2.js';
import {getFirestore,doc,getDoc,setDoc,onSnapshot} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
const db=getFirestore();
const configured=getDoc(doc(db,'config','blasty')).then(s=>BBBlasty.configure(s.exists()?s.data():{})).catch(()=>{});
let stopNotice=null;
onAuthStateChanged(auth,async user=>{
  if(stopNotice){stopNotice();stopNotice=null;}
  await configured;
  if(!user){BBBlasty.initialize();return;}
  try{
    const ref=doc(db,'users',user.uid),s=await getDoc(ref);
    BBBlasty.initialize(s.data()?.blastySeen||{},state=>setDoc(ref,{blastySeen:state},{merge:true}));
    let lastNotice=null;stopNotice=onSnapshot(ref,snapshot=>{const notice=snapshot.data()?.aiAllowanceNotice||null;if(notice&&notice!==lastNotice)BBBlasty.fire('ai.allowance_near',{needed:true});lastNotice=notice;});
  }catch(e){console.warn('Blasty guidance state unavailable.');BBBlasty.initialize();}
});
