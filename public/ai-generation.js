/* One browser request owner for initial generation and individual rewrites. */
(function(root){
 'use strict';
 const inflight=new Map(),memory=new Map();
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function read(key){try{return JSON.parse(sessionStorage.getItem(key))||memory.get(key);}catch(_){return memory.get(key);}}
 function write(key,value){memory.set(key,value);try{sessionStorage.setItem(key,JSON.stringify(value));}catch(_){}}
 function clear(key){memory.delete(key);try{sessionStorage.removeItem(key);}catch(_){}}
 async function request(url,options){
   const body=JSON.parse(options.body),listing=body.listing||{};
   const key='bb-generation:'+JSON.stringify([root._bbUid,listing.businessId,listing.campaignId,listing.adId,!!body.isRegeneration,(body.platforms||[]).map(p=>p.id)]);
   const stable={...body,listing:{...listing,requestId:undefined},requestId:undefined,generationAttemptId:undefined};
   const fingerprint=JSON.stringify(stable),prior=read(key);
   const id=prior?.fingerprint===fingerprint?prior.id:crypto.randomUUID();
   write(key,{fingerprint,id});
   body.listing={...listing,requestId:id};body.generationAttemptId=id;
   const identity=key+':'+id;
   if(inflight.has(identity))return (await inflight.get(identity)).clone();
   const work=(async()=>{
     const deadline=Date.now()+150000;let networkRetries=0;
     while(Date.now()<deadline){
       const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(115000,deadline-Date.now()));
       try {
         const response=await fetch(url,{...options,body:JSON.stringify(body),signal:controller.signal});
         const result=await response.clone().json().catch(()=>({}));
         if(result.code==='GENERATION_PENDING'){await pause(1800);continue;}
         if(response.ok || (response.status>=400&&response.status<500))clear(key);
         return response;
       }catch(e){if(++networkRetries>1)throw Error('Connection interrupted. Your request is saved; tap Retry to recover it.');await pause(1000);}
       finally{clearTimeout(timer);}
     }
     throw Error('Your copy is still being prepared. Tap Retry to recover this request.');
   })();
   inflight.set(identity,work);
   try{return (await work).clone();}finally{inflight.delete(identity);}
 }
 root.BBAI={fetch:request};
})(window);
