/* Display only: settings/pricing remains the checkout price authority. */
(function(){
  const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value).replace(/\.00$/,'');
  async function load(){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch('https://firestore.googleapis.com/v1/projects/blastybiz-9523e/databases/(default)/documents/settings/pricing',{signal:controller.signal});
      if(!response.ok)throw Error('Pricing unavailable');
      const {fields={}}=await response.json();
      document.querySelectorAll('[data-price]').forEach(node=>{
        const value=fields[node.dataset.price],number=Number(value?.doubleValue??value?.integerValue??value?.stringValue);
        node.textContent=Number.isFinite(number)&&number>0?money(number):'See checkout';
      });
    }catch(error){document.querySelectorAll('[data-price]').forEach(node=>node.textContent='See checkout');}
    finally{clearTimeout(timer);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();
