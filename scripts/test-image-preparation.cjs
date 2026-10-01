'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require(process.env.CANVAS_PATH||'@napi-rs/canvas');
const html=fs.readFileSync('public/BlastyBiz.html','utf8');
const code=html.slice(html.indexOf('  async function _bbImageType'),html.indexOf('  // ── Photo upload'));
let mode='normal',released=0,conversions=0;
const c={Blob,Uint8Array,DataView,atob,setTimeout,clearTimeout,console,
 createImageBitmap:async blob=>{if(blob.type==='image/heic')throw Error('No native HEIC decoder');const img=await loadImage(Buffer.from(await blob.arrayBuffer()));img.close=()=>released++;return img;},
 document:{createElement:tag=>{assert.equal(tag,'canvas');const canvas=createCanvas(1,1),encode=canvas.toBlob.bind(canvas);canvas.toBlob=(cb,type,q)=>{if(mode==='null')cb(null);else if(mode==='throw')throw Error('encoder');else if(mode==='stall')return;else encode(cb,type,q);};return canvas;}},
 Image:class {set src(v){if(v)queueMicrotask(()=>this.onerror?.());}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}
};c.window=c;c._heic2any=async()=>{conversions++;throw Error('Should not convert JPEG');};vm.createContext(c);vm.runInContext(code,c);
(async()=>{
 const large=createCanvas(4000,3000),ctx=large.getContext('2d'),data=ctx.createImageData(4000,3000);let seed=7;
 for(let i=0;i<data.data.length;i+=4){for(let n=0;n<3;n++){seed=(Math.imul(seed,1664525)+1013904223)|0;data.data[i+n]=seed>>>24;}data.data[i+3]=255;}
 ctx.putImageData(data,0,0);const bytes=large.toBuffer('image/jpeg',100);assert(bytes.length>5*1024*1024);
 const prepared=await c.compressImage(new Blob([bytes],{type:'image/heic'}));assert.equal(conversions,0,'JPEG mislabeled HEIC must use native decoding');assert.equal(prepared.type,'image/jpeg');assert(prepared.size<4.9*1024*1024);
 const resized=await loadImage(Buffer.from(await prepared.arrayBuffer()));assert.equal(resized.width,1200);assert.equal(resized.height,900);
 const small=createCanvas(100,60);small.getContext('2d').fillRect(0,0,20,20);
 for(const type of ['image/png','image/webp']){const output=await c.compressImage(new Blob([small.toBuffer(type)],{type:'application/octet-stream'}));const decoded=await loadImage(Buffer.from(await output.arrayBuffer()));assert.equal(decoded.width,100);assert.equal(decoded.height,60);}
 const file=new Blob([small.toBuffer('image/png')],{type:'image/png'});
 for(mode of ['null','throw','stall']){const output=await c.compressImage(file);assert(output.size>0&&output.type==='image/jpeg',mode+' toBlob fallback produces JPEG');await loadImage(Buffer.from(await output.arrayBuffer()));}
 mode='normal';await assert.rejects(c.compressImage(new Blob(['not an image'])),/Choose a JPEG/);
 const nativeDecode=c.createImageBitmap;c.createImageBitmap=async()=>{throw Error('Decode failed');};
 await assert.rejects(c.compressImage(new Blob([Buffer.from([255,216,255,1,2,3])])),/could not open/);c.createImageBitmap=nativeDecode;
 assert.equal(released,6,'decoded native images released after encoding');
 // HEIC uses conversion only when native decode fails; a readable native HEIC bypasses it.
 const heic=new Blob([Buffer.from([0,0,0,12,...Buffer.from('ftypheic')])],{type:'image/heic'});
 c._heic2any=async()=>{conversions++;return file;};await c.compressImage(heic);assert.equal(conversions,1);
 const digest=crypto.createHash('sha384').update(fs.readFileSync('public/vendor/heic2any-0.0.4.min.js')).digest('base64');assert(code.includes('sha384-'+digest),'self-hosted decoder matches pinned integrity');
 console.log(`PASS real image preparation: ${(bytes.length/1048576).toFixed(1)} MiB / 12 MP JPEG -> ${(prepared.size/1024).toFixed(0)} KiB / 1200x900; PNG, WebP, wrong MIME, null/throw/stalled encoder, corrupt bytes, HEIC fallback, resource release and vendor integrity.`);
})().catch(e=>{console.error(e);process.exitCode=1});
