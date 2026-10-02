'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function run() {
  const shared = fs.readFileSync('functions/lib/shared.js', 'utf8');
  const fetchCode = shared.slice(shared.indexOf('function _isPrivateAddress'), shared.indexOf('// ── classifyAiError'));
  let checks = 0;
  async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
  function fixture(pages) {
    const calls = [];
    const context = { URL, Buffer, AbortController, setTimeout, clearTimeout,
      require: () => ({ promises: { lookup: async host => [{address: host === 'private.example' ? '127.0.0.1' : '93.184.216.34'}] } }),
      fetch: async url => { calls.push(url); assert.ok(pages[url], 'unexpected fetch ' + url); return new Response(pages[url].body || '', {status:pages[url].status || 200, headers:pages[url].headers}); }
    };
    vm.runInNewContext(fetchCode, context);
    return { calls, fetch: context.safeFetchUrl };
  }
  const home = fs.readFileSync('public/BlastyBiz-Home.html', 'utf8');
  const index = fs.readFileSync('public/index.html', 'utf8');
  const pages = {
    'https://www.blastybiz.com': {status:301,headers:{location:'https://blastybiz.com/'}},
    'https://blastybiz.com': {body:index},
    'https://blastybiz.com/': {body:index},
    'https://blastybiz.com/BlastyBiz-Home.html': {status:301,headers:{location:'/BlastyBiz-Home'}},
    'https://blastybiz.com/BlastyBiz-Home': {body:home}
  };
  await test('real BlastyBiz root reaches real homepage through HTTP and HTML redirects', async () => {
    const f = fixture(pages);
    assert.equal(await f.fetch('https://www.blastybiz.com', {followHtmlRedirects:true}), home);
    assert.equal(f.calls.length, 4);
  });
  await test('existing fetch callers retain raw HTML behavior', async () => {
    const f = fixture(pages); assert.equal(await f.fetch('https://blastybiz.com'), index); assert.equal(f.calls.length, 1);
  });
  for (const target of ['https://private.example/secret','http://example.com','javascript:alert(1)']) {
    await test('unsafe meta refresh cannot fetch ' + target.split(':')[0], async () => {
      const f=fixture({'https://example.com':{body:`<META content="0; URL='${target}'" HTTP-EQUIV='refresh'>`}});
      await assert.rejects(() => f.fetch('https://example.com',{followHtmlRedirects:true}), e=>e.code==='SSRF_PRIVATE_IP'||e.code==='SSRF_NOT_HTTPS');
      assert.equal(f.calls.length,1);
    });
  }
  await test('HTML refresh loops stop at the shared redirect budget', async () => {
    const f=fixture({'https://example.com/':{body:'<meta http-equiv="refresh" content="0;url=/">'}});
    await assert.rejects(()=>f.fetch('https://example.com/',{followHtmlRedirects:true}),e=>e.code==='SSRF_TOO_MANY_REDIRECTS');
    assert.equal(f.calls.length,4);
  });
  await test('commented and scripted refresh tags are ignored', async () => {
    const body='<head><!-- <meta http-equiv="refresh" content="0;url=/bad"> --><script>"<meta http-equiv=refresh content=0;url=/bad>"</script></head><body>Business</body>';
    const f=fixture({'https://example.com':{body}});
    assert.equal(await f.fetch('https://example.com',{followHtmlRedirects:true}),body);
  });
  const ai=fs.readFileSync('functions/modules/ai.js','utf8');
  const handlerCode=ai.slice(ai.indexOf('exports.extractBizContext ='),ai.indexOf('// ── Admin platform-docs cache'));
  for (const input of ['blastybiz.com',' www.blastybiz.com ','http://blastybiz.com','https://blastybiz.com','//blastybiz.com']) {
    await test('authenticated extraction accepts '+input.trim(),async()=>{
      const f=fixture(pages), writes=[],prompts=[];
      const bizRef={get:async()=>({exists:true}),set:async(...a)=>writes.push(a)};
      const c={exports:{},onRequest:(opts,fn)=>fn,withAuth:fn=>fn,checkUidRateLimit:async()=>true,
        db:{collection:()=>({doc:()=>({collection:()=>({doc:()=>bizRef})})})},safeFetchUrl:f.fetch,
        reserveAiAction:async()=>{},loggedAI:async(uid,fn,body,prompt)=>{prompts.push(prompt);return {text:JSON.stringify({story:null,different:'One listing, many platforms.',awards:null,customer:'Local businesses.',other:null})};},
        admin:{firestore:{FieldValue:{serverTimestamp:()=>123}}},console,bbLog:()=>{}
      };
      vm.runInNewContext(handlerCode,c);
      const res={status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
      await c.exports.extractBizContext({body:{bizId:'business',sourceUrl:input}},res,{uid:'owner'});
      assert.ok(res.body.aiContext,JSON.stringify(res.body)); assert.equal(res.body.aiContext.awards,null);
      assert.match(prompts[0],/AI Social Media Posts for Local Businesses/);
      assert.ok(res.body.source.startsWith('https://'));
      assert.equal(writes.length,1); assert.equal(writes[0][0].aiContext,undefined,'draft content is not saved over owner story');
    });
  }
  const ui = fs.readFileSync('public/BlastyBiz.html', 'utf8');
  const saveCode = ui.slice(ui.indexOf('window.saveStory ='), ui.indexOf('async function _bbLoadLibraryDocs'));
  for (const fail of [false, true]) {
    await test(fail ? 'failed save keeps Story and all typed fields' : 'Save & Continue waits for persistence before opening Create', async () => {
      const fields=['story','different','awards','customer','other'];
      const elements=Object.fromEntries(fields.map(key=>['ctx-'+key,{value:key==='story'?' My business story ':'',style:{}}]));
      elements['story-btn-save']={textContent:'Save & Continue →',disabled:false};
      elements['story-save-status']={style:{}};
      let finish;
      const pending=new Promise((resolve,reject)=>{finish=fail?()=>reject(Error('offline')):resolve;});
      const writes=[],navigation=[];
      const c={window:{},activeBizId:'b',currentUser:{uid:'u'},db:{},document:{getElementById:id=>elements[id]},
        STORY_FIELDS:fields.map(key=>({key,id:'ctx-'+key})),doc:(...parts)=>parts,
        setDoc:async(...args)=>{writes.push(args);await pending;},showToast:()=>{},showTab:name=>navigation.push(name),setTimeout:()=>{}};
      vm.runInNewContext(saveCode,c);
      const saving=c.window.saveStory(true);
      assert.equal(elements['story-btn-save'].disabled,true); assert.equal(navigation.length,0);
      assert.equal(writes[0][1].aiContext.story,'My business story'); assert.equal(writes[0][2].merge,true);
      finish(); await saving;
      assert.deepEqual(navigation,fail?[]:['create']);
      assert.equal(elements['ctx-story'].value,' My business story ');
      assert.equal(elements['story-btn-save'].disabled,false);
      assert.equal(elements['story-btn-save'].textContent,'Save & Continue →');
    });
  }
  console.log(checks+' story extraction and navigation scenarios passed.');
}
module.exports = run;
if (require.main === module) run().catch(e=>{console.error(e);process.exitCode=1;});
