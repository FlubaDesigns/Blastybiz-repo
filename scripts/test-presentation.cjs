'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const baseline='4c7dda6a6d559e3ad748ef7714edb6c7c2e4cb30';
let controls=0,pages=0;
function actions(html){
 const doc=new JSDOM(html).window.document;
 return [...doc.querySelectorAll('a,button,input,select,textarea')].map(el=>JSON.stringify({tag:el.tagName,id:el.id,href:el.getAttribute('href'),name:el.getAttribute('name'),type:el.getAttribute('type'),click:el.getAttribute('onclick'),change:el.getAttribute('onchange'),input:el.getAttribute('oninput'),target:el.getAttribute('data-more-target'),options:el.tagName==='SELECT'?[...el.options].map(o=>o.value):undefined}));
}
for(const file of fs.readdirSync('public').filter(f=>f.endsWith('.html'))){
 const current=fs.readFileSync('public/'+file,'utf8');
 const old=cp.execFileSync('git',['show',baseline+':public/'+file],{encoding:'utf8',maxBuffer:4e6});
 const remaining=actions(current);
 for(let action of actions(old)){
  const control=JSON.parse(action);
  // Item 4 intentionally adds unknown/pending filters and derives API platforms
  // from the canonical delivery modes. Retain every other control attribute.
  if(file==='BlastyBiz-Admin-Platform-Health.html'&&control.tag==='SELECT'){
   if(control.id==='filter-status')control.options=['','expired','error','disconnected','pending','unknown'];
   if(control.id==='filter-platform')control.options=[''];
   action=JSON.stringify(control);
  }
  const i=remaining.indexOf(action);assert(i>=0,'Existing control retained: '+file+' '+action);remaining.splice(i,1);controls++;
 }
 const doc=new JSDOM(current).window.document;
 if(file==='BlastyBiz-Admin-Platform-Health.html'){
  const BBPlatforms=require('../public/platforms-authority.js');
  const start=current.indexOf("  document.getElementById('filter-platform').innerHTML=");
  const end=current.indexOf("  document.getElementById('btn-refresh').addEventListener",start);
  assert(start>=0&&end>start,'Canonical platform filter initializer exists');
  require('node:vm').runInNewContext(current.slice(start,end),{document:doc,BBPlatforms,escHtml:s=>s});
  assert.deepEqual([...doc.getElementById('filter-platform').options].map(o=>o.value),['',...BBPlatforms.records.filter(p=>p.deliveryMode==='auto').map(p=>p.id)],'Only canonical auto-post platforms offered');
 }
 for(const style of doc.querySelectorAll('head style'))assert.match(style.textContent,/^\s*body\s*\{\s*visibility\s*:\s*hidden\s*;?\s*\}\s*$/,'Only the fail-closed guard stays inline: '+file);
 if(/<head[\s>]/i.test(current))assert(doc.querySelector('link[href^="Buttons.css"]'),'Shared button owner: '+file);
 pages++;
}
const images=require('./presentation-images.json');
for(const image of images){assert.equal(fs.statSync('public/'+image.source).size,image.bytes);for(const v of image.variants){assert.equal(fs.statSync('public/'+v.path).size,v.bytes);assert(v.bytes<image.bytes/4);}}
const original=images.reduce((n,i)=>n+i.bytes,0),phone=images.reduce((n,i)=>n+i.variants[0].bytes,0);
assert(phone/original<.1);
assert(!/bb-style-(1c28b7a8|5d1cafe9|1fdd5485)/.test(fs.readFileSync('public/global-style.css','utf8')));
console.log(`PASS presentation: ${controls} existing controls preserved across ${pages} pages; page styles centralized; original artwork retained; phone illustrations ${phone}/${original} bytes.`);
