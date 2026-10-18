// The Authorization Engine issues the request; existing OAuth owns consent and tokens.
export async function renderFacebookAuthorization({user,businessId,requestId,container}) {
  const element=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
  container.replaceChildren();
  const title=element('h1','Authorize Facebook');
  const status=element('p','Loading your authorization request…');status.setAttribute('role','status');
  container.append(title,status);
  try {
    const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
    if(!valid(businessId)||!valid(requestId))throw Error('This authorization link is incomplete.');
    const base='https://us-central1-blastybiz-9523e.cloudfunctions.net';
    const response=await fetch(base+'/oauthDestination',{method:'POST',headers:{Authorization:'Bearer '+await user.getIdToken(),'Content-Type':'application/json'},body:JSON.stringify({action:'authorizationRequest',businessId,requestId})});
    const request=await response.json();
    if(!response.ok)throw Error(request.error||'The authorization request could not be loaded. Please reload this page.');
    if(request.businessId!==businessId||request.requestId!==requestId||!/^\d{5,32}$/.test(request.pageId))throw Error('The authorization request does not match this link.');
    title.textContent=(request.connected?'Facebook connected: ':'Authorize Facebook for ')+request.pageName;
    if(request.connected){status.textContent='Your requested Facebook Page is connected to this business in BlastyBiz.';return;}
    status.textContent='Continue to Facebook, review the Page permissions, then return here to finish connecting '+request.pageName+'.';
    const help=element('p','If Facebook offers previous settings, choose Edit settings and include '+request.pageName+'. Keep your other Pages selected. If the same Page list keeps returning, review BlastyBiz under Business Integrations using your personal Facebook profile, then return here to continue.');
    const permissions=element('a','Open Facebook Business Integrations');
    permissions.href='https://www.facebook.com/settings?tab=business_tools';permissions.target='_blank';permissions.rel='noopener noreferrer';permissions.style.display='block';
    const page=element('a','View '+request.pageName+' on Facebook');
    page.href='https://www.facebook.com/profile.php?id='+request.pageId;page.target='_blank';page.rel='noopener noreferrer';
    const button=element('button','Continue to Facebook');button.type='button';button.className='btn-primary';
    button.style.cssText='display:block;width:100%;min-height:56px;margin:24px 0;white-space:normal';
    const note=element('p','This connects your existing Page. It does not publish a post. Complete the connection in this browser tab.');
    button.addEventListener('click',async()=>{
      button.disabled=true;status.textContent='Opening Facebook authorization…';
      try {
        const url=base+'/initiateFacebookOAuth?'+new URLSearchParams({businessId,authorizationRequest:requestId});
        await window.BBOAuth.begin(url,await user.getIdToken());
      }catch(e){status.textContent=e.message||'Facebook authorization could not start. Please try again.';button.disabled=false;}
    });
    container.append(help,permissions,page,button,note);
  }catch(e){status.textContent=e.message;}
}
