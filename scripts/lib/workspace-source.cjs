'use strict';
// Source-oriented regression fixtures load the same external assets as the page.
// This is a test loader, not a second copy of the workspace implementation.
const fs=require('node:fs'),path=require('node:path');
const script=/<script\b([^>]*\bdata-workspace\b[^>]*)><\/script>/g;
function expand(html,read){return html.replace(script,(_,attrs)=>{
 const src=/\bsrc="([^"]+)"/.exec(attrs)[1].split('?')[0];
 return '<script'+(/type="module"/.test(attrs)?' type="module"':'')+'>\n'+read(src)+'\n</script>';
});}
async function expandAsync(html,read){
 const sources=[...html.matchAll(script)].map(m=>/\bsrc="([^"]+)"/.exec(m[1])[1].split('?')[0]);
 const data=new Map(await Promise.all(sources.map(async src=>[src,await read(src)])));
 return expand(html,src=>data.get(src));
}
function readFileSync(file,...args){
 const value=fs.readFileSync(file,...args);
 return path.basename(String(file))==='BlastyBiz.html'&&typeof value==='string'
  ?expand(value,src=>fs.readFileSync(path.join(path.dirname(String(file)),src),'utf8')):value;
}
module.exports={...fs,readFileSync,expand,expandAsync};
