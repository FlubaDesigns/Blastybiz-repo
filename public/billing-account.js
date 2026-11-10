/* Self-service view over createPortalSession; no client-owned billing state. */
(function(root){
 'use strict';
 let user,host,state,busy=false;
 const el=id=>host.querySelector('#'+id);
 const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
 async function api(body){
   const token=await user.getIdToken();
   const response=await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/createPortalSession',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Billing is unavailable.');return data;
 }
 function render(){
   el('billing-message').textContent=state.message||(state.pending?'Confirmation pending. Refresh shortly.':state.hasSubscription?'Your subscription is '+String(state.status||'pending').toLowerCase()+'.':'Choose a plan to subscribe.');
   el('billing-dates').textContent=[state.paidThrough?'Paid through '+state.paidThrough:'',state.cancelDate?'Cancellation scheduled for '+state.cancelDate:''].filter(Boolean).join(' · ');
   el('billing-change').hidden=!state.hasSubscription||state.pending||!state.version||!['ACTIVE','PAUSED'].includes(state.status);
   const select=el('billing-plan');select.replaceChildren();
   for(const choice of state.choices||[]){const option=document.createElement('option');option.value=choice.plan+':'+choice.period;option.textContent=choice.plan[0].toUpperCase()+choice.plan.slice(1)+' — '+money(choice.amountCents)+' / '+(choice.period==='annual'?'year':'month');select.append(option);}
   select.value=state.plan+':'+state.billingPeriod;
   el('billing-actions').replaceChildren();
   for(const action of state.actions||[]){const row=document.createElement('div');row.className='row';const text=document.createElement('p');text.textContent=(action.type==='CANCEL'?'Cancellation':'Plan change')+' scheduled'+(action.effectiveDate?' for '+action.effectiveDate:'')+'.';const button=document.createElement('button');button.className='btn';button.type='button';button.textContent='Undo scheduled change';button.addEventListener('click',()=>change('undo',{actionId:action.id}));row.append(text,button);el('billing-actions').append(row);}
   el('billing-cancel').disabled=!!state.cancelDate||!!state.actions?.length;
   el('billing-save').disabled=!!state.actions?.length;
 }
 async function refresh(){
   if(busy)return;busy=true;el('billing-refresh').disabled=true;el('billing-message').textContent='Checking your subscription…';
   try{state=await api({action:'status'});render();}catch(e){el('billing-message').textContent=e.message;}finally{busy=false;el('billing-refresh').disabled=false;}
 }
 async function change(action,extra={}){
   if(busy||!state)return;
   const choice=(state.choices||[]).find(c=>c.plan+':'+c.period===el('billing-plan').value);
   const message=action==='cancel'?'Cancel renewal at the end of your current billing period? Your current access stays available until then.':action==='undo'?'Remove this scheduled billing change?':choice?'Change to '+choice.plan+' at '+money(choice.amountCents)+' per '+(choice.period==='annual'?'year':'month')+' starting with the next billing period?':'';
   if(!message||!root.confirm(message))return;
   busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);
   try {
     state=await api({action,requestId:crypto.randomUUID(),expectedVersion:state.version,...(action==='change'?{plan:choice.plan,period:choice.period,expectedPriceCents:choice.amountCents}:{}),...extra});render();
   }catch(e){el('billing-message').textContent=e.message;}
   finally{busy=false;el('billing-refresh').disabled=false;if(!state.pending){el('billing-cancel').disabled=!!state.cancelDate||!!state.actions?.length;el('billing-save').disabled=!!state.actions?.length;}}
 }
 function mount(element,currentUser){
   host=element;user=currentUser;host.hidden=false;
   if(!host.dataset.mounted){
     host.innerHTML='<div class="row"><div class="col-full"><h3>Manage subscription</h3><p id="billing-message" role="status"></p><p id="billing-dates"></p><button class="btn" type="button" id="billing-refresh">Refresh subscription</button><div id="billing-actions"></div><div id="billing-change" hidden><label for="billing-plan">Plan and billing period</label><select id="billing-plan"></select><p>Changes take effect at the end of the current billing period. Access updates after provider confirmation.</p><div class="row"><div class="layout__split"><button class="btn btn-primary" type="button" id="billing-save">Review plan change</button><button class="btn" type="button" id="billing-cancel">Cancel renewal</button></div></div></div><p><a href="BlastyBiz-Dashboard.html">Continue to your dashboard</a></p></div></div>';
     el('billing-refresh').addEventListener('click',refresh);el('billing-save').addEventListener('click',()=>change('change'));el('billing-cancel').addEventListener('click',()=>change('cancel'));host.dataset.mounted='true';
   }
   return refresh();
 }
 root.BBBilling={mount};
})(window);
