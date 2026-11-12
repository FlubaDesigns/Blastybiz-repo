import {auth,db,storage} from './firebase-init-v2.js?v=20261111-cleanup';
import {collection,addDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {ref,uploadBytesResumable,getDownloadURL} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import {compressImage} from './photo-preparation.js?v=20261002';
// Canonical campaign library metadata, shared with the Ad photo uploader.
export async function saveCampaignImage(campaignId,imageData,bizId,uid=auth.currentUser?.uid) {
 if(!uid||!bizId||!campaignId)throw Error('Choose a business and campaign first.');
 const record=await addDoc(collection(db,'users',uid,'businesses',bizId,'campaigns',campaignId,'images'),{...imageData,uid,bizId,campaignId,scope:'campaign',createdAt:serverTimestamp()});
 return record.id;
}
export async function uploadCampaign(file,{businessId,campaignId,onProgress=()=>{}}) {
 const uid=auth.currentUser?.uid;if(!uid)throw Error('Sign in before uploading.');
 const blob=await compressImage(file),path=`photos/${uid}/campaigns/${campaignId}/${crypto.randomUUID()}.jpg`;
 const task=uploadBytesResumable(ref(storage,path),blob,{contentType:'image/jpeg'});
 await new Promise((resolve,reject)=>task.on('state_changed',s=>onProgress(Math.round(s.bytesTransferred/s.totalBytes*100)),reject,resolve));
 const url=await getDownloadURL(task.snapshot.ref),id=await saveCampaignImage(campaignId,{url,path},businessId,uid);
 return {id,url,path,alt:''};
}

// Logos join the existing business image library; the reward stores only its ID.
export async function uploadBusinessLogo(file,{businessId,onProgress=()=>{}}) {
 const uid=auth.currentUser?.uid;
 if(!uid||!businessId)throw Error('Choose your business first.');
 if(!file||file.size>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPEG or WebP logo under 5 MB.');
 const bitmap=await createImageBitmap(file);
 let blob;
 try{
  if(bitmap.width*bitmap.height>40000000)throw Error('Please choose a smaller logo image.');
  const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 }finally{bitmap.close();}
 if(!blob||blob.size>3000000)throw Error('Please choose a smaller logo image.');
 const path=`photos/${uid}/global/${crypto.randomUUID()}.png`;
 const task=uploadBytesResumable(ref(storage,path),blob,{contentType:'image/png'});
 await new Promise((resolve,reject)=>task.on('state_changed',s=>onProgress(Math.round(s.bytesTransferred/s.totalBytes*100)),reject,resolve));
 const url=await getDownloadURL(task.snapshot.ref);
 const record=await addDoc(collection(db,'users',uid,'businesses',businessId,'images'),{url,path,uid,bizId:businessId,scope:'global',contentType:'image/png',createdAt:serverTimestamp()});
 return {id:record.id,url,path};
}
