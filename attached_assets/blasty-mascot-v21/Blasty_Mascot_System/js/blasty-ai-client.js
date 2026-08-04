/** Authenticated checkpoint client. Adjust endpoint names after Cloud Function implementation. */
export function createBlastyAIClient({baseUrl,getToken}){
  async function post(path,payload){const token=await getToken();const r=await fetch(`${baseUrl}/${path}`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(payload)});if(!r.ok)throw new Error(`${path} failed (${r.status})`);return r.json();}
  return {classifyBusiness:p=>post('onboardClassify',p),analyzeBusiness:p=>post('onboardAnalyze',p),generateProfile:p=>post('onboardFinalize',p),rescue:p=>post('onboardRescue',p)};
}
