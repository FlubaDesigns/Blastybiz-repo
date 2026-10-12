'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createFlubaProviderReader}=require('../functions/lib/fluba-provider-keys');
const reply=(value,version)=>new Response(JSON.stringify({name:'projects/flubadesigns-25482/secrets/GEMINI_API_KEY/versions/'+version,payload:{data:Buffer.from(value).toString('base64')}}));
test('uses only the central vault, refreshes rotation and fails closed after revoked access',async()=>{
 const prior=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='revoked-local-test-fixture';
 let now=0,calls=0;const request=async(url,init)=>{assert.equal(url,'https://secretmanager.googleapis.com/v1/projects/flubadesigns-25482/secrets/GEMINI_API_KEY/versions/latest:access');assert.equal(init.redirect,'error');calls++;return calls===1?reply('central-first-test-fixture','1'):calls===2?reply('central-second-test-fixture','2'):new Response('',{status:403});};
 try{
 const reader=createFlubaProviderReader(async()=> 'fixture-token',request,()=>now);
 assert.deepEqual(await Promise.all([reader.read('GEMINI_API_KEY'),reader.read('GEMINI_API_KEY')]),['central-first-test-fixture','central-first-test-fixture']);assert.equal(calls,1);
 now=60001;assert.equal(await reader.read('GEMINI_API_KEY'),'central-second-test-fixture');
 now=120002;await assert.rejects(reader.read('GEMINI_API_KEY'),/403/);assert.deepEqual(reader.status(),{});
 await assert.rejects(reader.read('UNRELATED_SECRET'),/Unsupported/);assert.equal(calls,3);
 }finally{if(prior===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=prior;}
});
