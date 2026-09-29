'use strict';
const PROJECT='blastybiz-9523e',BUCKET='blastybiz-firestore-backups';
async function waitOperation(request,operation,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=Date.now,timeoutMs=8*60000}={}) {
 if(!operation?.name?.startsWith(`projects/${PROJECT}/databases/`))throw Error('Unexpected backup operation target');
 const deadline=clock()+timeoutMs;let current=operation;
 while(!current.done){
  if(clock()>deadline)throw Error('Backup operation still pending: '+operation.name);
  await sleep(4000);current=await request('https://firestore.googleapis.com/v1/'+operation.name);
 }
 if(current.error)throw Error('Backup operation failed: '+current.error.code);
 return current;
}
async function runBackup({db,admin,request,clock=()=>new Date(),wait=waitOperation}) {
 const day=clock().toISOString().slice(0,10),ref=db.collection('backupRuns').doc(day);
 const prior=(await ref.get()).data();
 if(prior?.status==='completed')return prior;
 let operation=prior?.operation?{name:prior.operation}:null;
 try{
  if(!operation){
   const output=`gs://${BUCKET}/${day}-${require('node:crypto').randomUUID()}`;
   operation=await request(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default):exportDocuments`,'POST',{outputUriPrefix:output});
   if(!operation.name)throw Error('Export did not return an operation');
   await ref.set({status:'running',operation:operation.name,outputUriPrefix:output,startedAt:admin.firestore.FieldValue.serverTimestamp()});
  }
  const completed=await wait(request,operation);
  const result={status:'completed',operation:operation.name,outputUriPrefix:completed.response?.outputUriPrefix||prior?.outputUriPrefix,completedAt:admin.firestore.FieldValue.serverTimestamp()};
  if(!result.outputUriPrefix?.startsWith(`gs://${BUCKET}/`))throw Error('Unexpected export destination');
  await ref.set(result,{merge:true});return result;
 }catch(e){
  await ref.set({status:'failed',lastError:String(e.message).slice(0,300),updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true}).catch(()=>{});
  throw e; // Scheduler must see failure; API acceptance alone is not completion.
 }
}
module.exports={PROJECT,BUCKET,waitOperation,runBackup};
