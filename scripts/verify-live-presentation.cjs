'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
async function checkPage(page,label){
 for(const width of [320,384,430,1280]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,label+' document bounds '+width);
   assert.deepEqual(await page.locator('main .card,main .stat,.main .card').evaluateAll(es=>es.filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1;}).map(e=>e.id||e.className)),[],label+' card bounds '+width);
   for(const table of await page.locator('.table-scroll:visible').all()){
     assert(await table.evaluate(el=>{el.scrollLeft=el.scrollWidth;const cells=el.querySelectorAll('tr:last-child > *'),last=cells[cells.length-1];if(!last)return true;const c=last.getBoundingClientRect(),r=el.getBoundingClientRect();const fits=c.right<=r.right+2;el.scrollLeft=0;return fits;}),label+' final table column reachable '+width);
   }
   const menu=page.locator('.bb-more:visible').first();
   if(await menu.count()){
     const trigger=menu.locator(':scope > summary');await trigger.click();const box=await menu.locator('.bb-more-list').boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width+1,label+' menu bounds');
     const icon=await trigger.boundingBox();assert(icon.width<=40&&icon.height<=40,label+' normal three dots');await page.keyboard.press('Escape');assert.equal(await menu.evaluate(e=>e.open),false);
   }
   if([384,1280].includes(width)){for(const img of await page.locator('img[srcset]:visible').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(el=>el.decode());}await page.evaluate(()=>scrollTo(0,0));fs.mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/presentation-live-'+label+'-'+width+'.png',fullPage:true});}
 }
}
async function assets(origin){
 const rows=require('./presentation-images.json'),evidence=[];
 for(const row of rows)for(const variant of row.variants){
   const response=await fetch(origin+'/'+variant.path+'?verify='+Date.now(),{signal:AbortSignal.timeout(30000)});assert(response.ok);assert(response.headers.get('content-type')?.includes('image/webp'));
   const body=Buffer.from(await response.arrayBuffer()),local=fs.readFileSync('public/'+variant.path);assert(body.equals(local),'Exact optimized live image '+variant.path);
   evidence.push({path:variant.path,bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex')});
 }
 fs.mkdirSync('test-artifacts',{recursive:true});fs.writeFileSync('test-artifacts/presentation-live-images.json',JSON.stringify(evidence,null,2));
 console.log('PASS LIVE presentation artwork: exact served bytes for all '+evidence.length+' responsive WebP assets.');
}
module.exports={checkPage,assets};
