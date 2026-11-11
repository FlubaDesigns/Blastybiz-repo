#!/usr/bin/env node
'use strict';
// Generated facts and crawl metadata. Edit their authority, then run this file.
const fs=require('node:fs'),path=require('node:path');
const {ORIGIN,isPublic,canonical}=require('./public-site.cjs');
const authority=require('../functions/lib/platforms');
const root=path.resolve(__dirname,'../public'),check=process.argv.includes('--check');
const platforms=authority.PLATFORM_DEFAULTS.filter(p=>p.enabled);
const auto=platforms.filter(p=>p.deliveryMode==='auto'),manual=platforms.filter(p=>p.deliveryMode!=='auto');
const names=new Intl.ListFormat('en',{style:'long',type:'conjunction'}).format(auto.map(p=>p.name));
const delivery=`Auto-post to eligible connected ${names} accounts. Other destinations use copy-and-paste text you publish yourself.`;
const copy={
 delivery,
 'home-intro':`Write it once — AI adapts it for every surface. Auto-post to connected ${names} accounts. Copy and paste your prepared text into the other ${manual.length} supported destinations.`,
 'auto-count':`${auto.length} auto-post platforms`, 'auto-names':names+'.',
 'manual-count':`${manual.length} manual destinations`,
 'home-step':`Auto-post to ${names} when connected. For the other ${manual.length} destinations, copy your prepared text and paste it yourself.`,
 counts:`${auto.length} auto-post platforms when connected · ${manual.length} copy-and-paste destinations`,
 'google-limit':`Google Business Profile update posts support up to ${authority.byId.google.doc.maxChars.toLocaleString('en-US')} characters. Keep your offer and next step easy to scan.`,
 'plan-cards':`<div class="row"><div class="layout__split-3">
      <div class="plat-plan-card"><div class="plat-plan-name">Free</div><p>Try the writing and review workflow with the account allowance shown in the app.</p><a href="BlastyBiz-Plan-Free.html" class="plat-plan-link">See Free Plan &rarr;</a></div>
      <div class="plat-plan-card plat-plan-card--featured"><div class="plat-plan-name">Pro</div><p>Review the current AI allowance, business limits, and price before choosing your plan.</p><a href="BlastyBiz-Plan-Pro.html" class="plat-plan-link">See Pro Plan &rarr;</a></div>
      <div class="plat-plan-card"><div class="plat-plan-name">Agency</div><p>Manage multiple businesses under one login. Current limits and prices are shown in the app.</p><a href="BlastyBiz-Plan-Agency.html" class="plat-plan-link">See Agency Plan &rarr;</a></div>
    </div></div>`
};
function output(file,text){const target=path.join(root,file);if(check){if(fs.readFileSync(target,'utf8')!==text)throw Error('Stale public facts/metadata: '+file+'; run node scripts/sync-public-content.cjs');}else fs.writeFileSync(target,text);}
const files=fs.readdirSync(root).filter(f=>f.endsWith('.html')).sort();
for(const file of files){
 let text=fs.readFileSync(path.join(root,file),'utf8');
 text=text.replace(/<!-- public-copy:([a-z-]+):start -->[\s\S]*?<!-- public-copy:\1:end -->/g,(all,key)=>{
   let value=copy[key];
   if(key==='platform-badge'){
     const p=authority.byId[file.replace('BlastyBiz-Platform-','').replace('.html','')];if(!p)throw Error('Unknown platform '+file);
     const automatic=p.deliveryMode==='auto';value=`<div class="plat-badge ${automatic?'auto':'manual'}">${automatic?'Auto-post · eligible connected accounts':'Copy &amp; paste · you publish'}</div>`;
   }
   if(value===undefined)throw Error('Unknown public copy '+key);
   return `<!-- public-copy:${key}:start -->${value}<!-- public-copy:${key}:end -->`;
 });
 if(/<head[\s>]/i.test(text)){
   text=text.replace(/\s*<!-- public-site:start -->[\s\S]*?<!-- public-site:end -->/g,'').replace(/\s*<link[^>]*rel=["']canonical["'][^>]*>/gi,'').replace(/\s*<meta[^>]*name=["']robots["'][^>]*>/gi,'');
   const metadata=isPublic(file)?`<link rel="canonical" href="${canonical(file)}"/>`:'<meta name="robots" content="noindex, nofollow"/>';
   text=text.replace(/\s*<\/head>/i,`\n<!-- public-site:start -->\n${metadata}\n<!-- public-site:end -->\n</head>`);
 }
 output(file,text);
}
const publicFiles=files.filter(isPublic);
output('sitemap.xml','<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+publicFiles.map(f=>`  <url><loc>${canonical(f)}</loc></url>`).join('\n')+'\n</urlset>\n');
// Prefix rules cover both clean routes and the legacy .html URLs (including query strings).
// Static noindex metadata provides a second signal; neither rule replaces authentication.
output('robots.txt','User-agent: *\n\n# Private, sign-in and internal pages (clean and .html forms)\n'+files.filter(f=>!isPublic(f)&&f!=='index.html').flatMap(f=>{const clean='/'+f.replace(/\.html$/,'');return [clean+'$',clean+'?*','/'+f+'$','/'+f+'?*'].map(route=>'Disallow: '+route);}).join('\n')+'\n\nSitemap: '+ORIGIN+'/sitemap.xml\n');
console.log((check?'Checked':'Generated')+' shared public facts, canonical links, sitemap and crawl rules.');
module.exports={copy};
