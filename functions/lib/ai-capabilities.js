'use strict';
// The admin API and its validation share this list. Adding an adapter alone
// does not enable a provider: its deployed entrypoints must have key access.
const AI_PROVIDERS = Object.freeze([
  {id:'gemini', label:'Google Gemini', keyName:'GEMINI_API_KEY', models:[
    {id:'gemini-flash-lite-latest',label:'Gemini Flash Lite'},
    {id:'gemini-flash-latest',label:'Gemini Flash'},
    {id:'gemini-pro-latest',label:'Gemini Pro'}]},
  {id:'anthropic', label:'Anthropic Claude', keyName:'ANTHROPIC_API_KEY', models:[
    {id:'claude-haiku-4-5',label:'Claude Haiku 4.5'},
    {id:'claude-sonnet-4-5-20250929',label:'Claude Sonnet 4.5'},
    {id:'claude-opus-4-5',label:'Claude Opus 4.5'}]},
]);
const providerById = id => AI_PROVIDERS.find(p=>p.id===id);
async function adminCapabilities(readKey) {
  return Promise.all(AI_PROVIDERS.map(async ({id,label,models,keyName})=>{
    let configured=false;
    try {const key=await readKey(keyName);configured=!!key&&key!=='placeholder';} catch (_) {}
    return {id,label,models,configured};
  }));
}
module.exports={AI_PROVIDERS,providerById,adminCapabilities};
