'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const authority=require('../functions/lib/platforms');
const {normalizeGoogleOverride,migrate}=require('./migrate-google-writing-guide.cjs');
const {database}=require('./lib/test-firestore.cjs');
test('browser, admin and generation use one platform rule owner',()=>{
 assert.equal(fs.readFileSync('public/platforms-authority.js','utf8'),fs.readFileSync('functions/lib/platforms.js','utf8'));
 assert.match(fs.readFileSync('public/BlastyBiz-Admin-Platforms.html','utf8'),/const WRITING_DEFAULTS = globalThis.BBPlatforms.PLATFORM_DOCS/);
 const base=authority.PLATFORM_DOCS.google;
 assert.equal(base.maxChars,1500);assert.match(base.format,/update post \(STANDARD\)/);
 const effective=authority.mergeWritingDoc(base,{maxChars:900,dos:'Use supplied facts\nKeep it local',imageRequired:true});
 assert.equal(effective.maxChars,900);assert.deepEqual(effective.dos,['Use supplied facts','Keep it local']);assert.equal(effective.images.required,true);
 assert.equal(effective.format,base.format);
});
test('historical default repair is exact, idempotent and preserves customization',async()=>{
 const original={maxChars:750,format:'Business description. Plain text only. No markdown, no links.',tone:'Our custom tone',dos:'Our own rule'};
 assert.deepEqual(normalizeGoogleOverride(original),{tone:'Our custom tone',dos:'Our own rule'});
 assert.deepEqual(normalizeGoogleOverride({maxChars:600,format:'Custom format'}),{maxChars:600,format:'Custom format'});
 const f=database({'settings/platformDocs':{google:original,facebook:{tone:'Other custom'}}});
 assert.equal((await migrate(f.db,false)).changed,true);assert.deepEqual(f.get('settings/platformDocs').google,original);
 await migrate(f.db,true);assert.equal((await migrate(f.db,true)).changed,false);assert.equal(f.get('settings/platformDocs').facebook.tone,'Other custom');
});
