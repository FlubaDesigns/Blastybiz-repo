'use strict';
try {
  const state=new URLSearchParams(location.search).get('state');
  const verifier=window.BBOAuth.read(state);
  const form=document.createElement('form');
  form.method='POST';form.action='https://us-central1-blastybiz-9523e.cloudfunctions.net/oauthStart';
  for(const [name,value] of Object.entries({state,verifier})){
    const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);
  }
  document.body.append(form);form.submit();
}catch(e){document.getElementById('oauth-status').textContent=e.message;}
