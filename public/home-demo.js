/* Static example: no generation, account writes, or publication on page load. */
(function(){
  const copy={
    facebook:'A little green goes a long way. 🌿 Find a new plant for your favorite corner at Green Corner. Stop by and take a look!',
    instagram:'Find your next leafy little obsession. 🌿 A fresh corner starts with one plant.\n\n#PlantShop #Houseplants #ShopSmall',
    google:'Explore houseplants at Green Corner. Visit the shop to find a plant for your home and ask about caring for it.'
  };
  const root=document.getElementById('home-post-demo');if(!root)return;
  function show(pid){
    if(!Object.hasOwn(copy,pid))return;
    root.querySelectorAll('[data-demo-platform]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.demoPlatform===pid)));
    document.getElementById('home-demo-post').innerHTML=BBPostPreview.render({meta:BBPlatforms.byId[pid],pid,text:copy[pid],images:['img/storefront.jpg'],bizName:'Green Corner',status:'Example · Not published',copy:false,photoAlt:'A shop owner opening a plant-filled storefront',eager:true});
  }
  root.addEventListener('click',event=>{const button=event.target.closest('[data-demo-platform]');if(button)show(button.dataset.demoPlatform);});
  show('facebook');
})();
