'use strict';
// Company destinations only. Never request w_member_social or accept person URNs.
const VERSION='202609';
const REDIRECT_URI='https://us-central1-blastybiz-9523e.cloudfunctions.net/linkedinOAuthCallback';
const SCOPES='rw_organization_admin w_organization_social';
const organizationId=urn=>typeof urn==='string'&&/^urn:li:organization:([0-9]+)$/.exec(urn)?.[1];
function createLinkedIn({axios}) {
  async function choices(accessToken) {
    const headers={Authorization:`Bearer ${accessToken}`,'LinkedIn-Version':VERSION,'X-Restli-Protocol-Version':'2.0.0'};
    const found=new Map();
    for(let start=0;start<500;start+=100){
      const {data}=await axios.get('https://api.linkedin.com/rest/organizationAcls',{headers,params:{q:'roleAssignee',role:'ADMINISTRATOR',state:'APPROVED',start,count:100},timeout:20000});
      if(!Array.isArray(data.elements))throw Error('Invalid LinkedIn Page inventory.');
      for(const row of data.elements){
        const id=organizationId(row.organization);
        if(id&&row.role==='ADMINISTRATOR'&&row.state==='APPROVED')found.set(id,{id,organizationId:id,organizationUrn:row.organization,label:'LinkedIn company Page '+id});
      }
      if(!data.paging?.links?.some(link=>link.rel==='next')){
        for(const choice of found.values()){
          const result=await axios.get('https://api.linkedin.com/rest/organizations/'+choice.id,{headers,timeout:20000});
          if(String(result.data.id)!==choice.id)throw Error('LinkedIn returned a different company Page.');
          if(typeof result.data.localizedName==='string'&&result.data.localizedName.trim())choice.label=result.data.localizedName;
        }
        return [...found.values()];
      }
    }
    throw Error('Too many LinkedIn Pages. Narrow access and reconnect.');
  }
  async function verify(accessToken,choice){
    if(!organizationId(choice.organizationUrn)||choice.organizationUrn!==`urn:li:organization:${choice.id}`||choice.organizationId!==choice.id)throw Error('Invalid company Page.');
    if(!(await choices(accessToken)).some(c=>c.id===choice.id))throw Error('LinkedIn Page access changed. Reconnect.');
  }
  return {choices,verify};
}
module.exports={createLinkedIn,organizationId,VERSION,REDIRECT_URI,SCOPES};
