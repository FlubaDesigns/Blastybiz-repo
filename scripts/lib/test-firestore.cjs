'use strict';
const clone=v=>structuredClone(v);
const field=(d,k)=>k.split('.').reduce((v,p)=>v?.[p],d);
const FieldValue={serverTimestamp:()=>({stamp:Date.now()}),delete:()=>({op:'delete'}),increment:n=>({op:'increment',n})};
function apply(data,patch){
  for(const [key,v] of Object.entries(patch)){
    const parts=key.split('.');let obj=data;
    for(const p of parts.slice(0,-1))obj=obj[p] ||= {};
    const k=parts.at(-1);
    if(v?.op==='delete')delete obj[k];else if(v?.op==='increment')obj[k]=(obj[k]||0)+v.n;else obj[k]=clone(v);
  }return data;
}
function database(seed={}){
  let rows=new Map(Object.entries(seed).map(([k,v])=>[k,clone(v)])),lock=Promise.resolve(),fail=false,beforeCommit=null;
  const reads=[],writes=[];
  class Doc{
    constructor(path){this.path=path;this.id=path.split('/').at(-1);}
    collection(name){return new Query(this.path+'/'+name);}
    async get(){return snapshot(this);}
    async set(data,options){const ops=[['set',this,data,options]];if(beforeCommit)await beforeCommit(ops);commit(ops);}
    async update(data){const ops=[['update',this,data]];if(beforeCommit)await beforeCommit(ops);commit(ops);}
    async delete(){const ops=[['delete',this]];if(beforeCommit)await beforeCommit(ops);commit(ops);}
  }
  function revive(value){if(value&&typeof value==='object'){if(typeof value.stamp==='number')Object.defineProperty(value,'toMillis',{value:()=>value.stamp});for(const v of Object.values(value))revive(v);}return value;}
  function snapshot(ref){const value=rows.get(ref.path);return {id:ref.id,ref,exists:value!==undefined,data:()=>value===undefined?undefined:revive(clone(value))};}
  class Query{
    constructor(path,group=false,filters=[],orders=[],limit=Infinity,cursor=null){Object.assign(this,{path,group,filters,orders,cap:limit,cursor});}
    copy(p){return Object.assign(new Query(this.path,this.group,[...this.filters],[...this.orders],this.cap,this.cursor),p);}
    doc(id){return new Doc(this.path+'/'+id);}
    where(k,op,v){return this.copy({filters:[...this.filters,[k,op,v]]});}
    orderBy(k,d='asc'){return this.copy({orders:[...this.orders,[k,d]]});}
    limit(n){return this.copy({cap:n});}
    startAfter(...args){return this.copy({cursor:args.length===1&&args[0].ref?this.orders.map(([k])=>k==='__name__'?args[0].ref.path:field(args[0].data(),k)):args.map(x=>x?.path||x)});}
    async get(){
      reads.push(this);let found=[...rows.keys()].filter(p=>this.group?p.split('/').at(-2)===this.path:p.slice(0,p.lastIndexOf('/'))===this.path).map(p=>snapshot(new Doc(p)));
      found=found.filter(d=>this.filters.every(([k,op,v])=>{const a=field(d.data(),k);return op==='=='?a===v:op==='<='?a!==undefined&&a<=v:op==='>='?a!==undefined&&a>=v:false;}));
      const orders=this.orders.length?this.orders:[['__name__','asc']];
      const values=d=>orders.map(([k])=>k==='__name__'?d.ref.path:field(d.data(),k));
      const cmp=(a,b)=>{for(let i=0;i<orders.length;i++){if(a[i]===b[i])continue;return (a[i]<b[i]?-1:1)*(orders[i][1]==='desc'?-1:1);}return 0;};
      found.sort((a,b)=>cmp(values(a),values(b)));if(this.cursor)found=found.filter(d=>cmp(values(d),this.cursor)>0);
      const docs=found.slice(0,this.cap);return {docs,size:docs.length,empty:!docs.length};
    }
  }
  function commit(ops){if(fail){fail=false;throw Error('commit offline');}const next=new Map(rows);for(const [kind,ref,data,opts] of ops){
    if(kind==='delete')next.delete(ref.path);
    else{if(kind==='create'&&next.has(ref.path))throw Error('already exists');if(kind==='update'&&!next.has(ref.path))throw Error('not found');next.set(ref.path,apply((kind==='update'||opts?.merge)?clone(next.get(ref.path)||{}):{},data));}
  }rows=next;writes.push(...ops);}
  const db={collection:p=>new Query(p),collectionGroup:p=>new Query(p,true),doc:p=>new Doc(p),batch(){const ops=[];return {set:(...a)=>ops.push(['set',...a]),update:(...a)=>ops.push(['update',...a]),delete:(...a)=>ops.push(['delete',...a]),commit:async()=>commit(ops)};},runTransaction(fn){const result=lock.then(async()=>{const ops=[];const result=await fn({get:async ref=>{if(ops.length)throw Error('read after write');return ref.get();},set:(...a)=>ops.push(['set',...a]),create:(...a)=>ops.push(['create',...a]),update:(...a)=>ops.push(['update',...a]),delete:(...a)=>ops.push(['delete',...a])});if(beforeCommit)await beforeCommit(ops);commit(ops);return result;});lock=result.catch(()=>{});return result;}};
  return {db,reads,writes,beforeCommit(fn){beforeCommit=fn;},get:p=>clone(rows.get(p)),all:()=>Object.fromEntries(rows),failNext(){fail=true;}};
}
module.exports={database,admin:{firestore:{FieldValue,FieldPath:{documentId:()=>'__name__'}}}};
