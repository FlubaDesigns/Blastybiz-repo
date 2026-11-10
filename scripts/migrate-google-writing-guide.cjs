'use strict';
// Remove only copied historical defaults. Custom administrator wording survives.
const legacy={maxChars:750,format:'Business description. Plain text only. No markdown, no links.',dos:'Include primary service keywords in the first sentence\nMention your city or neighborhood for local SEO\nState what makes you different from competitors\nInclude specialty, experience level, or credentials',donts:'No "best in town" or superlatives — Google may suppress\nNo URLs or phone numbers — they are stripped from descriptions\nNo emoji\nNo all-caps\nNo competitor names'};
function normalizeGoogleOverride(override){
 const next={...override};
 for(const [key,value] of Object.entries(legacy))if((Array.isArray(next[key])?next[key].join('\n'):next[key])===value)delete next[key];
 return next;
}
async function migrate(db,apply=false){
 const ref=db.doc('settings/platformDocs');
 return db.runTransaction(async tx=>{
   const snap=await tx.get(ref),current=snap.data()?.google;
   if(!current)return {changed:false,applied:false};
   const next=normalizeGoogleOverride(current),changed=JSON.stringify(next)!==JSON.stringify(current);
   if(changed&&apply)tx.update(ref,{google:next});
   return {changed,applied:changed&&apply};
 });
}
module.exports={normalizeGoogleOverride,migrate};
if(require.main===module){
 const args=process.argv.slice(2);
 if(!args.includes('--project=blastybiz-9523e')||args.some(a=>!['--project=blastybiz-9523e','--apply'].includes(a)))throw Error('Explicit BlastyBiz project required.');
 const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'blastybiz-9523e'});
 migrate(admin.firestore(),args.includes('--apply')).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
