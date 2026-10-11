/* OAuth attempt secrets stay in this origin and browser tab, never in URLs. */
(function(root){
  'use strict';
  const key=state=>'bb-oauth-attempt:'+state;
  const valid=state=>typeof state==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(state);
  const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  function read(state) {
    if(!valid(state))throw Error('Invalid connection request. Please reconnect.');
    let value;try{value=JSON.parse(sessionStorage.getItem(key(state))||'null');}catch(e){}
    if(!value||value.expiresAt<=Date.now()||!/^[a-f0-9]{64}$/.test(value.verifier))throw Error('Return to the browser tab where you started this connection, or reconnect here.');
    return value.verifier;
  }
  let starting=false;
  async function begin(url,token) {
    if(starting)return;
    starting=true;
    try {
    const verifier=hex(crypto.getRandomValues(new Uint8Array(32)));
    const digest=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
    const endpoint=new URL(url);endpoint.searchParams.set('verifierHash',digest);
    const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+token}});
    const data=await response.json();
    if(!response.ok||!valid(data.state))throw Error(data.error||'Could not start connection.');
    const next=new URL(data.url);
    if(next.origin!==location.origin||next.pathname!=='/BlastyBiz-OAuth-Start.html'||next.searchParams.get('state')!==data.state)throw Error('Invalid connection destination.');
    sessionStorage.setItem(key(data.state),JSON.stringify({verifier,expiresAt:Date.now()+10*60*1000}));
    location.assign(next.href);
    }catch(e){starting=false;throw e;}
  }
  function clear(state){if(valid(state))sessionStorage.removeItem(key(state));}
  root.BBOAuth={begin,read,clear};
})(window);
