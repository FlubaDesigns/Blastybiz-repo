(function () {
  'use strict';
  const toggle = document.getElementById('workspace-help-toggle');
  const panel = document.getElementById('workspace-help-panel');
  const wizard = document.getElementById('create-wizard');
  if (!toggle || !panel || !wizard) return;
  const message = document.getElementById('workspace-help-message');
  const show = document.getElementById('workspace-help-show');
  let mascot = null;
  const visible = el => !!el && el.getClientRects().length > 0;
  function guidance() {
    if (document.getElementById('create-slide-5')?.classList.contains('cwiz-active')) {
      const next = document.getElementById('step5-final-btn');
      if (visible(next) && !next.disabled) return {text: 'Every platform is reviewed. Tap Review My Blast to see the final preview.', target: next};
      const open = wizard.querySelector('.step5-review-card[open]');
      const approval = open?.querySelector('.step5-looks-good-btn:not(.approved)');
      const target = visible(approval) ? approval : open?.querySelector('summary') || wizard.querySelector('.step5-review-card > summary');
      return {text: 'Open a platform to review its copy and photos. Edit the copy or choose Rewrite copy, then tap Looks Good when you are happy with it.', target};
    }
    const offer = document.getElementById('biz-offer');
    if (!visible(offer)) return {text: 'Choose a campaign from the dropdown, or tap New to start one.', target: document.querySelector('.workspace-campaign-picker > summary') || document.querySelector('.compact-new-campaign')};
    return {text: 'Tell me what you are promoting, choose your photos and platforms, then use the green button to continue to review.', target: offer};
  }
  function refresh() {
    if (panel.hidden) return;
    const current = guidance();
    if (message.textContent !== current.text) message.textContent = current.text;
    show.disabled = !visible(current.target);
  }
  function close() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus({preventScroll: true});
  }
  toggle.addEventListener('click', () => {
    if (!panel.hidden) return close();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (!mascot && window.PBMascot) mascot = PBMascot.create('#workspace-help-mascot', {name: 'Blasty'});
    mascot?.setMood('s-wave');
    refresh();
  });
  document.getElementById('workspace-help-close').addEventListener('click', close);
  show.addEventListener('click', () => {
    const target = guidance().target;
    if (!visible(target)) return refresh();
    if (mascot) mascot.pointTo(target);
    else target.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    target.focus?.({preventScroll: true});
  });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  new MutationObserver(changes => {
    if (!panel.hidden && changes.some(change => !panel.contains(change.target))) refresh();
  }).observe(wizard, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'disabled', 'open']});
  wizard.addEventListener('toggle', refresh, true);
}());
