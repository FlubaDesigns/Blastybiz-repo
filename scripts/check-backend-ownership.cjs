'use strict';
// Reuse the existing endpoint resolver. This inventory never infers that an
// endpoint without a page caller is unused: providers and workers also call us.
const fs=require('node:fs'),path=require('node:path');
const {collectReferences}=require('./check-cf-endpoints.cjs');
const root=path.resolve(__dirname,'..');
function inventory(){
 const barrel=fs.readFileSync(path.join(root,'functions/index.js'),'utf8');
 const modules=[...barrel.matchAll(/Object\.assign\(exports,\s*require\('(.+?)'\)\)/g)].map(m=>m[1]);
 if(!modules.length)throw Error('No backend modules resolved from the entry point');
 const functions=[];
 for(const module of modules){
  const file=path.join(root,'functions',module+'.js'),source=fs.readFileSync(file,'utf8');
  for(const m of source.matchAll(/exports\.(\w+)\s*=\s*(onRequest|onSchedule|onDocumentCreated|onDocumentUpdated|onDocumentWritten)\s*\(/g))functions.push({name:m[1],kind:m[2],module});
 }
 const names=new Set();for(const fn of functions){if(names.has(fn.name))throw Error('Duplicate backend entry point: '+fn.name);names.add(fn.name);}
 const refs=collectReferences();if(refs.unresolved.length)throw Error('Unresolved client endpoint calls: '+JSON.stringify(refs.unresolved));
 for(const name of refs.names.keys())if(!names.has(name))throw Error('Client calls missing backend: '+name);
 const retired=require('../deployment/retired-functions.json');
 if(retired.project!=='blastybiz-9523e'||retired.region!=='us-central1')throw Error('Invalid retirement target');
 const retiring=new Set();for(const fn of retired.functions){
  if(!/^[A-Za-z][A-Za-z0-9]+$/.test(fn.name)||!fn.expectedUpdateTime||retiring.has(fn.name))throw Error('Invalid retirement entry');
  retiring.add(fn.name);
  if(names.has(fn.name)||refs.names.has(fn.name))throw Error('Retired function still owns active code or a client call: '+fn.name);
 }
 return {functions:functions.sort((a,b)=>a.name.localeCompare(b.name)),clientEndpoints:[...refs.names.keys()].sort(),retired:[...retiring].sort(),unreferencedHttp:functions.filter(f=>f.kind==='onRequest'&&!refs.names.has(f.name)).map(f=>f.name),note:'Unreferenced HTTP functions need provider/operator review; never remove automatically.'};
}
if(require.main===module){try{console.log(JSON.stringify(inventory(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={inventory};
