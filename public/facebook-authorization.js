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
    const instagram=request.requiredPlatform==='instagram';
    title.textContent=instagram?(request.connected?'Instagram connected: @':'Connect Instagram @')+request.instagramUsername:(request.connected?'Facebook connected: ':'Authorize Facebook for ')+request.pageName;
    if(request.connected){status.textContent=instagram?'Your requested Instagram account is connected and saved for this business.':'Your requested Facebook Page is connected to this business in BlastyBiz.';return;}
    status.textContent='Continue to Facebook, review the Page permissions, then return here to finish connecting '+request.pageName+'.';
    const help=element('p','If Facebook offers previous settings, choose Edit settings and include '+request.pageName+'. Keep your other Pages selected. If the same Page list keeps returning, review BlastyBiz under Business Integrations using your personal Facebook profile, then return here to continue.');
    const permissions=element('a','Open Facebook Business Integrations');
    permissions.href='https://www.facebook.com/settings?tab=business_tools';permissions.target='_blank';permissions.rel='noopener noreferrer';permissions.className='btn-secondary';
    const page=element('a','View '+request.pageName+' on Facebook');
    page.href='https://www.facebook.com/profile.php?id='+request.pageId;page.target='_blank';page.rel='noopener noreferrer';
    const button=element('button','Continue to Facebook');button.type='button';button.className='btn-primary';
    button.classList.add('authorization-continue');
    const note=element('p','This connects your existing Page. It does not publish a post. Complete the connection in this browser tab.');
    button.addEventListener('click',async()=>{
      button.disabled=true;status.textContent='Opening Facebook authorization…';
      try {
        const url=base+'/initiateFacebookOAuth?'+new URLSearchParams({businessId,authorizationRequest:requestId});
        await window.BBOAuth.begin(url,await user.getIdToken());
      }catch(e){status.textContent=e.message||'Facebook authorization could not start. Please try again.';button.disabled=false;}
    });
    if(instagram){
      status.textContent=(request.facebookConnected?'Facebook is saved. ':'')+'Instagram @'+request.instagramUsername+' still needs its own account access and Page link. This request stays open until Instagram is saved.';
      help.textContent='In Meta choose Edit previous settings, include @'+request.instagramUsername+' under Instagram accounts and '+request.pageName+' under Pages, then allow access. If Instagram is absent, finish linking the Page inside Instagram first.';
      button.textContent='Authorize Instagram access';
      const profile=element('a','Open Instagram @'+request.instagramUsername);profile.href='https://www.instagram.com/'+request.instagramUsername+'/';profile.target='_blank';profile.rel='noopener noreferrer';profile.className='btn-secondary';
      const steps=element('p','In Instagram: Edit profile → Facebook → '+request.pageName+'. Finish the connection, then return here to authorize access.');
      container.append(profile,steps);
      note.textContent='This verifies and saves Instagram. It does not publish a post. Stay in this browser tab for the authorization.';
    }
    container.append(help,permissions,page,button,note);
  }catch(e){status.textContent=e.message;}
}
