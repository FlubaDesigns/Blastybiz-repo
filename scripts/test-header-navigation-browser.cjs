'use strict';
// Actual shared header/CSS, synthetic auth states, and local assets only.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const css=fs.readFileSync('public/global-style.css','utf8');
const header=fs.readFileSync('public/blastybiz-header.html','utf8');
const menu=fs.readFileSync('public/blastybiz-menu.js','utf8');
const controls=menu.slice(menu.indexOf('window.toggleMenu ='),menu.indexOf('// Measure the real rendered header height'));
const widths=[390,767,768,980,1024,1165,1180,1440];
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:980,height:900}});
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin==='https://header.fixture.test'&&url.pathname.startsWith('/img/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="100"><rect width="1000" height="100" fill="#00c853"/></svg>'});
   return route.abort('blockedbyclient');
  });
  let scenarios=0;
  for(const width of widths)for(const state of ['signed-out','signed-in','admin']){
   await page.setViewportSize({width,height:900});
   await page.setContent('<!doctype html><html><head><base href="https://header.fixture.test/"><style>'+css+'</style></head><body class="has-site-header home-page '+(state==='signed-out'?'':'logged-in')+'">'+header+'<main id="fixture-content">Unchanged page content</main></body></html>');
   await page.addScriptTag({content:controls});
   await page.evaluate(state=>{
    if(state==='admin')for(const id of ['header__nav-admin','header__nav-testconsole','header__mobile-admin','header__mobile-testconsole'])document.getElementById(id).style.display='';
    document.querySelectorAll('a').forEach(a=>a.addEventListener('click',e=>e.preventDefault()));
   },state);
   await page.locator('.header__logo img').evaluateAll(imgs=>Promise.all(imgs.map(img=>img.decode())));
   const metrics=await page.evaluate(()=>{
    const nav=document.querySelector('.header__nav'),row=document.querySelector('.header__nav-row');
    const visible=el=>getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>0;
    const links=[...nav.children].filter(el=>el.matches('.header__nav-link,.header__nav-cta')&&visible(el));
    return {rootWidth:document.documentElement.scrollWidth,width:innerWidth,navLeft:nav.getBoundingClientRect().left,navRight:nav.getBoundingClientRect().right,rowRight:row.getBoundingClientRect().right,scrollWidth:nav.scrollWidth,clientWidth:nav.clientWidth,hamburger:visible(document.getElementById('header__hamburger-btn')),links:links.map(el=>{
     const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);
     return {text:el.textContent.trim(),lines:range.getClientRects().length,center:r.top+r.height/2,left:r.left,right:r.right,whiteSpace:getComputedStyle(el).whiteSpace,shrink:getComputedStyle(el).flexShrink};
    })};
   });
   assert(metrics.rootWidth<=width+1,`${width}/${state}: header must not expand root scroll width`);
   assert(metrics.navLeft>=0&&metrics.navRight<=metrics.rowRight+1,`${width}/${state}: nav overflow stays contained`);
   if(width<768){
    assert(metrics.hamburger&&metrics.links.length===0,`${width}/${state}: existing mobile breakpoint retained`);
    await page.click('#header__hamburger-btn');assert(await page.locator('#header__mobile-menu').evaluate(el=>el.classList.contains('open')));
    await page.locator('.header__mobile-link').filter({hasText:'How It Works'}).click();
    assert(!await page.locator('#header__mobile-menu').evaluate(el=>el.classList.contains('open')),'mobile link closes menu');
    await page.click('#header__hamburger-btn');await page.click('#header__hamburger-btn');
    assert(!await page.locator('#header__mobile-menu').evaluate(el=>el.classList.contains('open')),'repeated hamburger toggles remain functional');
   }else{
    assert(!metrics.hamburger&&metrics.links.length>0);
    assert(metrics.links.some(l=>l.text==='How It Works'));
    assert.equal(metrics.links.some(l=>l.text==='Profile'),state!=='signed-out');
    assert.equal(metrics.links.some(l=>l.text==='Admin'),state==='admin');
    for(const l of metrics.links)assert(l.lines===1&&l.whiteSpace==='nowrap'&&l.shrink==='0',`${width}/${state}: ${l.text} stays on one line`);
    const centers=metrics.links.map(l=>l.center);assert(Math.max(...centers)-Math.min(...centers)<1,'all nav labels are vertically centered');
    for(let i=1;i<metrics.links.length;i++)assert(Math.abs(metrics.links[i].left-metrics.links[i-1].right-16)<1,'canonical nav gap remains even');
    const reachable=await page.evaluate(async()=>{
     const nav=document.querySelector('.header__nav'),links=[...nav.children].filter(el=>el.matches('.header__nav-link,.header__nav-cta')&&getComputedStyle(el).display!=='none');
     nav.scrollLeft=0;const first=links[0].getBoundingClientRect().left>=nav.getBoundingClientRect().left-1;
     nav.scrollLeft=nav.scrollWidth;const last=links.at(-1).getBoundingClientRect().right<=nav.getBoundingClientRect().right+1;
     nav.scrollLeft=0;links.at(-1).focus();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const focused=links.at(-1).getBoundingClientRect().right<=nav.getBoundingClientRect().right+1;
     return {first,last,focused,pageX:scrollX,navWidth:nav.clientWidth,scrollLeft:nav.scrollLeft,navRight:nav.getBoundingClientRect().right,lastRight:links.at(-1).getBoundingClientRect().right};
    });
    assert(reachable.first&&reachable.last&&reachable.focused&&reachable.pageX===0,`${width}/${state}: first/last links remain scrollable and keyboard-reachable without page scrolling: ${JSON.stringify(reachable)}`);
    if(width===768&&state==='admin')assert(metrics.scrollWidth>metrics.clientWidth,'crowded desktop navigation uses its own horizontal scroll');
   }
   scenarios++;
  }
  console.log(`PASS shared header Chromium: ${scenarios} viewport/auth scenarios, single-line labels, alignment, contained overflow, keyboard reachability and mobile menu.`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
