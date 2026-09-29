import {auth} from './firebase-init-v2.js';
import {getFirestore,doc,getDoc,setDoc} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
const db=getFirestore();
const configured=getDoc(doc(db,'config','blasty')).then(s=>BBBlasty.configure(s.exists()?s.data():{})).catch(()=>{});
onAuthStateChanged(auth,async user=>{
  await configured;
  if(!user){BBBlasty.initialize();return;}
  try{
    const ref=doc(db,'users',user.uid),s=await getDoc(ref);
    BBBlasty.initialize(s.data()?.blastySeen||{},state=>setDoc(ref,{blastySeen:state},{merge:true}));
  }catch(e){console.warn('Blasty guidance state unavailable.');BBBlasty.initialize();}
});
