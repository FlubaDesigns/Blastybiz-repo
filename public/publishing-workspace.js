/* A view over the existing business, Ad, Blast and delivery records. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let epoch = 0, moving = [], busy = false;
  const current = () => `${window.activeBizId || ''}/${window.activeCampaignId || ''}/${window.BBAds?.active?.id || ''}`;
  const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; } };
  function link(tab, extra = {}) {
    return 'BlastyBiz.html?' + new URLSearchParams({ownerUid:window._bbUid, bizId:window.activeBizId, tab, ...extra});
  }
  function action(label, name, extra = '') {
    return `<button type="button" class="btn btn-secondary" data-publishing-action="${name}" ${extra}>${label}</button>`;
  }
  function photos(images) {
    const allowed = (images || []).filter(i => safeUrl(i.url));
    return allowed.length ? '<div class="row"><div class="col-3 publishing-photos">' + allowed.map(i => `<div class="col-full"><img src="${esc(safeUrl(i.url))}" alt="${esc(i.alt || 'Selected blast image')}" loading="lazy"></div>`).join('') + '</div></div>' : '<p class="muted">Text-only — no images selected.</p>';
  }
  function packet(copy, images, selected) {
    return photos(images) + (selected || Object.keys(copy || {})).map(id => {
      const meta = window.PLATFORMS?.find(p => p.id === id);
      return `<section class="publishing-copy"><h3>${esc(meta?.name || id)}</h3><p>${esc(copy?.[id] || 'Copy has not been generated for this destination yet.')}</p></section>`;
    }).join('');
  }
  // Move the existing live platform controls; never clone controls or state.
  function mountDestinations(on) {
    const source = el('section-platforms'), target = el('publishing-platforms');
    if (!source || !target) return;
    if (on && !moving.length) {
      moving = [...source.children].map(node => {
        const marker = document.createComment('publishing destination home');
        source.insertBefore(marker, node); target.append(node); return {node, marker};
      });
    } else if (!on && moving.length) {
      for (const {node, marker} of moving) { marker.replaceWith(node); }
      moving = [];
    }
  }
  function proposal() {
    const ad = window.BBAds?.active, host = el('publishing-proposal');
    host.replaceChildren();
    if (!ad) {
      host.innerHTML = '<h2>Proposed blast</h2><p>No saved ad is selected yet.</p>' + action('Create a blast', 'create'); return;
    }
    const included = (ad.platforms || []).filter(id => ad.platformStatus?.[id] !== 'excluded');
    const approved = included.length && included.every(id => ad.adaptations?.[id]?.trim() && ad.platformStatus?.[id] === 'approved');
    host.innerHTML = '<div class="flex-row bb-list-heading"><h2>'+esc(ad.name||'Proposed blast')+'</h2>'+BBMore.html(action('Edit copy &amp; images','edit')+action('Review / regenerate / approve','review')+action('Schedule or hold','schedule')+'<button type="button" data-more-target="publishing-packet">View saved copy &amp; photos</button>')+'</div><p>'+(approved?'Copy approved — ready for final review.':'Draft — needs review.')+'</p><div id="publishing-packet" hidden>'+packet(ad.adaptations,ad.imageRefs,included)+'<p>Editing this Ad does not replace an already-prepared Blast.</p></div>'+(!included.length?'<p>No destinations included in this Ad.</p>':'')+action('Final blast preview','preview');
  }
  async function timing(seq, identity) {
    const host = el('publishing-timing'); host.textContent = 'Loading schedules…';
    try {
      window.BBLifecycle.configure({businessId:window.activeBizId, token:window._bbGetToken});
      const data = await window.BBLifecycle.api('list');
      if (seq !== epoch || identity !== current()) return;
      window.BBLifecycle.renderSchedules(host,data,{onChange:refresh,onEdit:(request,row)=>{
        location.href=link('schedule',{cid:request.campaignId,adId:request.adId,scheduleAd:request.adId,scheduleCampaign:request.campaignId,...(row.upcoming?.id?{scheduledBlastId:row.upcoming.id}:{})});
      }});
    } catch (_) {
      if (seq === epoch && identity === current()) host.textContent = 'Schedules could not be loaded. Use Refresh publishing to retry.';
    }
  }
  async function results(seq, identity) {
    const host = el('publishing-results'); host.textContent = 'Loading results…';
    // Preserve the existing trial restriction on detailed history.
    if (window._bbUserPlan === 'trial') { host.innerHTML = `<p>Full history is available with a paid plan.</p><a href="${esc(link('history'))}">View history options</a>`; return; }
    await window._bbReloadHistory?.();
    if (seq !== epoch || identity !== current()) return;
    const feedback = el('history-feedback')?.textContent || '';
    host.innerHTML = `<p>${esc(feedback)}</p>`;
    for (const row of window._bbGetHistory?.() || []) {
      const url = 'BlastyBiz-Publishing-Status.html?' + new URLSearchParams({ownerUid:window._bbUid,bizId:window.activeBizId,draftId:row.draftId || ''});
      host.innerHTML += `<article class="publishing-result"><h3>${esc(row.listing)}</h3><p>${esc(row.summary)}</p>${row.time ? `<p>${esc(new Date(row.time).toLocaleString())}</p>` : ''}${row.draftId ? `<a class="btn btn-secondary" href="${esc(url)}">Posted links, results & follow-up</a>` : ''}</article>`;
    }
  }
  async function refresh() {
    const seq = ++epoch;
    if (!window._bbWorkspaceNavigationReady || !window.activeBizId) return;
    const message = el('publishing-message');
    message.textContent = 'Loading saved publishing details…';
    el('publishing-title').textContent = (profile.name || 'This business') + ' · Publishing';
    const selector = el('publishing-campaign');
    selector.innerHTML = '<option value="">Choose a campaign</option>' + campaigns.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    selector.value = window.activeCampaignId || ''; selector.disabled = false;
    el('publishing-proposal').replaceChildren();
    el('publishing-timing').replaceChildren();
    el('publishing-results').replaceChildren();
    try {
      if (window.activeCampaignId) {
        await window.BBAds.ready();
        if (window.BBAds.dirty) await window.BBAds.save();
      }
      if (seq !== epoch) return;
      proposal();
      const identity = current();
      await Promise.all([timing(seq, identity), results(seq, identity)]);
      if (seq === epoch && identity === current()) message.textContent = 'Showing saved details for this business. Refresh to check for updates.';
    } catch (e) {
      if (seq === epoch) { el('publishing-proposal').replaceChildren(); message.textContent = 'Could not load the saved ad. ' + e.message; }
    }
  }
  async function act(name) {
    if (busy) return;
    busy = true;
    try {
      if (name === 'create') { showTab('create'); openNewCampaign(); return; }
      await window.BBAds.ready();
      if (name === 'preview') {
        // Existing Continue routes incomplete copy to its canonical review screen.
        showTab('create'); await window.BBAds.continueCurrent(); return;
      }
      if (name === 'schedule') { showTab('schedule'); return; }
      showTab('create'); createWizGoTo(name === 'review' ? 5 : 1);
    } catch (e) { el('publishing-message').textContent = e.message; window.showToast?.(e.message); }
    finally { busy = false; }
  }
  el('section-publishing')?.addEventListener('click', e => {
    const button = e.target.closest('[data-publishing-action]');
    if (button) void act(button.dataset.publishingAction);
  });
  el('publishing-refresh')?.addEventListener('click', () => { void refresh(); });
  el('publishing-campaign')?.addEventListener('change', async e => {
    const campaign = campaigns.find(c => c.id === e.target.value); if (!campaign || busy) return;
    busy = true; e.target.disabled = true; ++epoch;
    try { await selectCampaign(campaign.id, campaign.name); showTab('publishing'); }
    catch (error) { el('publishing-message').textContent = error.message; }
    finally { busy = false; e.target.disabled = false; }
  });
  window.BBPublishing = {refresh, mountDestinations};
})();
