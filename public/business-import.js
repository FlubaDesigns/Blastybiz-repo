/* Shared client for the existing authenticated import endpoint. Never saves content. */
(function(root){
  const pending=new Map();
  root.BBBusinessImport={extract(options){
    const {getToken,bizId,sourceUrl,source,setup=false}=options;
    const key=JSON.stringify({bizId,sourceUrl,source,setup});
    if(pending.has(key))return pending.get(key);
    const request=(async()=>{
      const token=await getToken();if(!token)throw Error('Sign in to import your website.');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),100000);
      try{
        const response=await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/extractBizContext',{
          method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
          body:JSON.stringify({bizId,sourceUrl,source,...(setup?{setup:true}:{})})
        });
        const data=await response.json();
        if(!response.ok)throw Error(data.error||'Could not import this website.');
        if(data.thin)throw Error(data.message||'Not enough readable content. Add your details below.');
        if(!data.aiContext)throw Error('No details found. Add your details below.');
        return data;
      }finally{clearTimeout(timer);}
    })();
    pending.set(key,request);request.then(()=>pending.delete(key),()=>pending.delete(key));return request;
  }};
})(window);
