'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.resolve('public'),images=require('./presentation-images.json');
const routes=['Home','Login','Start','CreateBiz','Dashboard','Account','Connect','BizContext','Businesses','Memory','Choose-Plan','About','Contact','Plan-Free','Plan-Pro','Plan-Agency','Platforms','Platform-facebook','Platform-nextdoor','Admin','Admin-Subscriptions','Admin-Platforms','Admin-Platform-Health','Admin-Moods','Admin-OnboardSteps','Admin-Operate','Admin-Users','Admin-Failed-Jobs','Admin-Queue-Manager','Admin-Emails','Preview','Trial','Intro','TestBlasty'];
const strip=html=>html.replace(/<script\b[\s\S]*?<\/script>/g,'');
async function run(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:384,height:900}});
 await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='presentation.test')return route.abort();
   let name=decodeURIComponent(url.pathname.slice(1));if(!path.extname(name))name+='.html';
   const file=path.join(root,name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.abort();
   const ext=path.extname(file),types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
   let body=fs.readFileSync(file);
   if(ext==='.html')body=strip(body.toString()).replace('<div id="header__inject"></div>','<div id="header__inject">'+strip(fs.readFileSync(root+'/blastybiz-header.html','utf8'))+'</div>');
   await route.fulfill({contentType:types[ext]||'application/octet-stream',body});
 });
 const report=[];fs.mkdirSync('test-artifacts',{recursive:true});
 for(const route of routes){
   await page.goto('https://presentation.test/BlastyBiz-'+route+'.html');
   await page.addStyleTag({content:'body{visibility:visible!important}.reveal{opacity:1!important;transform:none!important}'});
   await page.addScriptTag({content:fs.readFileSync(root+'/blastybiz-menu.js','utf8').split('function _revealAdminNav')[0]});
   if(route==='Admin')await page.evaluate(()=>{
     for(const id of ['admin-accounts-tbody','admin-all-accounts-tbody'])document.getElementById(id).innerHTML='<tr><td>Presentation fixture with a complete long business name</td><td>Agency</td><td>Active</td><td>Nov 11, 2026</td><td><a href="#users">Review account</a></td></tr>';
   });
   for(const width of [320,384,430,1280]){
     await page.setViewportSize({width,height:900});
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,route+' document overflow '+width);
     const bad=await page.locator('main .card,main .stat,.main .card').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').filter(n=>{const r=n.getBoundingClientRect();return r.left < -1||r.right>innerWidth+1;}).map(n=>n.id||n.className));
     assert.deepEqual(bad,[],route+' card bounds '+width);
     const menu=page.locator('.bb-more:visible').first();
     if(await menu.count()){
       const trigger=menu.locator('summary');await trigger.click();const box=await menu.locator('.bb-more-list').boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width+1,route+' menu bounds '+width);
       const icon=await trigger.boundingBox();assert(icon.width<=40&&icon.height<=40,'Normal three dots');await page.keyboard.press('Escape');assert.equal(await menu.evaluate(e=>e.open),false);
     }
     if(route==='Admin'&&width<600){
       const region=page.locator('#accounts-attention .table-scroll');assert(await region.evaluate(el=>{el.scrollLeft=el.scrollWidth;return el.scrollLeft>0;}),'Long table can scroll');
       const action=region.getByText('Review account'),a=await action.boundingBox(),r=await region.boundingBox();assert(a.x>=r.x&&a.x+a.width<=r.x+r.width+1,'Last table action reachable');
     }
     if([384,1280].includes(width)&&['Home','Account','Admin','Admin-Platforms','Admin-Moods','Platform-facebook','Connect','Login'].includes(route))await page.screenshot({path:'test-artifacts/presentation-'+route+'-'+width+'.png',fullPage:true});
   }
   if(route==='Platform-facebook'){
     assert.equal(await page.locator('#platform-memory').isVisible(),false);await page.getByLabel('Platform guide options',{exact:true}).click();await page.getByRole('button',{name:'How business memory works',exact:true}).click();assert(await page.locator('#platform-memory').isVisible(),'Optional explanation retained');
   }
   report.push(route);
 }
 // Decode the actual optimized assets and verify the browser chooses the phone
 // resource. No application requests or paid generation are permitted here.
 await page.setViewportSize({width:384,height:900});
 await page.setContent(images.map(i=>`<img src="https://presentation.test/${i.variants[1].path}" srcset="https://presentation.test/${i.variants[0].path} 480w, https://presentation.test/${i.variants[1].path} 896w" sizes="344px" width="344" alt="Compression check">`).join(''));
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 assert(await page.locator('img').evaluateAll(es=>es.every(e=>e.currentSrc.includes('-480.webp'))));
 fs.writeFileSync('test-artifacts/presentation-browser.json',JSON.stringify({routes:report,widths:[320,384,430,1280],imageBytes:{original:images.reduce((n,i)=>n+i.bytes,0),phone:images.reduce((n,i)=>n+i.variants[0].bytes,0)}},null,2));
 console.log('PASS presentation browser: '+routes.length+' public/app/admin shells, four explicit widths, normal menus, scrolling table actions and decoded responsive artwork. Fixture data only.');
 }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1});
