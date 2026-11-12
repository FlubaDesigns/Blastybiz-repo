'use strict';
const {onRequest,withAuth,db,admin,getSquare,sendResendEmail,APP_BASE_URL,checkUidRateLimit,onDocumentCreated}=require('../lib/shared');
const {readFlubaProviderKey}=require('../lib/fluba-provider-keys');
const {createAnnualRewardService}=require('../lib/annual-reward');
const service=createAnnualRewardService({db,admin,getSquare,readKey:readFlubaProviderKey,sendEmail:sendResendEmail,appUrl:APP_BASE_URL});
exports.manageQrReward=onRequest({invoker:'public',region:'us-central1',timeoutSeconds:300},withAuth(async(req,res,user)=>{
  res.set('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  if(!(await checkUidRateLimit('qrReward',user.uid,60,3600000)))return res.status(429).json({error:'Too many shirt requests. Please try again shortly.'});
  try{res.json(await service.manage(user.uid,req.body||{}));}
  catch(e){console.warn('[QR reward]',e.httpStatus||503);res.status(e.httpStatus||503).json({error:e.httpStatus?e.message:'Your shirt is saved. Please retry shortly.'});}
}));
exports.rewardReadyEmail=onDocumentCreated({document:'setupNudges/{id}',region:'us-central1',retry:true},async event=>{
  const job=event.data?.data();
  if(job?.kind==='annual-pro-reward')await service.deliver(job.uid);
});
// Internal callers reuse this worker; it is not a second deployed endpoint.
Object.defineProperty(exports,'deliverAnnualReward',{value:uid=>service.deliver(uid),enumerable:false});
