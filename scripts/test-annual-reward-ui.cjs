'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const html=fs.readFileSync('public/BlastyBiz-Rewards.html','utf8');
const source=fs.readFileSync('public/annual-reward.js','utf8').replace(/^import .*;\n/gm,'');
const selection={businessId:'business',imageId:'',color:'Black',size:'M',graphicChoice:'qr-only'};
const product={name:'Canonical title',description:'Live catalog description',availableColors:['Black','White'],availableVariants:[{color:'Black',size:'M'},{color:'White',size:'L'}]};
const preview={claimId:'claim',previewId:'preview',proofId:'proof-1',status:'ready',mockupUrl:'https://preview.test/shirt.png',websiteUrl:'https://business.test',color:'Black',size:'M',graphicChoice:'qr-only'};
async function fixture(owner='owner',initial={eligible:true,selection,product,preview,approved:false,terms:'One shirt per account.'}){
 const dom=new JSDOM(html,{url:'https://blastybiz.com/BlastyBiz-Rewards?ownerUid='+owner,runScripts:'outside-only'}),w=dom.window,calls=[];
 let state=structuredClone(initial),authenticate;
 w.auth={};w.db={};w.onAuthStateChanged=(_,fn)=>authenticate=fn;
 w.collection=(...args)=>args;
 w.getDocsFromServer=async args=>({docs:args.at(-1)==='businesses'?[{id:'business',data:()=>({businessName:'My business'})}]:[]});
 w.uploadBusinessLogo=async()=>{throw Error('No upload in this fixture');};
 w.fetch=async(url,request)=>{
  assert(url.endsWith('/manageQrReward'));assert.equal(request.headers.Authorization,'Bearer fixture-token');
  const body=JSON.parse(request.body);calls.push(body);
  if(body.action==='approve'){state={...state,approved:true,shipping:body.shipping,preview:{...preview,status:'ordered',orderId:'order'}};}
  return {ok:true,json:async()=>structuredClone(state)};
 };
 w.eval(source);await authenticate({uid:'owner',emailVerified:true,getIdToken:async()=>'fixture-token'});
 return {w,dom,calls,el:id=>w.document.getElementById('reward-'+id),set:v=>state=structuredClone(v),tick:()=>new Promise(r=>setTimeout(r,10))};
}
(async()=>{
 const f=await fixture();assert.equal(f.el('title').textContent,product.name);assert.equal(f.el('preview').hidden,false);assert(f.el('approve').disabled);
 f.el('consent').checked=true;f.el('consent').dispatchEvent(new f.w.Event('change'));assert(!f.el('approve').disabled);
 f.el('color').value='White';f.el('color').dispatchEvent(new f.w.Event('change'));assert(f.el('preview').hidden);assert(f.el('approve').disabled);assert(!f.el('consent').checked);assert.equal(f.el('size').options.length,2);assert.equal(f.el('size').options[1].value,'L');
 f.el('refresh').click();await f.tick();assert.equal(f.el('color').value,'Black');assert.equal(f.el('size').value,'M');
 for(const [key,value]of Object.entries({name:'Owner',address1:'Street',city:'Town',region:'FL',postalCode:'12345',country:'US'}))f.el('billing-'+key).value=value;
 assert(f.el('shipping-fields').hidden);assert(f.el('shipping-fields').disabled);
 f.el('consent').checked=true;f.el('consent').dispatchEvent(new f.w.Event('change'));
 f.el('billing-address1').dispatchEvent(new f.w.Event('input'));assert(!f.el('consent').checked);assert(f.el('approve').disabled);assert(!f.el('preview').hidden);
 f.el('consent').checked=true;f.el('consent').dispatchEvent(new f.w.Event('change'));
 f.el('shipping').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await f.tick();
 assert.equal(f.calls.filter(c=>c.action==='approve').length,1);assert.equal(f.calls.at(-1).previewId,'preview');assert.equal(f.calls.at(-1).proofId,'proof-1');assert.equal(f.calls.at(-1).shipping.address1,'Street');assert(f.el('billing-fields').hidden);assert(!f.el('shipping-fields').hidden);assert.equal(f.el('address1').value,'Street');assert(f.el('approve').disabled);assert(f.el('shipping-fields').disabled);
 f.set({eligible:true,approved:true,selection,product,preview:{...preview,status:'shipped',orderId:'order',tracking:{url:'https://tracking.test/one'}},shipping:{name:'Owner'}});f.el('refresh').click();await f.tick();assert(!f.el('tracking').hidden);assert.equal(f.el('tracking').href,'https://tracking.test/one');f.dom.window.close();
 const separate=await fixture('owner',{eligible:true,selection,product,preview,approved:false,billingAddress:{name:'Buyer',address1:'Billing street',city:'Town',region:'FL',postalCode:'12345',country:'US'}});
 assert.equal(separate.el('billing-address1').value,'Billing street');separate.el('same-address').checked=false;separate.el('same-address').dispatchEvent(new separate.w.Event('change'));
 assert(!separate.el('shipping-fields').hidden);assert(!separate.el('shipping-fields').disabled);assert(!separate.el('consent').checked);
 for(const [key,value]of Object.entries({name:'Recipient',address1:'Shipping street',city:'Town',region:'FL',postalCode:'54321',country:'US'}))separate.el(key).value=value;
 separate.el('consent').checked=true;separate.el('consent').dispatchEvent(new separate.w.Event('change'));separate.el('shipping').dispatchEvent(new separate.w.Event('submit',{bubbles:true,cancelable:true}));await separate.tick();
 assert.equal(separate.calls.at(-1).shipping.address1,'Shipping street');assert.equal(separate.calls.at(-1).shipping.name,'Recipient');assert(!('billingAddress' in separate.calls.at(-1)));separate.dom.window.close();
 const customSelection={...selection,graphicChoice:'full',imageId:'',textColorMode:'dark',textColor:null};
 const customPreview={...preview,graphicChoice:'full',textColorMode:'dark',warnings:['This text color may be difficult to read.']};
 const custom=await fixture('owner',{eligible:true,selection:customSelection,product,preview:customPreview,approved:false});
 assert.equal(custom.el('text-mode').value,'dark');assert.match(custom.el('contrast-warnings').textContent,/difficult to read/);
 custom.el('consent').checked=true;custom.el('text-mode').value='light';custom.el('text-mode').dispatchEvent(new custom.w.Event('change'));
 assert(!custom.el('consent').checked);assert(custom.el('approve').disabled);assert(custom.el('preview').hidden);
 custom.dom.window.close();
 const missing=await fixture();missing.el('consent').checked=true;missing.el('consent').dispatchEvent(new missing.w.Event('change'));missing.el('shipping').dispatchEvent(new missing.w.Event('submit',{bubbles:true,cancelable:true}));await missing.tick();assert.equal(missing.calls.filter(c=>c.action==='approve').length,0);missing.dom.window.close();
 const wrong=await fixture('another-owner');assert.equal(wrong.calls.length,0);assert.match(wrong.el('error').textContent,/account that received/);wrong.dom.window.close();
 const no=await fixture('owner',{eligible:false,message:'Annual Pro only'});assert(no.el('content').hidden);assert(!no.el('upgrade').hidden);assert.equal(no.el('message').textContent,'Annual Pro only');no.dom.window.close();
 const d=new JSDOM(html).window.document;for(const control of d.querySelectorAll('input,select'))assert(control.id&&d.querySelector('label[for="'+control.id+'"]')||control.closest('label'),'Every input has a label');
 assert(html.includes('auth-guard.js'));assert(!html.includes('psk-'));
 const auth=fs.readFileSync('public/auth-return.js','utf8').replace(/^export /gm,'');const context={URLSearchParams};require('node:vm').createContext(context);require('node:vm').runInContext(auth+';globalThis.parse=parseAuthReturn;globalThis.restore=restoreAuthReturn;',context);
 assert.equal(context.parse('/BlastyBiz-Rewards','?ownerUid=owner').page,'BlastyBiz-Rewards.html');assert.equal(context.parse('/BlastyBiz-Rewards','?ownerUid=../bad'),null);assert.equal(context.parse('//evil.test',''),null);
 console.log('PASS reward page: exact preview consent, variant invalidation, saved claim, shipping lock, tracking, owner-bound email return and nonqualifying account.');
})().catch(e=>{console.error(e);process.exitCode=1;});
