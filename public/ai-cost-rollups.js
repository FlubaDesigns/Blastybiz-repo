(function(){
 'use strict';
 const host=document.getElementById('ai-cost-rollups');if(!host)return;
 const month=document.createElement('input');month.type='month';month.value=new Date().toISOString().slice(0,7);month.setAttribute('aria-label','Cost month');
 const button=document.createElement('button');button.textContent='Load monthly cost rollups';const output=document.createElement('div');output.setAttribute('role','status');host.append(month,button,output);
 function table(title,headers,rows){const h=document.createElement('h3');h.textContent=title;output.append(h);const t=document.createElement('table');const tr=document.createElement('tr');for(const name of headers){const th=document.createElement('th');th.textContent=name;tr.append(th);}t.append(tr);for(const row of rows){const tr=document.createElement('tr');for(const v of row){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}t.append(tr);}output.append(t);}
 const money=n=>'$'+Number(n||0).toFixed(6);
 button.onclick=async()=>{button.disabled=true;output.textContent='Loading stored costs…';try{
   const user=window._adminUser;if(!user)throw Error('Sign in as an admin first.');
   const r=await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/adminAiCostRollups?month='+encodeURIComponent(month.value),{headers:{Authorization:'Bearer '+await user.getIdToken()}}),d=await r.json();if(!r.ok)throw Error(d.error||'Could not load costs.');output.replaceChildren();
   table('Business totals',['Account / Business','Calls','Cost'],d.businesses.map(b=>[b.uid+' / '+(b.businessId||'Unattributed'),b.callCount,money(b.totalCostUsd)]));
   table('Purpose by business',['Account / Business','Purpose','Calls','Cost'],d.businesses.flatMap(b=>Object.entries(b.purpose).map(([p,x])=>[b.uid+' / '+(b.businessId||'Unattributed'),p,x.callCount,money(x.costUsd)])));
   table('Tier costs per active AI account',['Tier','Accounts','Mean','p90'],Object.entries(d.tiers).map(([p,x])=>[p,x.accounts,money(x.meanCostUsd),money(x.p90CostUsd)]));
   table('Copy behavior',['Behavior','Calls','Cost'],Object.entries(d.copyBehavior).map(([p,x])=>[p,x.callCount,money(x.costUsd)]));
   const note=document.createElement('p');note.textContent=d.note;output.append(note);
 }catch(e){output.textContent=e.message;}finally{button.disabled=false;}};
})();
