'use strict';
// Initial copy, owner rewrites and scheduled refreshes share this validator and
// bounded repair loop. Rules are resolved by the existing writing-guide owner.
function validateCopy(value,platforms) {
 const good={},missing=[];
 for(const p of platforms) {
   const text=value?.[p.id],limit=Math.min(12000,Number(p.doc?.maxChars)||12000);
   if(typeof text!=='string'||!text.trim()||Array.from(text.trim()).length>limit)missing.push(p.id);
   else good[p.id]=text.trim();
 }
 return {good,missing};
}
async function generatePlatformCopy({platforms,prompt,generate,requireAll=false,clock=Date.now}) {
 const started=clock(),adaptations={};let missing=platforms.map(p=>p.id);
 for(let attempt=0;attempt<2&&missing.length;attempt++) {
   const selected=platforms.filter(p=>missing.includes(p.id));
   const remaining=100000-(clock()-started);if(remaining<3000)break;
   const instructions=attempt?'\nREPAIR ONLY these missing or invalid destinations: '+missing.join(', ')+'. Return {"adaptations":{platformId:"plain text"}} for only those destinations. Keep all supplied facts and each character limit.':'';
   try {
     const result=await generate(prompt+instructions,{maxTokens:Math.min(12000,Math.max(1024,Math.ceil(selected.reduce((n,p)=>n+(Number(p.doc?.maxChars)||2000),0)/3)+500)),timeoutMs:Math.min(attempt?40000:60000,remaining)});
     const parsed=JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g,'').trim());
     const checked=validateCopy(parsed?.adaptations,selected);Object.assign(adaptations,checked.good);missing=missing.filter(p=>!Object.hasOwn(adaptations,p));
   } catch(_) { /* Retry once within the same reservation; never invent copy. */ }
 }
 if(!Object.keys(adaptations).length||(requireAll&&missing.length))throw Object.assign(Error('Copy could not be completed. Your saved copy is unchanged; please retry.'),{code:'GENERATION_FAILED'});
 return {adaptations,failedPlatforms:missing,status:missing.length?'partial':'complete'};
}
module.exports={validateCopy,generatePlatformCopy};
