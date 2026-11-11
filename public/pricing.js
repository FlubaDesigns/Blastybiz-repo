/* Display only: settings/pricing remains the checkout price authority. */
(function(){
  const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value).replace(/\.00$/,'');
  async function load(){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/getPublicPlanOptions',{signal:controller.signal});
      if(!response.ok)throw Error('Pricing unavailable');
      const {prices={},bizLimits={}}=await response.json();
      document.querySelectorAll('[data-price]').forEach(node=>{
        const number=Number(prices[node.dataset.price]);
        let display = number;
        if (node.dataset.pricePeriod === 'weekly') display = number * 12 / 52;
        if (node.dataset.pricePeriod === 'annual') display = number * 12;
        if (node.dataset.pricePeriod === 'monthly-difference') display = Number(node.dataset.comparisonMonthly) - number;
        if (node.dataset.pricePeriod === 'annual-difference') display = Number(node.dataset.comparisonAnnual) - number * 12;
        node.textContent=Number.isFinite(number)&&number>0&&Number.isFinite(display)?money(display):'See checkout';
      });
      document.querySelectorAll('[data-biz-limit]').forEach(node=>{
        const value=bizLimits[node.dataset.bizLimit];
        node.textContent=Number.isSafeInteger(value)&&value>=0?String(value):'See plans';
      });
    }catch(error){
      document.querySelectorAll('[data-price]').forEach(node=>node.textContent='See checkout');
      document.querySelectorAll('[data-biz-limit]').forEach(node=>node.textContent='See plans');
    }
    finally{clearTimeout(timer);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();
