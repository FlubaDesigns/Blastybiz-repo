'use strict';
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const {providerId}=require('./provider-api');
const hash=value=>createHash('sha256').update(value).digest('hex');
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function matches(secret,expected) {
  return typeof secret==='string'&&/^[a-f0-9]{64}$/.test(secret)&&validHash(expected)&&timingSafeEqual(Buffer.from(hash(secret)),Buffer.from(expected));
}
const fail=()=>{throw Object.assign(Error('This connection must be completed in the browser tab that started it. Please reconnect.'),{httpStatus:403});};
function requireVerifier(p,verifier){if(!p||!matches(verifier,p.verifierHash))fail();}
const millis=v=>v?.toMillis?.()??(v instanceof Date?v.getTime():0);
const cookieName=state=>'__Secure-bb-oauth-'+state;
function createOAuthBinding({db,clock=Date.now}) {
 const ref=state=>{if(!providerId(state))fail();return db.collection('oauthNonces').doc(state);};
 async function start(state,verifier,origin) {
  const r=ref(state),cookie=randomBytes(32).toString('hex');
  const p=await db.runTransaction(async tx=>{
   const p=(await tx.get(r)).data();
   if(!p||p.phase!=='start'||millis(p.expiresAt)<=clock()||!origin||p.appOrigin!==origin)fail();
   requireVerifier(p,verifier);
   tx.update(r,{phase:'oauth',cookieHash:hash(cookie)});return p;
  });
  return {url:p.authorizationUrl,cookie:`${cookieName(state)}=${cookie}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`};
 }
 async function consume(state,platform,cookies='') {
  const r=ref(state);
  const entries=typeof cookies==='string'?cookies.split(';').map(v=>v.trim().split('=')):[];
  const values=entries.filter(([key])=>key===cookieName(state));
  return db.runTransaction(async tx=>{
   const p=(await tx.get(r)).data();
   if(!p||p.phase!=='oauth'||p.platform!==platform||millis(p.expiresAt)<=clock()||values.length!==1||!matches(values[0][1],p.cookieHash))fail();
   tx.delete(r);return p;
  });
 }
 return {start,consume};
}
module.exports={createOAuthBinding,hash,validHash,requireVerifier,cookieName};
