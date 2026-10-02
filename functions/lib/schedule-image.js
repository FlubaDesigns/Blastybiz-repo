'use strict';
// Uses the existing Gemini secret, AI allowance, campaign image collection and Storage.
const {randomUUID}=require('node:crypto');
const MODEL='gemini-3.1-flash-lite-image';
const error=(status,message)=>Object.assign(Error(message),{httpStatus:status});
function createImageGenerator({db,admin,reserveAiAction,trackAiUsage,fetchImpl=fetch,key=()=>process.env.GEMINI_API_KEY}) {
 return async function generate({uid,b,c,adId,prompt,requestId,packet}) {
   if(typeof prompt!=='string'||!prompt.trim()||prompt.length>2000)throw error(400,'Describe the image you want in 2,000 characters or fewer.');
   if(!key())throw error(503,'Image creation is unavailable. Upload a photo or choose one from your library.');
   const imageId='ai_'+requestId,ref=db.doc(`users/${uid}/businesses/${b}/campaigns/${c}/images/${imageId}`);
   const prior=await db.runTransaction(async tx=>{
     const d=await tx.get(ref);
     if(d.exists)return d.data();
     tx.set(ref,{uid,bizId:b,campaignId:c,scope:'campaign',retired:true,generationState:'working',createdAt:admin.firestore.FieldValue.serverTimestamp()});return null;
   });
   if(prior?.generationState==='ready')return {image:{id:imageId,url:prior.url,alt:prior.alt}};
   if(prior)throw error(409,prior.generationState==='working'?'Your image is still being created. Tap Check Image shortly.':'That image attempt did not finish. Choose Create Another to try again.');
   const start=Date.now();let usage=null;
   try {
     await reserveAiAction(uid);
     const r=await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key()},signal:AbortSignal.timeout(90000),body:JSON.stringify({model:MODEL,input:[{type:'text',text:'Create one polished square marketing image for this approved post. Do not invent offers, prices, contact information or factual claims. Avoid text unless the user explicitly requests it. User image direction: '+prompt.trim()+'\nApproved post context: '+JSON.stringify({adName:packet.adName,offer:packet.offer,context:packet.context,copy:packet.adaptations}).slice(0,10000)}]})});
     if(!r.ok)throw error(503,'AI could not create this image. Your current photo is unchanged.');
     const data=await r.json(),blocks=(data.steps||[]).filter(s=>s.type==='model_output').flatMap(s=>s.content||[]),images=blocks.filter(x=>x.type==='image'&&x.data);
     if(!images.length&&data.output_image?.data)images.push(data.output_image);
     const input=data.usage?.total_input_tokens||0,output=data.usage?.total_output_tokens||0;
     usage={input_tokens:input,output_tokens:output,image_tokens:images.length*1120};
     const img=images.at(-1);
     if(!img)throw error(422,'No image was returned. Try a different description. Your current photo is unchanged.');
     const bytes=Buffer.from(img.data,'base64'),png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
     if((!png&&!jpeg)||!bytes.length||bytes.length>=5*1024*1024)throw error(422,'The created image could not be saved. Try a simpler image description.');
     const path=`photos/${uid}/campaigns/${c}/${imageId}.${png?'png':'jpg'}`,bucket=admin.storage().bucket(),token=randomUUID();
     await bucket.file(path).save(bytes,{resumable:false,metadata:{contentType:png?'image/png':'image/jpeg',metadata:{firebaseStorageDownloadTokens:token}}});
     const url='https://firebasestorage.googleapis.com/v0/b/'+bucket.name+'/o/'+encodeURIComponent(path)+'?alt=media&token='+token,alt=prompt.trim().slice(0,250);
     await ref.update({url,path,alt,retired:false,generationState:'ready',generatedWith:MODEL});
     await log(null);return {image:{id:imageId,url,alt}};
   }catch(e){
     await ref.update({generationState:'failed'});await log(e.message==='LIMIT_REACHED'?'allowance_ceiling':'image_generation_failed');
     if(e.message==='LIMIT_REACHED'||e.code==='LIMIT_REACHED')throw error(429,'You have used your AI allowance for this month. Choose an existing photo or upload one.');
     if(e.httpStatus)throw e;
     throw error(503,'Image creation did not finish. Your current photo is unchanged.');
   }
   async function log(failureType){await trackAiUsage(uid,'scheduleImage',MODEL,usage,{failureType,timing:{aiElapsedMs:Date.now()-start},context:{businessId:b,campaignId:c,adId,scheduleId:adId,purpose:'scheduled_image'}});}
 };
}
module.exports={createImageGenerator,MODEL};
