import {auth,db,storage} from './firebase-init-v2.js';
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
