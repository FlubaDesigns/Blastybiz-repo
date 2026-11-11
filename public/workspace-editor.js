// ══════════════════════════════════════════
// PLATFORM REGISTRY — add new platforms here
// ══════════════════════════════════════════
const PLATFORMS = BBPlatforms.records.map(p => ({id:p.id, name:p.name, icon:p.icon, color:p.color,
  type:p.deliveryMode === 'auto' ? 'api' : 'manual', enabled:p.selected, status:'idle', proOnly:false,
  note:BBPlatforms.labels[p.deliveryMode]}));
const PLATFORM_RULES = Object.fromEntries(BBPlatforms.records.map(p => [p.id, {
  maxChars:p.doc.maxChars, notes:p.doc.format + ' ' + p.doc.tone
}]));
window.PLATFORMS = PLATFORMS; // expose for module script
let platforms = PLATFORMS.map(p => ({...p})); // populated from Firestore after auth
let history   = [];                           // populated from Firestore after auth
let profile   = (function(){ try { return JSON.parse(localStorage.getItem('bb_profile') || '{}'); } catch(e) { return {}; } })(); // seeded from cache; Firestore overwrites
let draft     = {};                           // form state only — draftId tracked separately
let locationType        = 'physical';         // 'physical' | 'online' — create form
let campaigns           = [];                 // [{id, name, photos:[]}] loaded from Firestore
var activeCampaignId    = null;
let activeCampaignName  = '';
var ynState = { firstName: 'no', lastName: 'no', role: 'no', address: 'yes', phone: 'yes', email: 'yes', website: 'yes' }; // About You in Copy pill state
// Per-platform photo selection (session only — resets on reload)
// { pid: Set of selected photo URLs }
window._bbPlatformPhotoSel = {};
window._bbPlatformUrls     = {};   // { pid: savedPageUrl } — persisted to Firestore
let platformReasons     = {};                 // AI-suggested reasons per platform id
let profileLocationType = 'physical';         // 'physical' | 'online' — profile form
window._bbPhotoItems = []; // [{url, path, localUrl, done, progress, error}]
window._bbSelectedPhotoIndex = null; // index of featured/selected photo
window._bbFeaturedPhotoUrl = ''; // cache of the existing business featuredPhoto field
window._bbPhotoUploads = new Set(); // references to unfinished upload items, not a second image library
window._globalImages = [];           // global business images [{url,path,id,scope:'global'}]
let photoScope = 'campaign';        // 'campaign' | 'global'

function _getAIMemory() {
  return {
    globalMemory:   window._globalMemory || profile.globalMemory || '',
    campaignMemory: (campaigns.find(c => c.id === activeCampaignId) || {}).campaignMemory || '',
  };
}

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
function savePlatformSelections() {
  applyPlatformEligibility();
  const ids = platforms.filter(p => p.enabled).map(p => p.id);
  try { localStorage.setItem('bb_platforms_enabled', JSON.stringify(ids)); } catch(e) {}
  if (window._bbSavePlatformSelections) {
    window._bbSavePlatformSelections(ids).catch(e => { console.warn('savePlatformSelections:', e); showToast('Destination changes were not saved. Please retry before scheduling.'); });
  }
}

function loadPlatformSelections() {
  try {
    const saved = JSON.parse(localStorage.getItem('bb_platforms_enabled') || 'null');
    if (saved && Array.isArray(saved)) {
      platforms = platforms.map(p => ({ ...p, enabled: saved.includes(p.id) }));
    }
  } catch(e) {}
}

function init() {
  loadProfile();
  loadDraft();
  loadPlatformSelections();
  renderPlatforms();
  renderQuickSelect();
  renderHistory();
  updateStats();
}

// ══════════════════════════════════════════
// TABS
// ══════════════════════════════════════════
// ── Story tab helpers ──
function storyFieldInput(el, cntId) {
  document.getElementById(cntId).textContent = el.value.length;
  const btn = document.getElementById('story-btn-save');
  if (btn) { btn.disabled = false; }
  const st = document.getElementById('story-save-status');
  if (st) { st.textContent = ''; st.style.opacity = '0'; }
}
function closeDocModal() {
  document.getElementById('doc-modal').style.display = 'none';
  document.body.style.overflow = '';
}
// ── Account tab helpers ──
function openDeleteModal() {
  const o = document.getElementById('delete-overlay');
  if (o) { o.style.display = 'flex'; }
  const inp = document.getElementById('delete-confirm-input');
  if (inp) inp.value = '';
  const btn = document.getElementById('delete-confirm-btn');
  if (btn) { btn.disabled = true; }
  const err = document.getElementById('delete-error');
  if (err) err.style.display = 'none';
}
function closeDeleteModal() {
  const o = document.getElementById('delete-overlay');
  if (o) o.style.display = 'none';
}

// ── Tab strip scroll arrows ───────────────────────────────────────────────────
function _updateTabArrows() {
  var strip = document.getElementById('tabs-scroll');
  var row   = strip && strip.closest('.tabs-row');
  if (!strip || !row) return;
  var atStart = strip.scrollLeft <= 2;
  var atEnd   = strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 2;
  var overflow = strip.scrollWidth > strip.clientWidth + 4;
  var btnL = document.getElementById('tabs-arrow-left');
  var btnR = document.getElementById('tabs-arrow-right');
  if (btnL) btnL.classList.toggle('visible', overflow && !atStart);
  if (btnR) btnR.classList.toggle('visible', overflow && !atEnd);
  row.classList.toggle('fade-left',  overflow && !atStart);
  row.classList.toggle('fade-right', overflow && !atEnd);
}
function _tabsScroll(dir) {
  var strip = document.getElementById('tabs-scroll');
  if (!strip) return;
  strip.scrollBy({ left: dir * 120, behavior: 'smooth' });
}
(function _initTabArrows() {
  var strip = document.getElementById('tabs-scroll');
  if (!strip) return;
  strip.addEventListener('scroll', _updateTabArrows, { passive: true });
  // Run once layout is ready, then again after fonts/icons settle
  requestAnimationFrame(function() { _updateTabArrows(); setTimeout(_updateTabArrows, 300); });
  window.addEventListener('resize', _updateTabArrows);
})();

function showTab(name, options = {}) {
  if(name==='schedule'&&document.getElementById('section-schedule')?.classList.contains('active')&&window.BBLifecycle?.hasUnsavedChanges?.())return;
  if(name!=='schedule'&&document.getElementById('section-schedule')?.classList.contains('active')&&window.BBLifecycle?.canLeave&&!window.BBLifecycle.canLeave())return;
  if (profile.sellerType === 'personal' && (name === 'profile' || name === 'story')) name = 'create';
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  // aria-selected must move with the highlight, or screen readers keep announcing
  // whichever tab was marked selected in the markup (Profile) on every screen.
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-selected', 'false');
  });
  document.getElementById('section-' + name).classList.add('active');
  const settings = document.getElementById('workspace-settings');
  if (settings) settings.open = ['profile','story','platforms','schedule','account'].includes(name);
  const activeTab = document.getElementById('tab-' + name);
  if (activeTab) {
    activeTab.classList.add('active');
    activeTab.setAttribute('aria-selected', 'true');
    activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
  window.BBPublishing?.mountDestinations(name === 'publishing');
  if (name === 'publishing') void window.BBPublishing?.refresh();
  if (name === 'platforms') updateStats();
  if (name === 'history')  renderHistory();
  if (name === 'schedule') renderScheduleTab();
  if (name === 'profile')  loadProfile();
  if (name === 'story')   { if (window._bbLoadStory) window._bbLoadStory(); }
  if (name === 'account') { if (window._bbLoadAccount) window._bbLoadAccount(); }
  if (name === 'create') {
    createWizGoTo(createWizStep, false, {record:false, scroll:false});
    if (activeCampaignId) {
      document.getElementById('campaign-content')?.classList.remove('hidden');
    }
  }
  if (options.record !== false) window._bbRecordWorkspaceRoute?.();
}

// Navigation stores only location, never a second copy of the Ad or its edits.
window._bbWorkspaceNavigationReady = false;
window._bbRestoringWorkspace = false;
window._bbRecordWorkspaceRoute = function(replace = false) {
  if (!window._bbWorkspaceNavigationReady || window._bbRestoringWorkspace) return;
  const url = new URL(location.href), q = url.searchParams;
  const tab = document.querySelector('.section.active')?.id.replace('section-', '') || 'create';
  q.set('tab', tab);
  q.set('step', String(createWizStep));
  if (window.activeBizId) q.set('bizId', window.activeBizId);
  if (activeCampaignId) q.set('cid', activeCampaignId); else q.delete('cid');
  if (window.BBAds?.active) q.set('adId', window.BBAds.active.id); else q.delete('adId');
  for (const key of ['edit','autogenerate','checkout','draftId']) q.delete(key);
  if (activeCampaignId) q.delete('newcampaign');
  if (tab !== 'schedule') for (const key of ['scheduleAd','scheduleCampaign','scheduledBlastId','sourceBlastId']) q.delete(key);
  if (url.href === location.href) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
};
window._bbRestoreWorkspaceRoute = async function() {
  if (!window._bbWorkspaceNavigationReady || window._bbRestoringWorkspace) return;
  window._bbRestoringWorkspace = true;
  const requestedUrl = location.href;
  let restored = false;
  try {
    const q = new URLSearchParams(location.search);
    if(window.BBLifecycle?.hasUnsavedChanges?.()&&!window.BBLifecycle.canLeave())throw Error('Your unsaved schedule is still here. Save Schedule when ready.');
    if (window._bbAdaptationBusy || window._bbDraftSavePending || (window.BBAds?.operationBusy ?? window.BBAds?.busy)) throw Error('Wait for your current operation to finish before going back.');
    if (window.BBAds?.active) await window.BBAds.save();
    // A second Back/Forward tap during the save owns the final destination.
    if (location.href !== requestedUrl) { restored = true; return; }
    if (q.get('bizId') && q.get('bizId') !== window.activeBizId) { restored = true; location.reload(); return; }
    const campaign = campaigns.find(c => c.id === q.get('cid'));
    if (campaign && (activeCampaignId !== campaign.id || (q.get('adId') && q.get('adId') !== window.BBAds?.active?.id))) {
      await selectCampaign(campaign.id, campaign.name, {adId:q.get('adId')});
      if (activeCampaignId !== campaign.id) throw Error('Wait for the current operation to finish before going back.');
    }
    const step = Number(q.get('step'));
    if (SLIDE_IDS.includes(step)) createWizGoTo(step, false, {record:false, scroll:false});
    const tab = q.get('tab');
    showTab(['publishing','profile','story','create','platforms','schedule','history','account'].includes(tab) ? tab : 'create');
    restored = true;
  } catch (e) { showToast(e.message); }
  finally {
    window._bbRestoringWorkspace = false;
    if (restored && location.href !== requestedUrl) void window._bbRestoreWorkspaceRoute();
    else window._bbRecordWorkspaceRoute(true);
  }
};
window.addEventListener('popstate', () => { void window._bbRestoreWorkspaceRoute(); });

// ══════════════════════════════════════════
// PLATFORM RENDERING
// ══════════════════════════════════════════
function platformEligible(p) {
  return BBPlatforms.eligibleForBusiness(p.id, profile);
}

function applyPlatformEligibility() {
  platforms = platforms.map(p => BBPlatforms.normalizeSelection(p, profile)).map(p => platformEligible(p) ? p : { ...p, enabled: false });
}

function renderPlatforms() {
  applyPlatformEligibility();
  const apiEl    = document.getElementById('api-platforms');
  const manualEl = document.getElementById('manual-platforms');
  apiEl.innerHTML = '';
  manualEl.innerHTML = '';

  const prefs = window._bbPlatPrefs || {};

  platforms.forEach(p => {
    if (!platformEligible(p)) return;
    if (p.type === 'manual' && prefs[p.id]?.status === 'dismissed') return;
    const card = buildPlatformCard(p);
    if (p.type === 'api') apiEl.appendChild(card);
    else manualEl.appendChild(card);
  });

  _renderDismissedFold(platforms.filter(p => p.type === 'manual' && (window._bbPlatPrefs || {})[p.id]?.status === 'dismissed'));

  updateStats();
}

function _renderDismissedFold(dismissed) {
  const foldEl = document.getElementById('dismissed-platforms-fold');
  if (!foldEl) return;
  if (!dismissed.length) { foldEl.innerHTML = ''; return; }
  const wasOpen = foldEl.querySelector('.dismissed-fold-wrap.open');
  foldEl.innerHTML = `<div class="dismissed-fold-wrap${escHtml(wasOpen ? ' open' : '')}">
    <button type="button" class="dismissed-fold-toggle"
      onclick="this.closest('.dismissed-fold-wrap').classList.toggle('open')">
      <span>Not using (${dismissed.length})</span><span>▾</span>
    </button>
    <div class="dismissed-fold-body">
      ${dismissed.map(p => `<span class="dismissed-plat-chip">${p.icon} ${escHtml(p.name)}<button type="button" onclick="restorePlatform('${escHtml(p.id)}')">Add back</button></span>`).join('')}
    </div>
  </div>`;
}

function buildPlatformCard(p) {
  const div = document.createElement('div');
  div.className = 'platform-card' + (p.enabled ? ' enabled' : '');
  div.id = 'pcard-' + p.id;

  const adaptedText = p.adaptedContent
    ? `<div class="copy-box visible" id="copy-${p.id}">
         <span class="copy-box-label">⚡ AI-Generated Copy</span>
         <button type="button" class="copy-btn-float" onclick="copyText('${p.id}')">Copy</button>
         ${escHtml(p.adaptedContent)}
       </div>`
    : `<div class="copy-box" id="copy-${p.id}"></div>`;


  const actionBtn = p.type === 'api'
      ? `<button type="button" class="btn btn-outline btn-sm" onclick="window._bbOpenConnections()">Manage connection</button>`
      : `<button type="button" class="btn btn-outline btn-sm" onclick="${p.id === 'facebook' && p.type === 'manual' ? "copyAndOpen('facebook')" : "copyText('"+p.id+"')"}" ${!p.enabled || !p.adaptedContent ? 'disabled' : ''}>${p.id === 'facebook' && p.type === 'manual' ? 'Copy & open Facebook' : '📋 Copy text'}</button>`;

  div.innerHTML = `
    <div class="platform-header">
      <div class="platform-info">
        <div class="platform-icon" style="background:${p.color}22;">${p.icon}</div>
        <div>
          <div class="platform-name">${escHtml(p.name)}</div>
          <div class="platform-type ${p.type}">${escHtml(window._bbPlatformReadiness?.(p).label || (p.type === 'api' ? 'Checking connection' : 'You post it'))}</div>
        </div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="togglePlatform('${p.id}', this.checked)" />
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="platform-note-text">${escHtml(p.note || '')}</div>
    ${p.id === 'yelp' ? '<p class="helper-sm yelp-eligibility-notice"><strong>Local businesses and services.</strong> Yelp is for places customers can visit and businesses offering local services, including mobile providers. Online-only businesses and e-commerce-only stores do not qualify for ordinary business listings. Some remote professional services can qualify when they have local customer interaction. <a href="https://docs.developer.yelp.com/docs/yelp-data-quality-guidelines" target="_blank" rel="noopener noreferrer">Check Yelp eligibility</a>.</p>' : ''}
    ${(p.id === 'fbmarket' ? '<p class="helper-sm marketplace-items-notice"><strong>Items only.</strong> Select Marketplace only when this Blast offers eligible physical items for sale. Services, marketing subscriptions and general company promotions do not qualify as ordinary item listings. Businesses selling products can use it. <a href="https://www.facebook.com/help/130910837313345" target="_blank" rel="noopener noreferrer">Check Marketplace item rules</a>.</p>' : '')}
    <div class="platform-actions">
      ${actionBtn}
      ${p.type !== 'api' ? `<button type="button" class="pcard-dismiss-btn" onclick="dismissPlatform('${p.id}')" title="Remove from list">✕ Not using</button>` : ''}
      ${(function() {
        const platPref = (window._bbPlatPrefs || {})[p.id] || {};
        if (platPref.lastPostedAt) {
          const d = new Date(platPref.lastPostedAt);
          const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return `<span class="badge badge-posted" id="badge-${p.id}">✓ posted ${label}</span>`;
        }
        return `<span class="badge badge-${p.status}" id="badge-${p.id}">● ${p.status}</span>`;
      })()}
    </div>
    ${adaptedText}
  `;
  return div;
}

function renderQuickSelect() {
  renderStep3Platforms();
}

// Default URLs to open for each platform (fallback when user hasn't saved their own)
const PLATFORM_DEFAULT_URLS = {
  google:     'https://business.google.com/',
  facebook:   'https://www.facebook.com/',
  instagram:  'https://www.instagram.com/',
  bing:       'https://www.bingplaces.com/',
  nextdoor:   'https://nextdoor.com/',
  fbmarket:   'https://www.facebook.com/marketplace/create/item',
  craigslist: 'https://post.craigslist.org/',
  yelp:       'https://biz.yelp.com/',
  alignable:  'https://www.alignable.com/',
  thumbtack:  'https://www.thumbtack.com/pro',
  angi:       'https://pro.angi.com/',
  applemaps:  'https://businessconnect.apple.com/',
  linkedin:   'https://www.linkedin.com/feed/',
  x:          'https://x.com/compose/post',
  pinterest:  'https://www.pinterest.com/pin-builder/',
};

// Per-platform setup info shown when a platform accordion is open but not yet enabled
// Per-platform setup info. signup = primary action (always shown). signin = optional second
// button — only included when logging in actually lets you DO something useful on that platform.
const PLATFORM_SETUP = {
  google: {
    signup: { url: 'https://business.google.com/',                    label: 'Claim / Create Your Profile →' },
    // Sign-in not shown — Google prompts auth inline during the claim flow; a bare "Sign In" adds no value
    tip: 'Your Google Business Profile appears in Google Search and Maps when locals look for what you do — the highest-value free listing available.',
  },
  facebook: {
    signup: { url: 'https://www.facebook.com/business/pages/create',  label: 'Create a Facebook Page →' },
    signin: { url: 'https://www.facebook.com/login',                  label: 'Log In to Facebook' },
    tip: 'A Facebook Page gives your business a public presence on the world\'s largest social network. Create yours free in minutes.',
  },
  instagram: {
    signup: { url: 'https://business.instagram.com/',                  label: 'Set Up Business Account →' },
    signin: { url: 'https://www.instagram.com/accounts/login/',       label: 'Log In to Instagram' },
    tip: 'Switch your Instagram to a Business account to reach local customers with photos, Reels, and Stories.',
  },
  bing: {
    signup: { url: 'https://www.bingplaces.com/',                      label: 'Claim Your Bing Listing →' },
    // The claim form handles sign-in inline; a separate "Sign In" button leads nowhere useful
    tip: 'Bing Places is free and reaches millions of Bing and Microsoft users — the claim form walks you through everything in about 5 minutes.',
  },
  nextdoor: {
    signup: { url: 'https://business.nextdoor.com/',                   label: 'Create Business Page →' },
    signin: { url: 'https://nextdoor.com/login/',                     label: 'Log In to Nextdoor' },
    tip: 'Nextdoor connects you directly with paying customers in your own neighborhood. Free business page included.',
  },
  fbmarket: {
    signup: { url: 'https://www.facebook.com/marketplace/',           label: 'Open Facebook Marketplace →' },
    signin: { url: 'https://www.facebook.com/login',                  label: 'Log In to Facebook' },
    tip: 'Marketplace is for eligible physical items you sell. Services, marketing subscriptions and general company promotions do not qualify as ordinary item listings. Use your existing Facebook login; you do not need a separate Marketplace account.',
  },
  craigslist: {
    signup: { url: 'https://accounts.craigslist.org/login/signup',    label: 'Create Craigslist Account →' },
    signin: { url: 'https://accounts.craigslist.org/login',           label: 'Log In to Craigslist' },
    tip: 'Craigslist is one of the most visited local classifieds sites — free to post in most categories. Great for services and local inventory.',
  },
  yelp: {
    signup: { url: 'https://biz.yelp.com/signup',                     label: 'Claim Your Yelp Business →' },
    signin: { url: 'https://biz.yelp.com/login',                      label: 'Log In to Yelp for Business' },
    tip: 'Yelp lists local businesses customers can visit and local service providers, including mobile businesses. Online-only businesses and e-commerce-only stores do not qualify for ordinary listings. Remote professional services need local customer interaction. Check eligibility before creating or claiming a page.',
  },
  alignable: {
    signup: { url: 'https://www.alignable.com/signup',                label: 'Join Alignable →' },
    signin: { url: 'https://www.alignable.com/login',                 label: 'Log In to Alignable' },
    tip: 'Alignable is a local business network built for referrals and community connections — great for word-of-mouth growth.',
  },
  thumbtack: {
    signup: { url: 'https://www.thumbtack.com/pro',                   label: 'Become a Thumbtack Pro →' },
    signin: { url: 'https://www.thumbtack.com/login',                 label: 'Log In to Thumbtack' },
    tip: 'Thumbtack matches you with customers who are actively searching for your exact service in your area.',
  },
  angi: {
    signup: { url: 'https://pro.angi.com/',                           label: 'Become an Angi Pro →' },
    // Angi is a lead-gen enrollment funnel; signing in without being enrolled doesn't unlock anything useful
    tip: 'Angi connects you with homeowners looking for home services — one of the top lead sources for tradespeople and contractors.',
  },
  applemaps: {
    signup: { url: 'https://businessconnect.apple.com/',              label: 'Claim Your Apple Maps Listing →' },
    // Apple ID sign-in happens inline in the claim flow; a bare "Sign In" button adds nothing
    tip: 'Apple Business Connect puts your listing in Apple Maps — seen by every iPhone user searching nearby. Free to claim.',
  },
  linkedin: {
    signup: { url: 'https://www.linkedin.com/company/setup/new/',     label: 'Create a Company Page →' },
    signin: { url: 'https://www.linkedin.com/login',                  label: 'Log In to LinkedIn' },
    tip: 'A LinkedIn Company Page builds credibility and reaches B2B customers, local professionals, and potential hires.',
  },
  x: {
    signup: { url: 'https://x.com/i/flow/signup',                     label: 'Create an X Account →' },
    signin: { url: 'https://x.com/login',                             label: 'Log In to X' },
    tip: 'X (Twitter) keeps your business visible in real-time conversations — great for promotions, local events, and quick updates.',
  },
  pinterest: {
    signup: { url: 'https://business.pinterest.com/',                 label: 'Create Business Account →' },
    signin: { url: 'https://www.pinterest.com/login/',                label: 'Log In to Pinterest' },
    tip: 'Pinterest users are actively planning purchases — especially powerful for home, food, beauty, fashion, and lifestyle businesses.',
  },
};

// Placeholder hints shown in the URL input for each platform
const PLATFORM_URL_HINTS = {
  google:     'e.g. https://business.google.com/dashboard/…',
  facebook:   'e.g. https://www.facebook.com/YourPageName',
  instagram:  'e.g. https://www.instagram.com/youraccount',
  bing:       'Leave blank — opens Bing Places dashboard',
  nextdoor:   'Leave blank — opens Nextdoor feed',
  fbmarket:   'Leave blank — opens Marketplace listing form',
  craigslist: 'Leave blank — opens Craigslist post form',
  yelp:       'e.g. https://biz.yelp.com/biz_info/…',
  alignable:  'e.g. https://www.alignable.com/…',
  thumbtack:  'e.g. https://www.thumbtack.com/profile/…',
  angi:       'e.g. https://pro.angi.com/…',
  applemaps:  'Leave blank — opens Apple Business Connect',
  linkedin:   'e.g. https://www.linkedin.com/company/yourcompany',
};

function renderPlatformPhotoStrip(pid, photos, maxPhotos, displayOnly = false) {
  const container = document.getElementById('qp-photos-' + pid);
  const strip     = document.getElementById('qp-photo-strip-' + pid);
  if (!container || !strip) return;

  const label = container.querySelector('.qp-photos-label');
  if (label) label.textContent = 'Photos: ' + photos.length + ' / ' + maxPhotos;

  BBPhotoHandoff.renderPhotos(strip, pid, photos, displayOnly);

  container.style.display = 'block';
}

function renderAdPostPhotos(p) {
  const selected = window.BBAds?.active?.imageRefs || [];
  const included = BBPlatforms.postImages(p.id, selected);
  window._bbPlatformPhotoSel = window._bbPlatformPhotoSel || {};
  window._bbPlatformPhotoSel[p.id] = new Set(included.map(image => image.url));
  const limit = BBPlatforms.postImageLimit(p.id);
  renderPlatformPhotoStrip(p.id, included, limit, p.type === 'api');
  const note = document.querySelector('#qp-photos-' + p.id + ' .s5-photo-note');
  if (note) note.textContent = 'BlastyBiz includes up to ' + limit + (limit === 1 ? ' photo' : ' photos') + ' for ' + p.name + '. ' + (!included.length
    ? 'No photos selected. Use Add or change photos to choose them.'
    : (p.type === 'api' ? 'These photos will be posted with this copy.' : 'These photos are ready to copy or upload with your post.')
      + (included.length < selected.length ? ' Uses the first ' + included.length + ' of your ' + selected.length + ' selected photos.' : ''));
  if (p.type !== 'api') renderPhotoHandoff(p.id, included);
}

function renderPhotoHandoff(pid, photos) {
  BBPhotoHandoff.renderShare(document.getElementById('qp-share-' + pid), pid, photos,
    () => document.getElementById('qp-copy-text-' + pid)?.textContent?.trim() || '');
}

// Open a platform page in a new tab (uses saved URL or platform default)
window.openPlatformPage = function(pid) {
  const saved = (window._bbPlatformUrls || {})[pid];
  const url = (saved && saved.startsWith('http')) ? saved : (PLATFORM_DEFAULT_URLS[pid] || 'https://google.com');
  window.open(url, '_blank');
};

// Copy AI copy to clipboard + open platform page in new tab — one tap
window.copyAndOpen = async function(pid) {
  const el = document.getElementById('qp-copy-text-' + pid);
  const plat = platforms.find(p => p.id === pid);
  const text = el?.textContent?.trim() || (plat?.adaptedContent || '').replace(/<br\s*\/?\s*>/gi, '\n').trim();
  if (!text) { showToast('Generate or review your copy first.'); return; }
  const name = plat?.name || pid;
  try {
    await navigator.clipboard.writeText(text);
  } catch(e) { showToast('Could not copy your text. Use Copy text and try again.'); return; }
  const saved = (window._bbPlatformUrls || {})[pid];
  const url = (saved && saved.startsWith('http')) ? saved : (PLATFORM_DEFAULT_URLS[pid] || 'https://google.com');
  showToast('📋 Copied! Opening ' + name + '…');
  setTimeout(() => window.open(url, '_blank'), 80);

  // Track copy count and start "Did it post?" prompt on tab return (max 3 prompts per draft+platform)
  const draftId = window._currentDraftId;
  if (draftId) {
    const key = draftId + '_' + pid;
    window._bbManualCopyCount = window._bbManualCopyCount || {};
    window._bbManualCopyCount[key] = (window._bbManualCopyCount[key] || 0) + 1;
    if (window._bbManualCopyCount[key] <= 3) {
      _bbStartManualPostedPrompt(pid, name, draftId);
    }
  }
};

// ── Manual-posted prompt helpers ──────────────────────────────────────────

function _bbStartManualPostedPrompt(pid, platName, draftId) {
  // Remove any active listener for this pid so we don't stack them
  const listenKey = '_bbVisListen_' + pid;
  if (window[listenKey]) {
    document.removeEventListener('visibilitychange', window[listenKey]);
    delete window[listenKey];
  }
  const handler = function() {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', handler);
    delete window[listenKey];
    _bbShowManualPostedPrompt(pid, platName, draftId);
  };
  window[listenKey] = handler;
  document.addEventListener('visibilitychange', handler);
}

function _bbShowManualPostedPrompt(pid, platName, draftId) {
  // Remove any existing prompt for this pid
  document.getElementById('manpost-prompt-' + pid)?.remove();

  // Find the platform card in the main platforms grid
  const card = document.getElementById('pcard-' + pid);
  if (!card) return;

  // Don't prompt if already confirmed for this draft
  if (window._bbManualPostedSet && window._bbManualPostedSet.has(draftId + '_' + pid)) return;

  const prompt = document.createElement('div');
  prompt.id = 'manpost-prompt-' + pid;
  prompt.className = 'manposted-prompt';
  prompt.innerHTML =
    `<span class="manposted-prompt-text">Did you post to <strong>${escHtml(platName)}</strong>?</span>` +
    `<button type="button" class="manposted-yes-btn" onclick="window.confirmManualPosted('${escHtml(pid)}','${escHtml(draftId)}','${escHtml(platName)}')">✓ Yes, posted!</button>` +
    `<button type="button" class="manposted-no-btn" onclick="document.getElementById('manpost-prompt-${escHtml(pid)}')?.remove()">Not yet</button>`;
  card.appendChild(prompt);
}

window.confirmManualPosted = function(pid, draftId, platName) {
  document.getElementById('manpost-prompt-' + pid)?.remove();

  // Record locally so we don't re-prompt
  window._bbManualPostedSet = window._bbManualPostedSet || new Set();
  window._bbManualPostedSet.add(draftId + '_' + pid);

  // Update the badge on the card immediately
  const badge = document.getElementById('badge-' + pid);
  if (badge) {
    badge.className = 'badge badge-posted';
    const label = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    badge.textContent = '✓ posted ' + label;
  }

  const now = new Date().toISOString();

  // Persist manualPosted to draft and lastPostedAt to platformPrefs via module script events
  document.dispatchEvent(new CustomEvent('bb:manualPosted', { detail: { pid, draftId, postedAt: now } }));

  window._bbPlatPrefs = window._bbPlatPrefs || {};
  window._bbPlatPrefs[pid] = { ...(window._bbPlatPrefs[pid] || {}), lastPostedAt: now };
  document.dispatchEvent(new CustomEvent('bb:savePlatPrefs', { detail: { prefs: window._bbPlatPrefs } }));

  showToast('✓ Marked as posted on ' + (platName || pid) + '!');
};

// ── Platform dismiss / restore ─────────────────────────────────────────────

window.dismissPlatform = function(pid) {
  window._bbPlatPrefs = window._bbPlatPrefs || {};
  window._bbPlatPrefs[pid] = { ...(window._bbPlatPrefs[pid] || {}), status: 'dismissed' };
  renderPlatforms();
  renderQuickSelect();
  document.dispatchEvent(new CustomEvent('bb:savePlatPrefs', { detail: { prefs: window._bbPlatPrefs } }));
};

window.restorePlatform = function(pid) {
  window._bbPlatPrefs = window._bbPlatPrefs || {};
  window._bbPlatPrefs[pid] = { ...(window._bbPlatPrefs[pid] || {}), status: 'active' };
  renderPlatforms();
  renderQuickSelect();
  document.dispatchEvent(new CustomEvent('bb:savePlatPrefs', { detail: { prefs: window._bbPlatPrefs } }));
};

function togglePlatformPhoto(pid, url, maxPhotos, photos) {
  if (!window._bbPlatformPhotoSel[pid]) window._bbPlatformPhotoSel[pid] = new Set();
  const sel = window._bbPlatformPhotoSel[pid];
  if (sel.has(url)) {
    sel.delete(url);
  } else {
    if (sel.size >= maxPhotos) {
      if (maxPhotos === 1) {
        sel.clear(); // single-select: replace
      } else {
        showToast('Max ' + maxPhotos + ' photos for this platform');
        return;
      }
    }
    sel.add(url);
  }
  renderPlatformPhotoStrip(pid, photos, maxPhotos);
}

function copyQpText(pid) {
  const el = document.getElementById('qp-copy-text-' + pid);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent)
    .then(() => showToast('📋 Copied!'))
    .catch(() => showToast('❌ Copy failed'));
}

async function saveCopyToLibrary(pid) {
  if (!activeCampaignId) {
    showToast('Select a campaign first');
    return;
  }
  const el = document.getElementById('qp-copy-text-' + pid);
  if (!el || !el.textContent.trim()) {
    showToast('Generate copy first');
    return;
  }
  const platform = platforms.find(p => p.id === pid);
  const copy = el.textContent.trim();
  const offer = document.getElementById('biz-offer')?.value?.trim() || '';
  const adName = document.getElementById('biz-ad-name')?.value?.trim() || '';
  const tone = profile.tone || 'friendly';

  const saveBtn = document.querySelector(`button[onclick="saveCopyToLibrary('${pid}')"]`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳'; }

  try {
    if (!window._bbSaveLibraryItem) throw new Error('Library save not ready');
    await window._bbSaveLibraryItem({
      platformId: pid,
      platformName: platform ? platform.name : pid,
      copy,
      campaignId: activeCampaignId,
      campaignName: activeCampaignName,
      adName,
      offer,
      tone,
      savedAt: new Date().toISOString(),
    });
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✅ Saved'; }
    setTimeout(() => { if (saveBtn) saveBtn.textContent = '💾 Save'; }, 2000);
    showToast('💾 Saved to library!');
  } catch (e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save'; }
    showToast('❌ Save failed: ' + (e.message || 'unknown'));
  }
}

async function approvePlatformCopy(pid) {
  if (window._bbAdaptationBusy || generatedDraftSaving) return;
  if (window._bbDraftSavePending) { showToast('Save your generated copy with Retry save first.'); return; }
  const selection = postRewriteKey();
  const el = document.getElementById('qp-copy-text-' + pid);
  const copy = (el?.innerText || el?.textContent || '').replace(/[ \t]+/g, ' ').trim();
  if (!copy) { showToast('Copy cannot be blank — edit it first'); return; }

  // Guard against double-click
  const lgtmBtn = document.getElementById('step5-lgtm-' + pid);
  if (lgtmBtn && lgtmBtn.dataset.saving === '1') return;
  if (lgtmBtn) { lgtmBtn.dataset.saving = '1'; lgtmBtn.disabled = true; lgtmBtn.textContent = '⏳ Saving…'; }

  // 1. Write edited text into in-memory state
  const normalized = copy.replace(/\n/g, '<br/>');
  platforms = platforms.map(p => p.id === pid
    ? { ...p, adaptedContent: normalized, _reviewStatus: 'approved' }
    : p);
  savePlatforms();

  // 2. Persist to Firestore draft — must succeed before advancing
  const draftId = window._currentDraftId;
  if (window.BBAds?.active || (draftId && window._bbUpdateDraft)) {
    try {
      const adaptKey = 'adaptations.' + pid;
      if (window.BBAds?.active) await window.BBAds.save();
      if (selection !== postRewriteKey()) return;
      if (draftId && window._bbUpdateDraft) await window._bbUpdateDraft(draftId, { [adaptKey]: copy, ['platformStatus.' + pid]: 'approved' });
    } catch(e) {
      if (selection !== postRewriteKey()) return;
      showToast('⚠️ Could not save draft — try again');
      platforms = platforms.map(p => p.id === pid
        ? { ...p, _reviewStatus: undefined }
        : p);
      if (lgtmBtn) { delete lgtmBtn.dataset.saving; lgtmBtn.disabled = false; lgtmBtn.textContent = '✓ Looks good — next'; }
      return;
    }
  }

  if (selection !== postRewriteKey()) return;
  // 3. Archive to Copy Library on every plan — non-blocking, failure warns but doesn't block approval
  const plan = window._bbUserPlan || 'starter';
  if (window._bbSaveLibraryItem) {
    const platform = platforms.find(p => p.id === pid);
    const offer  = document.getElementById('biz-offer')?.value?.trim() || '';
    const adName = document.getElementById('biz-ad-name')?.value?.trim() || '';
    const tone   = profile.tone || 'friendly';
    window._bbSaveLibraryItem({
      platformId:   pid,
      platformName: platform ? platform.name : pid,
      copy,
      campaignId:   activeCampaignId,
      campaignName: activeCampaignName,
      adName, offer, tone,
      savedAt: new Date().toISOString(),
    }).catch(() => showToast('⚠️ Library archive failed — copy is approved'));
  }

  // 4. Update pill + button
  const pill = document.getElementById('step5-pill-' + pid);
  if (pill) { pill.textContent = '✓ Approved'; pill.className = 'step5-status-pill approved'; }
  if (lgtmBtn) { delete lgtmBtn.dataset.saving; lgtmBtn.disabled = false; lgtmBtn.textContent = '✓ Approved'; lgtmBtn.classList.add('approved'); }
  updateStep5UI();

  // 5. Advance to next unresolved platform — look forward first, then backward
  const enabled = getStep5Platforms();
  let nextIdx = enabled.findIndex((p, i) => i > _step5PlatIdx && p._reviewStatus !== 'approved' && p._reviewStatus !== 'skipped');
  if (nextIdx === -1) nextIdx = enabled.findIndex((p, i) => i < _step5PlatIdx && p._reviewStatus !== 'approved' && p._reviewStatus !== 'skipped');
  if (nextIdx !== -1) setTimeout(() => step5GoTo(nextIdx), 350);
}

async function excludePlatform(pid) {
  const platform = platforms.find(p => p.id === pid);
  const name = platform?.name || pid;
  const priorStatus = platform?._reviewStatus;

  // Optimistically update in-memory + show saving state before the write
  platforms = platforms.map(p => p.id === pid ? { ...p, _reviewStatus: 'skipped' } : p);
  savePlatforms();
  const pill = document.getElementById('step5-pill-' + pid);
  if (pill) { pill.textContent = '⏳ Saving…'; pill.className = 'step5-status-pill'; }

  // Await the Firestore write — navigation is blocked until it resolves
  const draftId = window._currentDraftId;
  if (window.BBAds?.active || (draftId && window._bbUpdateDraft)) {
    try {
      if (window.BBAds?.active) await window.BBAds.save();
      await window._bbUpdateDraft(draftId, { ['platformStatus.' + pid]: 'excluded' });
    } catch (e) {
      // Rollback: restore prior status and show error — do not advance
      platforms = platforms.map(p => p.id === pid ? { ...p, _reviewStatus: priorStatus } : p);
      savePlatforms();
      if (pill) {
        pill.textContent = priorStatus === 'approved' ? 'Approved' : 'Needs Review';
        pill.className = 'step5-status-pill' + (priorStatus === 'approved' ? ' approved' : ' needs-review');
      }
      showToast('❌ Exclude failed — check connection and try again');
      return;
    }
  }

  if (pill) { pill.textContent = '— Skipped'; pill.className = 'step5-status-pill'; }
  updateStep5UI();
  showToast('"' + name + '" excluded from this blast');
  const enabled = getStep5Platforms();
  let nextIdx = enabled.findIndex((p, i) => i > _step5PlatIdx && p._reviewStatus !== 'approved' && p._reviewStatus !== 'skipped');
  if (nextIdx === -1) nextIdx = enabled.findIndex((p, i) => i < _step5PlatIdx && p._reviewStatus !== 'approved' && p._reviewStatus !== 'skipped');
  if (nextIdx !== -1) setTimeout(() => step5GoTo(nextIdx), 350);
}

async function openLibraryModal() {
  if (!activeCampaignId) { showToast('Select a campaign first'); return; }

  const modal = document.getElementById('library-modal');
  const title = document.getElementById('library-modal-title');
  const body  = document.getElementById('library-modal-body');
  if (!modal) return;

  if (title) title.textContent = '📚 ' + (activeCampaignName || 'Campaign') + ' — Copy Library';
  if (body)  body.innerHTML = '<div class="lib-loading">Loading…</div>';
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    if (!window._bbLoadLibrary) throw new Error('Library not ready');
    const items = await window._bbLoadLibrary(activeCampaignId);
    renderLibraryItems(items);
  } catch (e) {
    if (body) body.innerHTML = '<div class="lib-error">Failed to load: ' + escHtml(e.message) + '</div>';
  }
}

function closeLibraryModal() {
  const modal = document.getElementById('library-modal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

function filterLibraryByPlatform(platformId) {
  const filterSel = document.getElementById('lib-platform-filter');
  const allItems  = filterSel ? filterSel._allItems : null;
  if (allItems) renderLibraryItems(allItems, platformId);
}

function renderLibraryItems(items, filterPlatformId) {
  const body = document.getElementById('library-modal-body');
  if (!body) return;

  // #7 Platform filter — build dropdown when items span 2+ platforms
  const filterRow = document.getElementById('lib-filter-row');
  const filterSel = document.getElementById('lib-platform-filter');
  if (filterRow && filterSel) {
    const uniquePlatforms = [...new Map(items.map(i => [i.platformId, i])).values()];
    if (uniquePlatforms.length >= 2) {
      filterRow.style.display = 'block';
      const prev = filterSel.value;
      filterSel.innerHTML = '<option value="">All platforms</option>' +
        uniquePlatforms.map(i => `<option value="${escHtml(i.platformId||'')}"${prev===(i.platformId||'')?'  selected':''}>${escHtml(i.platformName||i.platformId||'Other')}</option>`).join('');
      filterSel._allItems = items;
      if (!filterPlatformId) filterPlatformId = prev;
    } else {
      filterRow.style.display = 'none';
    }
  }

  const displayItems = filterPlatformId ? items.filter(i => i.platformId === filterPlatformId) : items;

  if (!displayItems || displayItems.length === 0) {
    body.innerHTML = `
      <div class="lib-empty">
        <div class="lib-empty-icon">📭</div>
        <div class="lib-empty-title">${filterPlatformId ? 'No saved copy for this platform' : 'No saved copy yet'}</div>
        <div class="lib-empty-sub">${filterPlatformId ? 'Try a different platform filter above' : 'Generate AI copy and tap 💾 Save in any platform accordion'}</div>
      </div>`;
    return;
  }
  // Group by platform (use filtered set)
  const grouped = {};
  displayItems.forEach(item => {
    const key = item.platformId || 'other';
    if (!grouped[key]) grouped[key] = { name: item.platformName || key, items: [] };
    grouped[key].items.push(item);
  });

  let html = '';
  Object.values(grouped).forEach(group => {
    html += `<div class="lib-group">
      <div class="lib-group-name">${escHtml(group.name)}</div>`;
    group.items.sort((a,b) => (b.savedAt||'').localeCompare(a.savedAt||'')).forEach(item => {
      const date = item.savedAt ? new Date(item.savedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
      const adLabel = item.adName ? escHtml(item.adName) : (item.offer ? escHtml(item.offer.slice(0,40) + (item.offer.length>40?'…':'')) : '');
      html += `
        <div class="lib-item">
          <div class="lib-item-header">
            <div class="lib-item-meta">${adLabel} ${date ? '· ' + date : ''}</div>
            <div class="lib-item-actions">
              <button type="button" onclick="copyLibItem(this)"
                data-copy="${escHtml(item.copy)}"
                class="lib-action-btn">📋 Copy text</button>
              <button type="button" onclick="deleteLibraryItem('${escHtml(item.docId)}')"
                class="lib-delete-btn">🗑</button>
            </div>
          </div>
          <div class="lib-copy-text">${escHtml(item.copy)}</div>
        </div>`;
    });
    html += '</div>';
  });
  body.innerHTML = html;
}

function copyLibItem(btn) {
  const text = btn.getAttribute('data-copy') || '';
  navigator.clipboard.writeText(text).then(() => showToast('📋 Copied!'));
}

async function deleteLibraryItem(docId) {
  if (!docId || !window._bbDeleteLibraryItem) return;
  try {
    await window._bbDeleteLibraryItem(docId);
    // Refresh modal
    const items = await window._bbLoadLibrary(activeCampaignId);
    renderLibraryItems(items);
    showToast('🗑 Deleted');
  } catch(e) {
    showToast('❌ Delete failed');
  }
}

async function regeneratePlatformCopy(pid, direction = 'Rewrite this post while preserving its facts and meaning.') {
  if (window._bbAdaptationBusy || window._bbDraftSavePending) return;
  direction = String(direction || '').trim();
  if (!direction || direction.length > 1000) { showToast('Add a direction of up to 1,000 characters.'); return; }
  const selection = postRewriteKey();
  window._bbAdaptationBusy = true;
  let startedEmpty = false;
  try {
    await flushCampaignMemoryEdits(); await window.BBAds.ready(); await window.BBAds.save();
    if (selection !== postRewriteKey()) return;
    const platform = platforms.find(p => p.id === pid && p.enabled);
    if (!platform) return;
    const previousContent = platform.adaptedContent || '';
    startedEmpty = !previousContent;
    if (startedEmpty) { _bbMarkGenerating([pid]); renderStep5Review(); }
    setPostRewriteBusy(pid, true);
    updateStep5UI();
  // Build full dossier — same context as runAdaptation
  const name        = profile.sellerType==='personal'?BBSetup.mentionedName(profile,ynState):(profile.name||'');
  const category    = profile.category || '';
  const phone       = ynState.phone   !== 'no' ? (profile.phone   || '') : '';
  const email       = ynState.email   !== 'no' ? (profile.email   || '') : '';
  const website     = ynState.website !== 'no' ? (profile.website || '') : '';
  const hours       = profile.hours    || '';
  const effLocType  = profile.locationType || 'physical';
  const address = profile.sellerType==='personal' ? '' : ((effLocType === 'physical' || effLocType === 'both') && ynState.address !== 'no' ? BBSetup.locationText(profile.address) : '');
  const region = profile.sellerType==='personal' ? BBSetup.formatArea(window.BBAds?.active||{}) : (effLocType === 'both' ? BBSetup.locationText(profile.region) : '');
  const offer       = document.getElementById('biz-offer')?.value?.trim() || document.getElementById('ad-context')?.value?.trim() || document.getElementById('campaign-context')?.value?.trim() || activeCampaignName || '';
  const price       = document.getElementById('biz-price')?.value?.trim() || '';
  const tone        = profile.tone || 'friendly';
  const adName      = document.getElementById('biz-ad-name')?.value?.trim() || '';
  const includeName = BBSetup.mentionedName(profile,ynState);
  const includeRole = ynState.role === 'yes' && profile.ownerRole;
  const featuredPhotoUrl = (window._bbSelectedPhotoIndex !== null && window._bbPhotoItems)
    ? (window._bbPhotoItems[window._bbSelectedPhotoIndex]?.url || '') : '';

    const idToken = window._bbGetToken ? await window._bbGetToken() : null;
    if (selection !== postRewriteKey()) return;
    const authHeaders = idToken
      ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken }
      : { 'Content-Type': 'application/json' };

    const response = await _bbFetchWithTimeout('https://us-central1-blastybiz-9523e.cloudfunctions.net/adaptListing', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        listing: { sellerType:profile.sellerType || 'business', name, category, offer, price, phone, email, address, region, locationType: effLocType,
          website, hours, ownerName: includeName, mentions:BBSetup.mentions(ynState), adName,
          campaignName: activeCampaignName || '',
          adContext: document.getElementById('ad-context')?.value || '',
          cta: document.getElementById('ad-cta')?.value || '',
          imageCount: (window._bbPhotoItems||[]).filter(p=>p.done).length,
          featuredPhotoUrl,
          campaignContext: document.getElementById('campaign-context')?.value?.trim() || '',
          bizInsights: (bizInsights||[]).filter(i=>i.answer),
          globalFactoids: window._globalFactoids || [],
          campaignFactoids: (campaigns.find(c=>c.id===activeCampaignId)||{}).factoids || [],
          aiContext: profile.aiContext || null,
          ...(_getAIMemory()),
          libraryDocs: window._libraryDocs || [],
          businessId: window.activeBizId || '',  // required for server free-regen draftRef
          campaignId:activeCampaignId||null,adId:window.BBAds?.active?.id||null,
          requestId: crypto.randomUUID(),  // fresh ID per regen — ensures new AI output, not cached
        },
        platforms: [{ id: platform.id, name: platform.name, type: platform.type, enabled: true }],
        tone,
        platformCats: profile.platformCats || {},
        isRegeneration: true,
        rewrite: previousContent ? { source: postPlainText(previousContent), direction } : undefined,
        draftId: window._currentDraftId || '',
        ownerMention: (includeName || includeRole)
          ? [includeName || null,
             includeRole ? (profile.ownerRole === 'manager' ? 'Manager' : profile.ownerRole === 'other' ? profile.ownerRole : 'Owner') : null]
              .filter(Boolean).join(', ')
          : null
      })
    });


    if (!response.ok) { const failure = await response.json().catch(()=>({})); throw new Error(failure.error || 'Rewrite unavailable. Try again.'); }
    const parsed = await response.json();
    const newText = (parsed.adaptations || {})[pid];
    if (typeof newText !== 'string' || !newText.trim()) throw new Error('No copy returned. Try again.');
    if (selection !== postRewriteKey()) return;
    if (postPlainText(platforms.find(p=>p.id===pid)?.adaptedContent) !== postPlainText(previousContent)) {
      showToast('Your copy changed while rewriting. Your latest edits were kept.'); return;
    }
    // Temporary Undo belongs to this selected Ad, never to a second content store.
    if (previousContent) _bbRewriteUndo.set(pid, { selection, before: previousContent, after: newText });
    applyPostCopy(pid, newText);
    window.BBAds.markDirty();
    renderStep5Review();
    if (!await retryGeneratedDraftSave()) return;
    if (selection === postRewriteKey()) showToast('Copy updated for ' + platform.name + (parsed.freeRegenApplied === true ? ' (free).' : '.'));
  } catch (err) {
    showToast(err.message || 'Rewrite failed. Try again.');
  } finally {
    window._bbAdaptationBusy = false;
    if (startedEmpty) _bbClearGenerating([pid]);
    getStep5Platforms().forEach(p=>setPostRewriteBusy(p.id, false));
    if (startedEmpty && selection === postRewriteKey()) renderStep5Review();
    updateStep5UI();
  }
}

var _bbRewriteUndo = new Map();
function postPlainText(value) { return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n'); }
function postRewriteKey() { return JSON.stringify([window.activeBizId, activeCampaignId, window.BBAds?.active?.id, window.BBAds?.selectionKey]); }
function resetPostRewriteState() { _bbRewriteUndo.clear(); }
function invalidatePostRewriteUndo(pid) { _bbRewriteUndo.delete(pid); document.getElementById('qp-undo-'+pid)?.setAttribute('hidden',''); }
function postUndoAvailable(pid) {
  const previous = _bbRewriteUndo.get(pid);
  return previous && previous.selection === postRewriteKey() && postPlainText(previous.after) === postPlainText(platforms.find(p=>p.id===pid)?.adaptedContent);
}
function applyPostCopy(pid, text) {
  platforms = platforms.map(p=>p.id===pid ? {...p, adaptedContent:text, status:'ready', _reviewStatus:'needs-review'} : p);
  const copy = document.getElementById('qp-copy-text-'+pid); if (copy) copy.textContent = postPlainText(text);
  savePlatforms();
}
async function undoPlatformCopy(pid) {
  if (window._bbAdaptationBusy || generatedDraftSaving || !postUndoAvailable(pid)) return;
  const previous = _bbRewriteUndo.get(pid);
  _bbRewriteUndo.delete(pid);
  applyPostCopy(pid, previous.before);
  window.BBAds.markDirty();
  renderStep5Review();
  if (await retryGeneratedDraftSave()) showToast('Previous copy restored.');
}
function rewriteWithDirection(pid) {
  return regeneratePlatformCopy(pid, document.getElementById('qp-direction-'+pid)?.value);
}
function setPostRewriteBusy(pid, busy) {
  const card = document.getElementById('step5-card-'+pid);
  card?.classList.toggle('is-rewriting',busy);
  card?.setAttribute('aria-busy',String(busy));
  card?.querySelectorAll('button,textarea').forEach(button=>button.disabled=busy);
  const copy=document.getElementById('qp-copy-text-'+pid);
  if(copy)copy.contentEditable=busy?'false':'true';
  const status=document.getElementById('qp-rewrite-status-'+pid);if(status)status.textContent=busy?'Rewriting…':'';
}

function saveStepCat(pid, val) {
  if (!profile.platformCats) profile.platformCats = {};
  profile.platformCats[pid] = val;
  const preview = document.getElementById('qp-cat-preview-' + pid);
  if (preview) { preview.textContent = val; preview.style.display = 'block'; }
  const profSel = document.getElementById('prof-pcat-' + pid);
  if (profSel) profSel.value = val;
  savePlatformCatsToFirestore(profile.platformCats);
}

function addCustomStepCat(pid) {
  const inp = document.getElementById('qp-custom-' + pid);
  const sel = document.getElementById('qp-cat-' + pid);
  if (!inp || !sel) return;
  const val = inp.value.trim();
  if (!val) return;
  const opt = document.createElement('option');
  opt.value = val; opt.textContent = val; opt.selected = true;
  sel.appendChild(opt);
  inp.value = '';
  saveStepCat(pid, val);
  showToast('✓ Category added');
}

// ══════════════════════════════════════════
// AI PLATFORM SUGGESTIONS
// Calls suggestPlatforms CF — Claude picks which platforms suit this business.
// User can override any toggle after suggestions are applied.
// ══════════════════════════════════════════
async function suggestPlatformsAI() {
  const btn  = document.getElementById('ai-suggest-btn');
  const note = document.getElementById('ai-suggest-note');
  const name        = document.getElementById('biz-name')?.value?.trim()     || '';
  const category    = document.getElementById('biz-category')?.value?.trim() || '';
  const description = document.getElementById('biz-offer')?.value?.trim()    || '';

  if (!name && !category && !description) {
    showToast('⚠️ Fill in business name, category, or description first');
    return;
  }

  if (btn) { btn.textContent = '⏳ Asking AI…'; btn.disabled = true; }

  try {
    const token = window._bbGetToken ? await window._bbGetToken() : null;
    if (!token) throw new Error('Not signed in');

    const website = document.getElementById('biz-website')?.value?.trim() || '';

    const resp = await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/suggestPlatforms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name, category, description, locationType, website,businessId:window.activeBizId,campaignId:activeCampaignId||null,adId:window.BBAds?.active?.id||null }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'Suggestion failed (' + resp.status + ')');
    }

    const data = await resp.json();
    const suggestions = data.suggestions || {};

    platformReasons = {};
    platforms = platforms.map(p => {
      const s = suggestions[p.id];
      if (s) {
        platformReasons[p.id] = s.reason || '';
        return { ...p, enabled: !!s.enabled && platformEligible(p) };
      }
      return p;
    });

    savePlatforms();
    renderPlatforms();
    renderQuickSelect();
    updateStats();
    checkAdaptBtn();
    if (note) note.classList.remove('hidden');
    showToast('✨ AI suggestions applied — adjust any toggle if needed');

  } catch(e) {
    console.error('suggestPlatformsAI error:', e);
    showToast('⚠️ ' + (e.message || 'AI suggestion failed'));
  } finally {
    if (btn) { btn.innerHTML = '✨ Get AI Platform Suggestions'; btn.disabled = false; }
  }
}

// ══════════════════════════════════════════
// TOGGLE PLATFORM
// ══════════════════════════════════════════
function toggleSelectAll() {
  const allOn = platforms.filter(platformEligible).every(p => p.enabled);
  platforms = platforms.map(p => ({ ...p, enabled: !allOn && platformEligible(p) }));
  savePlatformSelections();
  savePlatforms();
  renderPlatforms();
  renderQuickSelect();
  checkAdaptBtn();
}

function _updateSelectAllBtn() {
  const btn = document.getElementById('select-all-btn');
  if (!btn) return;
  const allOn = platforms.filter(platformEligible).every(p => p.enabled);
  btn.textContent = allOn ? 'Deselect All' : 'Select All';
}

function togglePlatform(id, val) {
  window.BBAds?.markDirty();
  platforms = platforms.map(p => p.id === id ? {...p, enabled: val && platformEligible(p)} : p);
  savePlatformSelections();
  savePlatforms();
  renderPlatforms();
  renderQuickSelect();
  checkAdaptBtn();
}

// ══════════════════════════════════════════
// CHAR COUNTER
// ══════════════════════════════════════════
function countChars(el, counterId, max) {
  const len = el.value.length;
  const span = document.getElementById(counterId);
  span.textContent = len + ' / ' + max;
  span.className = 'char-count' + (len > max ? ' over' : len > max * 0.85 ? ' warn' : '');
  saveDraft();
  checkAdaptBtn();
}

// ══════════════════════════════════════════
// ADAPT BUTTON CHECK
// ══════════════════════════════════════════
function checkAdaptBtn() {
  applyPlatformEligibility();
  const btn = document.getElementById('adapt-btn');
  if (btn) btn.disabled = !platforms.some(p => p.enabled);
  checkS3ContinueBtn();
}

function goToStep2() { createWizGoTo(3); }
function goToStep1() { createWizGoTo(1); }

// ══════════════════════════════════════════
// BLAST CREATION WIZARD
// ══════════════════════════════════════════
let createWizStep = 1;
// ── Single source of truth for wizard pages ──────────────────────────────────
// To add/remove a page: update SLIDE_IDS (order) and SLIDE_TITLES (name).
// Step numbers, progress fill, and dots are all derived — nothing else to touch.
const SLIDE_IDS   = [1, 5];
const SLIDE_TITLES = {
  1: 'Your Blast',
  5: 'Review & Approve'
};

function createWizGoTo(step, generate = false, options = {}) {
  if (!SLIDE_IDS.includes(step)) step = SLIDE_IDS[0];
  // Some callers jump straight into a wizard step without going through
  // showTab(), which showed the Create screen while another tab stayed
  // highlighted. Entering the wizard owns the tab strip too.
  const _cwSection = document.getElementById('section-create');
  if (_cwSection && !_cwSection.classList.contains('active')) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    _cwSection.classList.add('active');
  }
  const _cwTab = document.getElementById('tab-create');
  if (_cwTab && !_cwTab.classList.contains('active')) {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    _cwTab.classList.add('active');
    _cwTab.setAttribute('aria-selected', 'true');
  }

  const stepNum  = SLIDE_IDS.indexOf(step) + 1;   // 1-based position
  const total    = SLIDE_IDS.length;
  for (const id of SLIDE_IDS) {
    const slide = document.getElementById('create-slide-' + id);
    if (slide) slide.classList.remove('cwiz-active');
    const dot = document.getElementById('cwiz-dot-' + id);
    if (dot) {
      const dotNum = SLIDE_IDS.indexOf(id) + 1;
      dot.classList.remove('cwiz-active', 'cwiz-done');
      if (dotNum < stepNum)       dot.classList.add('cwiz-done');
      else if (dotNum === stepNum) dot.classList.add('cwiz-active');
    }
  }
  const target = document.getElementById('create-slide-' + step);
  if (target) target.classList.add('cwiz-active');
  const labelEl = document.getElementById('create-wiz-label');
  if (labelEl) labelEl.textContent = stepNum > 0 ? 'Step ' + stepNum + ' of ' + total + ' — ' + (SLIDE_TITLES[step] || '') : '';
  const fillEl = document.getElementById('create-progress-fill');
  if (fillEl) fillEl.style.width = Math.round((stepNum / total) * 100) + '%';
  createWizStep = step;
  if (options.record !== false) window._bbRecordWorkspaceRoute?.();
  if (options.scroll !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
  if (step === 1) {
    renderStep3Platforms();
    checkAdaptBtn();
    checkS3ContinueBtn();
    updateCopyPreview();
  }
  if (step === 5) {
    // Start at the first unresolved platform, not always index 0
    const _s5enabled = platforms.filter(p => p.enabled);
    const _s5firstUnresolved = _s5enabled.findIndex(p => p._reviewStatus !== 'approved' && p._reviewStatus !== 'skipped');
    _step5PlatIdx = _s5firstUnresolved >= 0 ? _s5firstUnresolved : 0;
    // Viewing and navigation never generate; only an explicit generation action does.
    // runAdaptation owns loading state after validating the selected Ad.
    renderStep5Review();
    if (generate) runAdaptation();
  }
}

function openCampaignPhotos() {
  createWizGoTo(1);
  setPhotoScope('campaign');
  document.getElementById('campaign-photos')?.scrollIntoView({behavior:'smooth',block:'start'});
}

async function createWizNext(fromStep, generate = false) {
  if (fromStep === 1) {
    try { await window.BBAds?.ready(); } catch(e) { showToast(e.message); return; }
    if (!generate && !platforms.some(p => p.enabled && p.adaptedContent)) { showToast('No saved copy is available for these platforms yet. Use Generate New Copy.'); return; }
    const offer = document.getElementById('biz-offer')?.value?.trim();
    if (!offer && !document.getElementById('ad-context')?.value.trim() && !document.getElementById('campaign-context')?.value.trim() && !activeCampaignName) { showToast('Tell Blasty what you are promoting first'); return; }
    if (!platforms.some(p => p.enabled)) { showToast('Select at least one platform first'); return; }
    if ([...window._bbPhotoUploads].some(i => i.bizId === window.activeBizId && i.campaignId === activeCampaignId && !i.error)) { showToast('Your photos are still uploading. Continue when they finish.'); return; }
    saveDraft();
    clearTimeout(_campaignSaveTimer);
    try { await window.BBAds.save(); } catch(e) { showToast('Your changes were not saved: ' + e.message); return; }
  }
  // Page 2 starts at step 5
  const nextStep = fromStep === 1 ? 5 : fromStep + 1;
  createWizGoTo(nextStep, generate);
}

function createWizPrev(fromStep) {
  const prevStep = fromStep === 5 ? 1 : fromStep - 1;
  createWizGoTo(Math.max(1, prevStep));
}

function toggleAboutYouPanel() {
  const panel   = document.getElementById('about-you-panel');
  const chevron = document.getElementById('about-you-chevron');
  if (!panel) return;
  const isOpen = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isOpen);
  if (chevron) chevron.classList.toggle('open', !isOpen);
}

// ══════════════════════════════════════════
// STEP 3: CLEAN PLATFORM SELECTION ROWS
// ══════════════════════════════════════════
function renderStep3Platforms() {
  applyPlatformEligibility();
  const el = document.getElementById('quick-platform-list');
  if (!el) return;
  el.innerHTML = '';
  platforms.forEach(p => {
    if (!platformEligible(p)) return;
    const isApi = p.type === 'api';

    const row = document.createElement('div');
    row.className = 's3-plat-row';
    row.id = 's3-row-' + p.id;
    row.innerHTML =
      '<div class="s3-plat-icon bb-style-1c28b7a8">' + p.icon + '</div>'
      + '<div class="s3-plat-meta">'
      +   '<div class="s3-plat-name">' + escHtml(p.name) + '</div>'
      +   '<div class="s3-plat-badge' + (isApi ? ' api' : '') + '">'
      +     escHtml(window._bbPlatformReadiness?.(p).label || (isApi ? 'Checking connection' : 'You post it'))
      +   '</div>'
      + (p.id === 'fbmarket' ? '<p class="helper-sm marketplace-items-notice"><strong>Items only.</strong> Select Marketplace only when this Blast offers eligible physical items for sale. Services, marketing subscriptions and general company promotions do not qualify as ordinary item listings. Businesses selling products can use it. <a href="https://www.facebook.com/help/130910837313345" target="_blank" rel="noopener noreferrer">Check Marketplace item rules</a>.</p>' : '')
      + (p.id === 'yelp' ? '<p class="helper-sm yelp-eligibility-notice"><strong>Local businesses and services.</strong> Yelp is for places customers can visit and businesses offering local services, including mobile providers. Online-only businesses and e-commerce-only stores do not qualify for ordinary business listings. Some remote professional services can qualify when they have local customer interaction. <a href="https://docs.developer.yelp.com/docs/yelp-data-quality-guidelines" target="_blank" rel="noopener noreferrer">Check Yelp eligibility</a>.</p>' : '')
      + (isApi ? '<button type="button" class="readiness-action" onclick="window._bbOpenConnections()">Manage connection</button>' : '')
      + '</div>'
      + '<label class="toggle" onclick="event.stopPropagation()">'
      +   '<input type="checkbox"' + (p.enabled ? ' checked' : '') + ' onchange="togglePlatform(\'' + escHtml(p.id) + '\', this.checked)" />'
      +   '<span class="toggle-slider"></span>'
      + '</label>';
    el.appendChild(row);
  });
  checkS3ContinueBtn();
  _updateSelectAllBtn();
}

function checkS3ContinueBtn() {
  const btn = document.getElementById('s3-continue-btn');
  if (btn) btn.disabled = !platforms.some(p => p.enabled);
  const saved = document.getElementById('s3-saved-copy-btn');
  if (saved) {
    const hasSavedCopy = platforms.some(p => p.enabled && window.BBAds?.active?.adaptations?.[p.id]?.trim());
    if (btn) btn.textContent = platforms.some(p=>p.enabled&&p.adaptedContent) ? 'Review My Blast →' : 'Generate My Blast →';
    saved.hidden = !hasSavedCopy;
    saved.disabled = !hasSavedCopy;
    saved.classList.toggle('hidden', !hasSavedCopy);
  }
  const guidance=document.getElementById('blast-guidance');
  if(guidance){
    const selected=platforms.filter(p=>p.enabled),saved=selected.filter(p=>p.adaptedContent).length;
    const photos=window.BBAds?.active?.imageRefs?.length||0;
    const missing=selected.filter(p=>window._bbPlatformReadiness?.(p).state==='connection').length;
    guidance.textContent=selected.length ? selected.length+' destinations · '+photos+' saved photos. '+(saved ? 'Your saved copy and choices are ready to reuse. '+(selected.length-saved ? (selected.length-saved)+' still need copy. ' : '') : 'Generate copy when your details are ready. ')+(missing ? missing+' need a connection before auto-posting.' : '') : 'Choose at least one destination in Send To above.';
  }
}

// ══════════════════════════════════════════
// STEP 5: PER-PLATFORM REVIEW
// ══════════════════════════════════════════
let _step5PlatIdx = 0;

function getStep5Platforms() {
  return platforms.filter(p => p.enabled && platformEligible(p));
}

// Bring a platform's review card into view and treat it as the current one.
// Open the requested review while the other platforms remain compact summaries.
// Successful approval advances through the existing unresolved-platform flow.
function step5GoTo(idx) {
  const enabled = getStep5Platforms();
  if (!enabled.length) return;
  _step5PlatIdx = Math.max(0, Math.min(idx, enabled.length - 1));
  const card = document.getElementById('step5-card-' + enabled[_step5PlatIdx].id);
  if (!card) return;
  card.open = true;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
}

function renderStep5Review() {
  const container = document.getElementById('step5-review-container');
  if (!container) return;
  const enabled = getStep5Platforms();
  if (!enabled.length) {
    container.innerHTML = '<div class="helper bb-style-17e909ef">No platforms selected. Go back and pick at least one.</div>';
    updateStep5UI();
    return;
  }
  if (_step5PlatIdx >= enabled.length) _step5PlatIdx = 0;
  const openId = container.querySelector('details.step5-review-card[open]')?.id;
  const firstRender = !container.children.length;
  const directions = new Map([...container.querySelectorAll('.s5-rewrite-details')].map(el=>[el.querySelector('textarea')?.id,{open:el.open,value:el.querySelector('textarea')?.value}]));
  container.innerHTML = '';
  enabled.forEach(p => {
    const card = buildStep5Card(p);
    container.appendChild(card);
    if (card.id === openId) card.open = true;
    const input=card.querySelector('.s5-rewrite-details textarea'),prior=directions.get(input?.id);
    if(prior){input.value=prior.value;input.closest('details').open=prior.open;}
  });
  if (firstRender) {
    const next = enabled.find(p => p.adaptedContent && p._reviewStatus !== 'approved' && p._reviewStatus !== 'skipped');
    if (next) document.getElementById('step5-card-' + next.id).open = true;
  }
  // Use the same photo selection as the prepared publishing packet.
  enabled.filter(p => p.adaptedContent).forEach(renderAdPostPhotos);
  if(window._bbAdaptationBusy) enabled.forEach(p=>setPostRewriteBusy(p.id,true));
  updateStep5UI();
}

function buildStep5Card(p) {
  const card = document.createElement('details');
  card.name = 'platform-review';
  card.addEventListener('toggle', () => {
    if (card.open) _step5PlatIdx = getStep5Platforms().findIndex(item => item.id === p.id);
    syncPostDestinationChips();
  });
  card.className = 'step5-review-card';
  card.id = 'step5-card-' + p.id;
  const hasContent = !!p.adaptedContent;
  const isPending  = !hasContent && _bbIsGenerating(p.id);
  const isApi = p.type === 'api';
  const rawHint  = p.id === 'facebook' && p.type === 'manual' ? 'Your personal Facebook profile link (optional)' : PLATFORM_URL_HINTS[p.id] || '';
  const needsUrl = !rawHint || !rawHint.startsWith('Leave blank');
  const urlHint  = escHtml(rawHint || 'Paste your ' + p.name + ' page URL');
  const savedUrl = escHtml((window._bbPlatformUrls || {})[p.id] || '');
  // Two pending signals merged: the shared _bbGeneratingPlatforms set (covers all
  // entry points) and the per-platform status:'generating' flag set by runAdaptation.
  const isWriting = isPending || (!hasContent && p.status === 'generating');
  const statusClass = p._reviewStatus === 'approved' ? 'approved' : hasContent ? 'needs-review' : isWriting ? 'pending' : 'failed';
  const statusLabel = p._reviewStatus === 'approved' ? '✓ Approved' : hasContent ? 'Needs Review' : isWriting ? 'Writing…' : 'No Copy';
  const photoNote = isApi
    ? 'These photos will be uploaded automatically when this post goes live.'
    : 'Tap a photo to copy it, then paste it into your post.';

  // ── Row A: header ──────────────────────────────
  let inner = '<summary class="step5-plat-hdr">'
    + '<div class="step5-plat-icon bb-style-1c28b7a8">' + p.icon + '</div>'
    + '<div class="step5-plat-info">'
    +   '<div class="step5-plat-name">' + escHtml(p.name) + '</div>'
    +   '<div class="step5-plat-type">' + (isApi ? 'Blasty Posts It' : 'Ready for You to Post') + '</div>'
    + '</div>'
    + '<span class="step5-status-pill ' + statusClass + '" id="step5-pill-' + p.id + '">' + statusLabel + '</span>'
    + '</summary>';

  inner += (p.id === 'fbmarket' ? '<p class="helper-sm marketplace-items-notice"><strong>Items only.</strong> Select Marketplace only when this Blast offers eligible physical items for sale. Services, marketing subscriptions and general company promotions do not qualify as ordinary item listings. Businesses selling products can use it. <a href="https://www.facebook.com/help/130910837313345" target="_blank" rel="noopener noreferrer">Check Marketplace item rules</a>.</p>' : '');

  inner += (p.id === 'yelp' ? '<p class="helper-sm yelp-eligibility-notice"><strong>Local businesses and services.</strong> Yelp is for places customers can visit and businesses offering local services, including mobile providers. Online-only businesses and e-commerce-only stores do not qualify for ordinary business listings. Some remote professional services can qualify when they have local customer interaction. <a href="https://docs.developer.yelp.com/docs/yelp-data-quality-guidelines" target="_blank" rel="noopener noreferrer">Check Yelp eligibility</a>.</p>' : '');

  // ── Row B: col-2-1 — copy left, photos right ──
  if (hasContent) {
    const safeText = escHtml(p.adaptedContent.replace(/<br\/?>/gi, '\n'));
    inner += '<div class="row s5-card-body"><div class="col-1-2">'
      + '<div class="col-left">'
      +   '<div id="qp-photos-' + p.id + '" class="qp-photos-section">'
      +     '<div class="qp-photos-label">Photo for this post</div>'
      +     '<div id="qp-photo-strip-' + p.id + '" class="qp-photo-strip"></div>'
      +     '<button type="button" class="step5-action-btn w-100" onclick="openCampaignPhotos()">Change photo</button>'
      +     '<details class="s5-photo-help"><summary>Photo options</summary><div class="s5-photo-note">' + photoNote + '</div>'
      +     (!isApi ? '<div id="qp-share-' + p.id + '" class="qp-photo-share"></div>' : '') + '</details>'
      +   '</div>'
      + '</div><div class="col-right">'
      +   '<label id="qp-copy-label-' + p.id + '" class="helper-sm">Your ' + escHtml(p.name) + ' post</label>'
      +   '<div id="qp-copy-text-' + p.id + '" class="step5-copy-text" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="qp-copy-label-' + p.id + '">' + safeText + '</div>'
      +   '<div class="flex-row step5-copy-actions" aria-label="Rewrite options">'
      +     ['Shorter','More local','More upbeat'].map(label => '<button type="button" class="step5-action-btn" onclick="regeneratePlatformCopy(\'' + p.id + '\',\'' + label + '\')">' + label + '</button>').join('')
      +     '<button type="button" id="qp-undo-' + p.id + '" class="step5-action-btn qp-restore-btn" onclick="undoPlatformCopy(\'' + p.id + '\')"' + (postUndoAvailable(p.id) ? '' : ' hidden') + '>Undo</button>'
      +   '</div><p class="helper-sm" id="qp-rewrite-status-' + p.id + '" role="status" aria-live="polite"></p>'
      +   '<details class="s5-rewrite-details"><summary>Give a direction</summary>'
      +     '<label for="qp-direction-' + p.id + '">What should change?</label>'
      +     '<textarea id="qp-direction-' + p.id + '" maxlength="1000" rows="2" placeholder="Keep the price; focus on weekend pickup."></textarea>'
      +     '<button type="button" class="step5-action-btn" id="qp-regen-' + p.id + '" onclick="rewriteWithDirection(\'' + p.id + '\')">Rewrite</button>'
      +   '</details>'
      +   (!isApi ? '<button type="button" class="step5-action-btn" onclick="copyQpText(\'' + p.id + '\')">Copy text</button>' : '')
      + '</div></div></div>'
      + '<button type="button" class="step5-looks-good-btn' + (p._reviewStatus === 'approved' ? ' approved' : '') + '" id="step5-lgtm-' + p.id + '" onclick="approvePlatformCopy(\'' + p.id + '\')">'
      +   (p._reviewStatus === 'approved' ? '✓ Approved' : '✓ Looks good — next') + '</button>';
  } else if (isWriting) {
    // Still writing — no retry/exclude yet, those would only invite the owner to
    // interrupt a generation that is about to succeed.
    inner += '<div class="s5-card-body">'
      + '<div class="s5-writing" role="status" aria-live="polite">'
      +   '<div class="s5-writing-dot"></div>'
      +   '<div>Writing your ' + escHtml(p.name) + ' ad…</div>'
      + '</div>'
      + '<div id="qp-copy-text-' + p.id + '" class="bb-style-c8be1ccb"></div>'
      + '</div>';
  } else {
    inner += '<div class="s5-card-body">'
      + '<div class="step5-setup-block">'
      +   '<div class="step5-setup-title">⚠️ No copy generated</div>'
      +   '<div class="step5-setup-tip">AI didn\'t return copy for this platform. Retry generation or exclude it from this blast.</div>'
      +   '<div class="step5-setup-btns">'
      +     '<button type="button" class="step5-action-btn" onclick="regeneratePlatformCopy(\'' + escHtml(p.id) + '\')">🔄 Retry Generation</button>'
      +     '<button type="button" class="step5-action-btn bb-style-a41da77c" onclick="excludePlatform(\'' + escHtml(p.id) + '\')">✗ Exclude Platform</button>'
      +   '</div>'
      + '</div>'
      + '<div id="qp-copy-text-' + p.id + '" class="bb-style-c8be1ccb"></div>'
      + '</div>';
  }

  // ── Row C: location/address ─────────────────────
  inner += '<details class="s5-card-location"><summary>Posting link (optional)</summary><p class="helper-sm">Your saved link is reused. It does not connect an automatic posting account.</p>';
  if (needsUrl) {
    inner += '<div class="step5-setup-title">📍 Save your ' + escHtml(p.name) + ' link</div>'
      + '<div class="step5-url-row">'
      +   '<input type="url" id="qp-url-input-' + p.id + '" class="step5-url-input" placeholder="' + urlHint + '" value="' + savedUrl + '" onblur="window.savePlatformUrl && window.savePlatformUrl(\'' + p.id + '\', this.value.trim())" />'
      +   '<button type="button" class="step5-url-save" onclick="window.savePlatformUrl && window.savePlatformUrl(\'' + p.id + '\', document.getElementById(\'qp-url-input-' + p.id + '\').value.trim())">Save</button>'
      + '</div><p id="qp-url-feedback-' + p.id + '" role="status" class="helper-sm"></p>';
  } else {
    inner += '<div class="s5-no-link">✓ No link necessary for ' + escHtml(p.name) + '</div>';
  }
  inner += '</details>';

  card.innerHTML = inner;
  return card;
}

function syncPostDestinationChips() {
  const host=document.getElementById('step5-destinations');if(!host)return;
  const enabled=getStep5Platforms();
  host.replaceChildren(...enabled.map((p,index)=>{
    const chip=document.createElement('button');chip.type='button';chip.className='step5-action-btn';
    chip.textContent=(p._reviewStatus==='approved'?'✓ ':'')+p.name;
    chip.setAttribute('aria-controls','step5-card-'+p.id);
    chip.setAttribute('aria-pressed',String(!!document.getElementById('step5-card-'+p.id)?.open));
    chip.addEventListener('click',()=>step5GoTo(index));return chip;
  }));
}

function updateStep5UI() {
  syncPostDestinationChips();
  const enabled = getStep5Platforms();
  enabled.filter(p => p.adaptedContent).forEach(p => {
    const approved = p._reviewStatus === 'approved';
    const button = document.getElementById('step5-lgtm-' + p.id);
    if (button && button.dataset.saving !== '1') {
      button.classList.toggle('approved', approved);
      button.textContent = approved ? '✓ Approved' : '✓ Looks good — next';
    }
    const pill = document.getElementById('step5-pill-' + p.id);
    if (pill) { pill.className = 'step5-status-pill ' + (approved ? 'approved' : 'needs-review'); pill.textContent = approved ? '✓ Approved' : 'Needs Review'; }
  });
  const doneCount = enabled.filter(p =>
    p._reviewStatus === 'approved' || p._reviewStatus === 'skipped'
  ).length;
  const allDone  = enabled.length > 0 && doneCount === enabled.length;
  const anyDone  = doneCount > 0;

  const finalBtn = document.getElementById('step5-final-btn');
  if (!finalBtn) return;

  const wasHidden   = getComputedStyle(finalBtn).display === 'none';
  const wasDisabled = finalBtn.disabled;

  if (!allDone || window._bbAdaptationBusy || window._bbDraftSavePending) {
    // Nothing approved yet — keep button hidden
    finalBtn.style.display = 'none';
    return;
  }

  // At least one done — show the button
  finalBtn.style.display = 'flex';

  if (allDone) {
    finalBtn.disabled = false;
    finalBtn.textContent = 'Review My Blast →';
    if (wasDisabled || wasHidden) {
      setTimeout(() => finalBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      showToast('All platforms reviewed — tap Review My Blast below');
    }
  } else {
    finalBtn.disabled = true;
    finalBtn.textContent = 'Approve each platform above to continue →';
    if (wasHidden) {
      setTimeout(() => finalBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
  }
}

async function completeBlast(newBlast = false) {
  if (window._bbDraftSavePending) { showToast('Save your generated copy with Retry save first.'); return; }
  const button = document.getElementById('step5-final-btn');
  if (button) { button.disabled = true; button.textContent = 'Opening…'; }
  try {
    await window.BBAds.continueCurrent(newBlast);
  } catch (e) {
    showToast(e.message || 'Could not open your blast. Please retry.');
  } finally {
    updateStep5UI();
  }
}

// ══════════════════════════════════════════
// IMAGE HANDLING
// ══════════════════════════════════════════
function photoUploadMatchesView(item) {
  return item.bizId === window.activeBizId && item.scope === photoScope
    && (item.scope === 'global' || item.campaignId === activeCampaignId);
}

function restoreFeaturedPhotoSelection() {
  const url = window._bbFeaturedPhotoUrl;
  const index = url ? (window._bbPhotoItems || []).findIndex(item => item.done && item.url === url) : -1;
  window._bbSelectedPhotoIndex = index >= 0 ? index : null;
}

function photoCap() { return 20; } // Shared capacity for each campaign and global library.

function updatePhotoCapLabel() {
  const label = document.getElementById('photo-cap-label');
  const area  = document.getElementById('photo-upload-area');
  if (!label) return;
  const items = window._bbPhotoItems || [];
  const saved = items.filter(i => i.done).length;
  const cap   = photoCap();
  const plan  = window._bbUserPlan || 'starter';
  if (photoScope !== 'global' && !activeCampaignId) {
    label.textContent = '';
    label.style.color = 'var(--muted)';
    if (area) area.style.opacity = '0.45';
    return;
  }
  if (area) area.style.opacity = cap === Infinity || saved < cap ? '1' : '0.45';
  if (cap === Infinity) {
    label.textContent = saved + ' photos';
    label.style.color = 'var(--muted)';
  } else {
    label.textContent = saved + ' / ' + cap + ' photos';
    label.style.color = saved >= cap ? '#ff6b35' : 'var(--muted)';
  }
}

var _photoReservations = new Map();
function handleImages(e) {
  const input = e.target;
  if (input._bbReadingPhotos) return;
  if (photoScope !== 'global' && !activeCampaignId) {
    showToast('Pick a campaign first, then add photos');
    e.target.value = '';
    return;
  }
  const items = window._bbPhotoItems || [];
  const cap   = photoCap();
  const key = [window.activeBizId,photoScope,photoScope==='global'?'':activeCampaignId].join('/');
  const reserved = _photoReservations.get(key)||0;
  const current = Math.max(items.filter(i=>!i.error).length,items.filter(i=>i.done).length+reserved);
  const selected = Array.from(input.files || []);
  const files = selected.slice(0,Math.max(0,cap-current));
  if(files.length<selected.length)showToast('You have reached the 20 photo limit. Remove one to add more.');
  _photoReservations.set(key,reserved+files.length);
  const uploadContext = { scope: photoScope, campaignId: activeCampaignId, bizId: window.activeBizId };
  // Keep the picker and its selected File references alive until all bytes are read.
  // Android gallery providers may supply temporary references rather than local bytes.
  input._bbReadingPhotos = true;
  input.disabled = true;
  checkAdaptBtn();
  // Sequential: compress one at a time to avoid concurrent canvas.toBlob() hangs on mobile.
  return (async () => {
    try {
      for (const file of files) {
        try { if (window._bbUploadPhoto) await window._bbUploadPhoto(file, uploadContext); }
        catch(error){showToast('Photo upload failed. Please retry.');}
        finally {_photoReservations.set(key,Math.max(0,(_photoReservations.get(key)||0)-1));}
      }
    } finally {
      input.value = '';
      input.disabled = false;
      input._bbReadingPhotos = false;
      if (window.renderAllPhotos) window.renderAllPhotos();
    }
  })();
}

window.renderAllPhotos = function() {
  restoreFeaturedPhotoSelection();
  const grid = document.getElementById('thumb-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const items = window._bbPhotoItems || [];

  items.forEach((item, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';
    if (item.error) {
      wrap.classList.add('has-error');
      wrap.innerHTML = `
        <div class="thumb-error-overlay">⚠️</div>
        <div class="thumb-error-msg">${escHtml(item.errorMsg || 'Upload failed')}</div>
        <button type="button" class="thumb-remove" onclick="window._bbDeletePhoto&&window._bbDeletePhoto(${i})">✕</button>`;
    } else if (!item.done) {
      const label = item.compressing
        ? `<div class="thumb-progress-pct bb-style-0d5be05f">⚙️</div><div class="bb-style-d75d8334">Compressing…</div>`
        : `<div class="thumb-progress-pct">${item.progress}%</div><div class="thumb-progress-bar"><div style="width:${item.progress}%;height:100%;background:var(--green);border-radius:2px;transition:width .2s;"></div></div>`;
      wrap.innerHTML = `
        ${item.localUrl ? `<img src="${item.localUrl}" class="thumb-uploading-img" alt="Uploading photo…" />` : ''}
        <div class="thumb-progress-overlay">${label}</div>`;
    } else {
      const isSelected = window.BBAds?.active
        ? (window.BBAds.active.imageRefs || []).some(image => (photoScope === 'campaign' && image.id === item.id) || image.url === item.url)
        : window._bbSelectedPhotoIndex === i;
      wrap.className = 'thumb-wrap selectable' + (isSelected ? ' selected' : '');
      wrap.innerHTML = `
        <button type="button" class="thumb-select" aria-pressed="${isSelected}" aria-label="${isSelected ? 'Exclude photo from this blast' : 'Use photo in this blast'}">
          <img src="${escHtml(item.localUrl || item.url)}" alt="Uploaded photo" />
          <span class="thumb-select-label${isSelected ? ' thumb-selected-badge-label' : ''}">${isSelected ? '✓ Selected' : 'Use photo'}</span>
        </button>
        <button type="button" class="thumb-remove" aria-label="Delete uploaded photo">Delete</button>`;
      wrap.querySelector('.thumb-select').onclick = () => {
        if(item.deleting || item.selecting)return;
        if(window.BBAds?.active)window.BBAds.choosePhoto(item);
        else if(window._bbSelectPhoto)window._bbSelectPhoto(i);
      };
      wrap.querySelector('.thumb-remove').onclick = () => window._bbDeletePhoto?.(i);
    }
    if (item.deleting || item.selecting || window.BBAds?.busy) {
      wrap.style.opacity = '0.45';
      wrap.setAttribute('aria-busy', 'true');
      wrap.querySelectorAll('button').forEach(button => { button.disabled = true; });
    }
    grid.appendChild(wrap);
  });

  const cap = photoCap();
  const uploadArea = document.getElementById('photo-upload-area');
  if (uploadArea) uploadArea.style.display = (cap !== Infinity && items.filter(item => !item.error).length >= cap) ? 'none' : 'flex';
  if (window._bbPhotoUseFiles) {
    const input = document.getElementById('img-input');
    const label = document.getElementById('photo-upload-text');
    if (input && !input._bbReadingPhotos) input.accept = '*/*';
    if (label) label.innerHTML = 'Tap to add photos<br/><span>from Files on your phone</span>';
  }
  updatePhotoCapLabel();

  let badge = document.getElementById('photo-count-badge');
  const uploading = items.filter(i => !i.done && !i.error).length;
  const saved = items.filter(i => i.done).length;
  if (items.length > 0) {
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'photo-count-badge';
      badge.style.cssText = 'font-size:12px;font-weight:600;margin-bottom:10px;';
      grid.parentNode.insertBefore(badge, grid);
    }
    const failed = items.filter(i => i.error).length;
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    badge.style.color = failed ? '#ffb400' : uploading > 0 ? '#fff' : 'var(--green)';
    badge.textContent = items.some(item=>item.selecting) || window.BBAds?.busy ? 'Saving photo selection…' : uploading > 0
      ? `⬆️ Uploading ${uploading} photo${uploading > 1 ? 's' : ''}… (${saved} saved)`
      : failed ? `⚠️ ${failed} photo${failed !== 1 ? 's' : ''} failed to upload · ${saved} saved. Remove the failed tiles and retry.`
      : `✅ ${saved} photo${saved !== 1 ? 's' : ''} saved ${photoScope === 'global' ? 'to the global library' : 'to this campaign'}`;
    let hint = document.getElementById('photo-select-hint');
    if (saved > 0 && !hint) {
      hint = document.createElement('div');
      hint.id = 'photo-select-hint';
      hint.className = 'thumb-hint';
      hint.textContent = '';
      grid.parentNode.insertBefore(hint, grid);
    }
    if (hint) hint.textContent = window.BBAds?.active
      ? (photoScope === 'global' ? 'Tap a business photo to use it in this ad.' : 'Campaign photos are included automatically. Tap Selected to leave a photo out of this blast. Your choices save automatically.')
      : 'Tap a photo to feature it in your ad';
    if (saved === 0 && hint) {
      hint.remove();
    }
  } else {
    if (badge) badge.remove();
    const hint = document.getElementById('photo-select-hint');
    if (hint) hint.remove();
    window._bbSelectedPhotoIndex = null;
  }
  checkAdaptBtn();
};

// ══════════════════════════════════════════
// IN-FLIGHT GENERATION TRACKING
// ══════════════════════════════════════════
// A platform with no copy is only a FAILURE once its generation has settled.
// While the AI is still working, its card must show a pending state — otherwise
// the review screen tells the owner it failed seconds before the copy arrives.
window._bbGeneratingPlatforms = window._bbGeneratingPlatforms || new Set();

// A hung request never settles on its own, so without this the pending card
// spins forever and the owner has no way back. Aborting turns a hang into a
// normal failure that the existing retry path already handles.
const AI_REQUEST_TIMEOUT_MS = 120000;

async function _bbFetchWithTimeout(url, options, timeoutMs) {
  if (url.endsWith('/adaptListing')) return window.BBAI.fetch(url,options);
  const ms = timeoutMs || AI_REQUEST_TIMEOUT_MS;
  if (typeof AbortController === 'undefined') return fetch(url, options);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const e = new Error('AI request timed out after ' + Math.round(ms / 1000) + 's');
      e._isTimeout = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function _bbSetGenerating(ids) {
  window._bbGeneratingPlatforms = new Set(ids || []);
}
function _bbMarkGenerating(ids) {
  (ids || []).forEach(id => window._bbGeneratingPlatforms.add(id));
}
function _bbClearGenerating(ids) {
  if (!ids) { window._bbGeneratingPlatforms.clear(); return; }
  ids.forEach(id => window._bbGeneratingPlatforms.delete(id));
}
function _bbIsGenerating(pid) {
  return window._bbGeneratingPlatforms.has(pid);
}

// ══════════════════════════════════════════
// AI GENERATION PROGRESS BAR
// ══════════════════════════════════════════
let _aiProgressInterval = null;

function _startAiProgress(platforms) {
  if (_aiProgressInterval) { clearInterval(_aiProgressInterval); _aiProgressInterval = null; }
  const started=Date.now(),fill=document.getElementById('ai-gen-fill'),pctEl=document.getElementById('ai-gen-pct'),sub=document.getElementById('ai-loading-sub');
  if(fill){fill.style.width='35%';fill.classList.add('is-waiting');}
  if(pctEl)pctEl.textContent='Waiting for AI…';
  if(sub)sub.textContent='Writing copy for '+platforms.length+' selected destinations. Timing varies.';
  _aiProgressInterval=setInterval(()=>{if(pctEl)pctEl.textContent='Still writing · '+Math.floor((Date.now()-started)/1000)+' seconds';},1000);

}

function _completeAiProgress() {
  if (_aiProgressInterval) { clearInterval(_aiProgressInterval); _aiProgressInterval = null; }
  const fill  = document.getElementById('ai-gen-fill');
  const pctEl = document.getElementById('ai-gen-pct');
  if (fill) { fill.classList.remove('is-waiting'); fill.style.width = '100%'; }
  if (pctEl) pctEl.textContent = 'Request finished';
}

// ══════════════════════════════════════════
// RUN ADAPTATION — Real AI Call
// ══════════════════════════════════════════
let generatedDraftSaving = false;
async function retryGeneratedDraftSave() {
  if (generatedDraftSaving) return false;
  generatedDraftSaving = true;
  window._bbDraftSavePending = true;
  const selection = postRewriteKey();
  const errorBox = document.getElementById('draft-save-error');
  const retry = document.getElementById('draft-save-retry');
  const review = document.getElementById('review-listings-btn');
  if (retry) retry.disabled = true;
  if (review) review.classList.remove('visible');
  try {
    if (!window._afterAdaptation) throw new Error('Saving is not ready yet');
    if (window.BBAds?.active) await window.BBAds.save();
    if (selection !== postRewriteKey()) return false;
    const draftId = await window._afterAdaptation(platforms);
    if (!draftId) throw new Error('Draft was not saved');
    if (selection !== postRewriteKey()) return false;
    window._bbDraftSavePending = false;
    if (errorBox) errorBox.hidden = true;
    const output = document.getElementById('review-output-btn');
    if (output) output.disabled = false;
    if (review) { review.href = 'BlastyBiz-Listing-Preview.html?draftId=' + encodeURIComponent(draftId); review.classList.add('visible'); }
    return true;
  } catch(e) {
    console.warn('Draft save failed:', e);
    if (selection === postRewriteKey()) {
      if (errorBox) errorBox.hidden = false;
      showToast('Generated copy was not saved. Use Retry save; you do not need to generate it again.');
    }
    return false;
  } finally {
    generatedDraftSaving = false;
    if (retry) retry.disabled = false;
  }
}

async function runAdaptation() {
  if (window._bbAdaptationBusy) return;
  window._bbAdaptationBusy = true;
  const btn = document.getElementById('adapt-btn');
  const loader = document.getElementById('ai-loading');
  const errorBox = document.getElementById('generation-error');
  if (errorBox) errorBox.hidden = true;
  try {
  await flushCampaignMemoryEdits();
  await window.BBAds.ready();
  clearTimeout(_campaignSaveTimer);
  await window.BBAds.save();
  if (window._bbDraftSavePending) { showToast('Save your generated copy with Retry save first.'); return; }
  updateCampaignMemory(); // ensure campaign object reflects current DOM before prompt is built
  // Profile is the dossier — always primary source for business identity fields
  const name      = profile.sellerType==='personal'?BBSetup.mentionedName(profile,ynState):(profile.name||'');
  const category  = profile.category || '';
  const phone     = ynState.phone   !== 'no' ? (profile.phone   || '') : '';
  const email     = ynState.email   !== 'no' ? (profile.email   || '') : '';
  const website   = ynState.website !== 'no' ? (profile.website || '') : '';
  const hours     = profile.hours    || '';
  const effLocType = profile.locationType || 'physical';
  const address = profile.sellerType==='personal' ? '' : ((effLocType === 'physical' || effLocType === 'both') && ynState.address !== 'no' ? BBSetup.locationText(profile.address) : '');
  const region = profile.sellerType==='personal' ? BBSetup.formatArea(window.BBAds?.active||{}) : (effLocType === 'both' ? BBSetup.locationText(profile.region) : '');
  const offer     = document.getElementById('biz-offer').value.trim() || document.getElementById('ad-context')?.value.trim() || document.getElementById('campaign-context')?.value.trim() || activeCampaignName;
  const price     = document.getElementById('biz-price').value.trim();
  const tone      = profile.tone || 'friendly';
  const adName      = document.getElementById('biz-ad-name')?.value?.trim() || '';
  const includeName = BBSetup.mentionedName(profile,ynState);
  const includeRole = ynState.role === 'yes' && profile.ownerRole;

  // Validate before marking any platform as generating.
  if (!offer) throw new Error('Add your offer description in Details, then retry.');

  const enabledPlatforms = platforms.filter(p => p.enabled);
  if (!enabledPlatforms.length) throw new Error('Select at least one platform in Details, then retry.');

  // Reset per-platform review status for this fresh generation and mark enabled
  // platforms as generating so Step 5 shows a pending state instead of "No Copy"
  platforms = platforms.map(p => p.enabled
    ? { ...p, _reviewStatus: undefined, status: 'generating' }
    : { ...p, _reviewStatus: undefined });
  renderStep5Review();

  // Covers entry points other than createWizGoTo (e.g. the Rewrite button)
  _bbSetGenerating(enabledPlatforms.map(p => p.id));
  renderStep5Review();

  // Show loading, hide button (adapt-btn no longer in DOM — guard is safe)
  if (btn) btn.style.display = 'none';
  loader.classList.add('visible');
  _startAiProgress(enabledPlatforms);

  const platformList = enabledPlatforms.map(p => ({
    id: p.id,
    name: p.name,
    type: p.type,
    rules: PLATFORM_RULES[p.id] || {}
  }));

  // F11: Client-side prompt string removed — the server (adaptListing CF) builds the prompt
  // from the structured listing + platforms payload. Sending a client-built prompt is redundant
  // and would bloat every request unnecessarily.

  // F4: Generate a unique attempt ID before calling the AI so it can be stored alongside
  // the draft for idempotency / audit purposes.
  const generationAttemptId = crypto.randomUUID();

  // Each new generation run resets the free-regen entitlement for the new draft.
  window._bbDraftFreeRegenUsed = false;
  // Refresh the visible regeneration buttons.
  document.querySelectorAll('[id^="qp-regen-"]').forEach(btn => {
    if (!btn.disabled) btn.textContent = '↻ Rewrite copy';
  });

    document.getElementById('ai-loading-sub').textContent = `Adapting for ${enabledPlatforms.length} platform${enabledPlatforms.length > 1 ? 's' : ''}...`;

    const idToken = window._bbGetToken ? await window._bbGetToken() : null;
    const authHeaders = idToken
      ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken }
      : { 'Content-Type': 'application/json' };

    const generationDraftId = window._bbPrepareGenerationDraft ? window._bbPrepareGenerationDraft() : window._currentDraftId;
    const response = await _bbFetchWithTimeout('https://us-central1-blastybiz-9523e.cloudfunctions.net/adaptListing', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        listing: { sellerType:profile.sellerType || 'business', name, category, offer, price, phone, email, address, region, locationType: effLocType, website, hours,
          ownerName: includeName, mentions:BBSetup.mentions(ynState),
          adName,
          campaignName: activeCampaignName || '',
          imageCount: (window._bbPhotoItems||[]).filter(p=>p.done).length,
          featuredPhotoUrl: window._bbSelectedPhotoIndex !== null ? (window._bbPhotoItems[window._bbSelectedPhotoIndex]?.url || '') : '',
          campaignContext: document.getElementById('campaign-context')?.value?.trim() || '',
          bizInsights: bizInsights.filter(i=>i.answer),
          globalFactoids: window._globalFactoids || [],
          campaignFactoids: (campaigns.find(c=>c.id===activeCampaignId)||{}).factoids || [],
          aiContext: profile.aiContext || null,
          ...(_getAIMemory()),
          libraryDocs: window._libraryDocs || [],
          businessId: window.activeBizId || '',
          campaignId: activeCampaignId || '',
          adId: window.BBAds?.active?.id || '',
          adContext: document.getElementById('ad-context')?.value || '',
          cta: document.getElementById('ad-cta')?.value || '',
          requestId: generationAttemptId,  // used by server for dedup; placed inside listing per spec
        },
        platforms: enabledPlatforms,
        tone,
        platformCats: profile.platformCats || {},
        draftId: generationDraftId,
        generationAttemptId,  // kept at top level for backward compat
      })
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.error || 'Generation failed (' + response.status + '). Please retry.');
    }

    const parsed = await response.json();
    const adaptations = parsed.adaptations || {};

    platforms = platforms.map(p => {
      if (!p.enabled) return p;
      const adapted = adaptations[p.id];
      return adapted
        ? { ...p, adaptedContent: adapted.replace(/\n/g, '<br/>'), status: 'ready' }
        : { ...p, adaptedContent:'', previousContent:p.adaptedContent||p.previousContent||'', status: 'idle', _reviewStatus:undefined };  // Failed destinations cannot retain stale copy as newly generated output.
    });

    savePlatforms();

    // Generation has settled — any platform still without copy is a genuine
    // failure now, so let those cards fall through to the retry state.
    _bbSetGenerating([]);

    // Save draft to Firestore in background, then show copy inside accordions
    _completeAiProgress();
    const loadingSub2 = document.getElementById('ai-loading-sub');
    if (loadingSub2) loadingSub2.textContent = parsed.status==='partial'?'Some destinations need retry.':'Copy ready for review.';

    // Render platform cards with real copy now that adaptation is done
    renderStep5Review();

    // Show rewrite row; review-output-btn is gone (merged into Page 2)
    const _rewriteRow = document.getElementById('rewrite-row');
    if (_rewriteRow) _rewriteRow.classList.remove('hidden');
    const _reviewOutputBtn = document.getElementById('review-output-btn');
    if (_reviewOutputBtn) { _reviewOutputBtn.style.display = 'flex'; _reviewOutputBtn.disabled = true; }

    await retryGeneratedDraftSave();

    // Write platformHistory to active campaign
    if (activeCampaignId && window._bbSaveCampaigns) {
      try {
        const cam = campaigns.find(c => c.id === activeCampaignId);
        if (cam) {
          if (!cam.platformHistory) cam.platformHistory = {};
          const ranAt = new Date().toISOString();
          const currentSchedule = profile.postingSchedule || null;
          platforms.filter(p => p.enabled && p.adaptedContent).forEach(p => {
            if (!cam.platformHistory[p.id]) cam.platformHistory[p.id] = [];
            cam.platformHistory[p.id].push({
              copy: p.adaptedContent.replace(/<br\/?>/gi, '\n'),
              ranAt,
              schedule: currentSchedule,
            });
          });
          cam.lastUsedAt = ranAt;
          await window._bbSaveCampaigns(campaigns);
          renderPlatformHistory();
        }
      } catch(e) {
        console.warn('platformHistory save failed:', e);
      }
    }

    const readyCount  = enabledPlatforms.filter(p=>typeof adaptations[p.id]==='string'&&adaptations[p.id].trim()).length;
    const failedCount = enabledPlatforms.length - readyCount;
    if (failedCount > 0) {
      showToast('⚠️ ' + readyCount + ' ready, ' + failedCount + ' need retry');
    } else {
      showToast('✅ ' + readyCount + ' platform' + (readyCount !== 1 ? 's' : '') + ' ready!');
    }

  } catch (err) {
    _completeAiProgress();
    console.error(err);
    const message = err && err._isTimeout ? 'Generation took too long. Your details are still here; retry when ready.' : (err.message || 'Generation failed. Please retry.');
    if (errorBox) { errorBox.hidden = false; document.getElementById('generation-error-message').textContent = message; }
    showToast(message);
    // Generation settled (failed) — clear pending state so cards show the failure/retry UI
    platforms = platforms.map(p => p.status === 'generating' ? { ...p, status: 'idle' } : p);
    renderStep5Review();
  } finally {
    if (btn) btn.style.display = 'flex';
    loader?.classList.remove('visible');
    window._bbAdaptationBusy = false;
    // Belt and braces: never leave a card spinning if an unexpected throw skipped
    // the success path.
    if (window._bbGeneratingPlatforms.size) { _bbSetGenerating([]); renderStep5Review(); }
  }
}

// ══════════════════════════════════════════
// CLEAR & START OVER
// ══════════════════════════════════════════
function clearAndStartOver() {
  if (generatedDraftSaving) { showToast('Please wait for the draft save to finish.'); return; }
  // Clear all form fields
  ['biz-name','biz-offer','biz-price','biz-phone','biz-address','biz-region','biz-website','biz-hours']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const cat = document.getElementById('biz-category');
  if (cat) cat.value = '';
  const dir = document.getElementById('ai-direction');
  if (dir) { dir.value = ''; dir.style.height = 'auto'; }
  const offerCount = document.getElementById('offer-count');
  if (offerCount) offerCount.textContent = '0 / 500';

  // Reset to physical location type
  setLocationType('physical');

  // Reset platform content/status AND clear selection (user clicked Clear & Start Over)
  platforms = platforms.map(p => ({...p, adaptedContent: null, status: 'idle', enabled: false}));
  try { localStorage.removeItem('bb_platforms_enabled'); } catch(e) {}
  savePlatforms();
  renderPlatforms();

  // Hide rewrite row + review button
  const rewriteRow = document.getElementById('rewrite-row');
  if (rewriteRow) rewriteRow.classList.add('hidden');
  const reviewBtn = document.getElementById('review-listings-btn');
  if (reviewBtn) { reviewBtn.classList.remove('visible'); reviewBtn.href = 'BlastyBiz-Listing-Preview.html'; }
  const reviewOutputBtn = document.getElementById('review-output-btn');
  if (reviewOutputBtn) { reviewOutputBtn.style.display = 'none'; reviewOutputBtn.disabled = false; }

  // Reset draft state
  draft = {};
  window._currentDraftId = null;
  window._bbPendingDraft = null;
  window._bbDraftSavePending = false;
  const saveError = document.getElementById('draft-save-error');
  if (saveError) saveError.hidden = true;

  // Switch to create tab
  showTab('create');
  checkAdaptBtn();
  showToast('🗑️ Cleared — ready for a new listing');
}

// ══════════════════════════════════════════
// DEPLOY / COPY
// ══════════════════════════════════════════
function deployPlatform(id) {
  if (window._bbDraftSavePending) { showToast('Save your generated copy with Retry save first.'); return; }
  const p = platforms.find(x => x.id === id);
  if (!p) return;
  if (!p.adaptedContent) { showToast('Run adaptation first'); return; }
  if(window.BBAds?.active){window.BBAds.continueCurrent();return;}
  const draftId = window._currentDraftId;
  window.location.href = 'BlastyBiz-Listing-Preview.html' + (draftId ? '?draftId=' + draftId : '');
}

function copyText(id) {
  const box = document.getElementById('copy-' + id);
  if (!box) return;
  const text = box.innerText.replace('Copy', '').trim();
  navigator.clipboard.writeText(text).then(() => {
    const btn = box.querySelector('.copy-btn-float');
    if (btn) { btn.textContent = '✓ Copied'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000); }
    showToast('📋 Copied to clipboard');
  });
}

function setPlatformStatus(id, status) {
  platforms = platforms.map(p => p.id === id ? {...p, status} : p);
  savePlatforms();
  const badge = document.getElementById('badge-' + id);
  if (badge) {
    badge.className = 'badge badge-' + status;
    badge.textContent = '● ' + status;
  }
}

// ══════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════
function addHistory() {
  if(window._bbReloadHistory)window._bbReloadHistory();
}

function renderHistory() {
  const el=document.getElementById('history-list'),rows=history||[],now=new Date();
  const posted=rows.filter(row=>row.posted>0);
  document.getElementById('stat-total-posts').textContent=posted.length;
  document.getElementById('stat-platforms-hit').textContent=new Set(rows.flatMap(row=>row.postedPlatforms||[])).size;
  document.getElementById('stat-this-month').textContent=posted.filter(row=>row.postedTimes?.some(value=>{const date=new Date(value);return date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth();})).length;
  if(!rows.length){el.innerHTML='<p>No posting activity loaded yet.</p>';return;}
  el.innerHTML=rows.map(row=>'<div class="history-item"><div class="bb-style-59eddc67"><div class="history-title">'+escHtml(row.listing)+'</div><div class="history-meta">'+escHtml(row.summary)+' · '+escHtml(row.time?timeAgo(row.time):'Date unavailable')+'</div></div>'+(row.draftId?'<a class="history-reload bb-style-bf928261" href="BlastyBiz-Publishing-Status.html?'+new URLSearchParams({bizId:window.activeBizId,draftId:row.draftId})+'">Results →</a>':'')+'</div>').join('');
}

async function loadHistoryDraft(draftId) {
  if (!draftId || !window._bbLoadDraft) return;
  showToast('⏳ Loading blast…');
  try {
    const draft = await window._bbLoadDraft(draftId);
    if (!draft) { showToast('⚠️ Blast not found'); return; }

    // Review the saved Blast itself. Loading history must not replace the reusable Ad.
    window.location.href = 'BlastyBiz-Listing-Preview.html?bizId=' + encodeURIComponent(window.activeBizId) + '&draftId=' + encodeURIComponent(draftId);
  } catch(e) {
    console.error('loadHistoryDraft:', e);
    showToast('⚠️ Could not load blast');
  }
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

// ══════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════
// LOCATION TYPE TOGGLES
// ══════════════════════════════════════════
function setLocationType(type) {
  locationType = type;
  document.getElementById('loc-btn-physical')?.classList.toggle('active', type === 'physical');
  document.getElementById('loc-btn-online')?.classList.toggle('active', type === 'online');
  document.getElementById('loc-physical-fields').style.display = type === 'physical' ? 'block' : 'none';
  document.getElementById('loc-online-fields').style.display   = type === 'online'   ? 'block' : 'none';
  saveDraft();
}

function setProfileLocationType(type, persist = true) {
  profileLocationType = type;
  document.getElementById('prof-loc-btn-physical').classList.toggle('active', type === 'physical');
  document.getElementById('prof-loc-btn-online').classList.toggle('active', type === 'online');
  document.getElementById('prof-loc-btn-both')?.classList.toggle('active', type === 'both');
  const showAddress = type === 'physical' || type === 'both';
  const showRegion  = type === 'both';
  const _plpf = document.getElementById('prof-loc-physical-fields'); if (_plpf) { if (showAddress) _plpf.classList.remove('hidden'); else _plpf.classList.add('hidden'); }
  const _plof = document.getElementById('prof-loc-online-fields'); if (_plof) { if (showRegion) _plof.classList.remove('hidden'); else _plof.classList.add('hidden'); }
  if (persist) saveProfile();
}

// ══════════════════════════════════════════
function saveProfile() {
  const identity=BBSetup.nameParts({ownerFirstName:document.getElementById('profile-owner-name').value,ownerLastName:document.getElementById('profile-owner-last-name').value});
  profile = {
    ...profile,
    sellerType: profile.sellerType || 'business',
    name:             profile.sellerType === 'personal' ? identity.ownerName : document.getElementById('profile-name').value,
    ...identity,
    ownerRole:        profile.sellerType==='personal'?'':document.getElementById('profile-owner-role')?.value || 'owner',
    category:         document.getElementById('profile-cat').value,
    phone:            document.getElementById('profile-phone').value,
    email:            document.getElementById('profile-email').value,
    locationType:     profileLocationType,
    street:           profile.sellerType==='personal'?'':document.getElementById('profile-street')?.value || '',
    city:             document.getElementById('profile-city')?.value    || '',
    state:            document.getElementById('profile-state')?.value   || '',
    zip:              document.getElementById('profile-zip')?.value     || '',
    get address() { return [this.street, this.city, this.state, this.zip].filter(Boolean).join(', '); },
    region:           document.getElementById('profile-region')?.value  || '',
    website:          document.getElementById('profile-website').value,
    hours:            profile.sellerType==='personal'?'':document.getElementById('profile-hours').value,
    tone:             document.getElementById('profile-tone').value,
  };
  window._bbProfileGlobal=profile;
  renderPlatforms();
  renderQuickSelect();
  const hasNameInline = !!profile.name;
  const nameDisplayInline = document.getElementById('profile-biz-name');
  if (nameDisplayInline) {
    nameDisplayInline.textContent = hasNameInline ? profile.name : (profile.sellerType==='personal'?'⚠️ Seller name not set':'⚠️ Business name not set');
    nameDisplayInline.style.color = hasNameInline ? 'var(--green)' : 'var(--warn)';
  }
  const nameInput = document.getElementById('profile-name');
  if (nameInput) nameInput.style.borderColor = hasNameInline ? '' : '#FFA726';
  const missingBanner = document.getElementById('biz-name-missing-banner');
  if (missingBanner) { if (hasNameInline || profile.sellerType !== 'business') missingBanner.classList.add('hidden'); else missingBanner.classList.remove('hidden'); }
  const catDisplayInline = document.getElementById('profile-biz-cat');
  if (catDisplayInline) catDisplayInline.textContent = profile.category || 'Set up your profile below';

  // Pre-fill create form if empty
  if (!document.getElementById('biz-name').value && profile.name)       document.getElementById('biz-name').value     = profile.name;
  if (!document.getElementById('biz-category').value && profile.category) document.getElementById('biz-category').value = profile.category;
  if (!document.getElementById('biz-phone').value && profile.phone)     document.getElementById('biz-phone').value    = profile.phone;
  if (!document.getElementById('biz-website').value && profile.website) document.getElementById('biz-website').value  = profile.website;
  if (!document.getElementById('biz-hours').value && profile.hours)     document.getElementById('biz-hours').value    = profile.hours;
  if (profile.locationType && profile.locationType !== locationType)     setLocationType(profile.locationType);
  if (!document.getElementById('biz-address').value && profile.address) document.getElementById('biz-address').value  = profile.address;
  if (!document.getElementById('biz-region')?.value && profile.region)  document.getElementById('biz-region').value   = profile.region;
}

function loadProfile() {
  Object.assign(profile,BBSetup.nameParts({...profile,ownerName:profile.ownerName||(profile.sellerType==='personal'?profile.name:'')||''}));
  window._bbProfileGlobal=profile;
  const personal=profile.sellerType==='personal';
  document.body.classList.toggle('personal-seller', personal);
  if (personal) {
    profile.name = profile.ownerName;
  }
  ['profile-name','profile-owner-role','profile-hours','profile-street','biz-hours'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.hidden=personal;
    const label=document.querySelector('label[for="'+id+'"]');if(label)label.hidden=personal;
  });
  const loc=document.getElementById('prof-loc-btn-physical')?.closest('.loc-type-toggle');if(loc)loc.hidden=personal;
  const nameLabel=document.querySelector('label[for="profile-name"]');if(nameLabel)nameLabel.textContent=personal?'Seller name':'Business Name';
  document.getElementById('profile-name').placeholder=personal?'Your name':'Your business name';
  const profileTitle=document.getElementById('profile-name').closest('.card')?.querySelector('.card-title');if(profileTitle)profileTitle.textContent=personal?'Seller Profile':'Business Profile';
  document.getElementById('profile-name').value    = profile.name      || '';
  if (document.getElementById('profile-owner-name')) document.getElementById('profile-owner-name').value = profile.ownerFirstName || '';
  document.getElementById('profile-owner-last-name').value = profile.ownerLastName || '';
  if (document.getElementById('profile-owner-role')) document.getElementById('profile-owner-role').value = profile.ownerRole || 'owner';
  document.getElementById('profile-cat').value     = profile.category  || '';
  document.getElementById('profile-phone').value   = profile.phone    || '';
  document.getElementById('profile-email').value   = profile.email    || '';
  if (document.getElementById('profile-street')) document.getElementById('profile-street').value = profile.street || '';
  if (document.getElementById('profile-city'))   document.getElementById('profile-city').value   = profile.city   || '';
  if (document.getElementById('profile-state'))  document.getElementById('profile-state').value  = profile.state  || '';
  if (document.getElementById('profile-zip'))    document.getElementById('profile-zip').value    = profile.zip    || '';
  if (document.getElementById('profile-region')) document.getElementById('profile-region').value = profile.region || '';
  document.getElementById('profile-website').value = profile.website  || '';
  document.getElementById('profile-hours').value   = profile.hours    || '';
  document.getElementById('profile-tone').value    = profile.tone     || 'friendly';
  const hasName = !!profile.name;
  const nameDisplay = document.getElementById('profile-biz-name');
  if (nameDisplay) {
    nameDisplay.textContent = hasName ? profile.name : (profile.sellerType==='personal'?'⚠️ Seller name not set':'⚠️ Business name not set');
    nameDisplay.style.color = hasName ? 'var(--green)' : 'var(--warn)';
  }
  const _pnameInput = document.getElementById('profile-name');
  if (_pnameInput) _pnameInput.style.borderColor = hasName ? '' : '#FFA726';
  const _mnb = document.getElementById('biz-name-missing-banner'); if (_mnb) { if (hasName || profile.sellerType !== 'business') _mnb.classList.add('hidden'); else _mnb.classList.remove('hidden'); }
  renderPlatformCats(profile.platformCats || {});
  const _pcat = document.getElementById('profile-biz-cat');
  if (_pcat) _pcat.textContent = profile.category || 'Set up your profile below';
  if (profile.locationType) setProfileLocationType(profile.locationType, false);
  // Pre-fill main create form with business data (only if fields are empty)
  if (!document.getElementById('biz-name').value && profile.name)         document.getElementById('biz-name').value     = profile.name;
  if (!document.getElementById('biz-phone').value && profile.phone)       document.getElementById('biz-phone').value    = profile.phone;
  if (!document.getElementById('biz-address').value && profile.address)   document.getElementById('biz-address').value  = profile.address;
  if (!document.getElementById('biz-website').value && profile.website)   document.getElementById('biz-website').value  = profile.website;
  if (!document.getElementById('biz-hours').value && profile.hours)       document.getElementById('biz-hours').value    = profile.hours;
  if (!document.getElementById('biz-region')?.value && profile.region)    document.getElementById('biz-region').value   = profile.region;
  if (profile.locationType && profile.locationType !== locationType)       setLocationType(profile.locationType);
  updateCopyPreview();
}

function setYN(field, val) {
  ynState[field] = val;
  window.BBAds?.markDirty();
  const yes = document.getElementById('yn-' + field + '-yes');
  const no  = document.getElementById('yn-' + field + '-no');
  if (yes) { yes.classList.toggle('yn-active', val === 'yes'); }
  if (no)  { no.classList.toggle('yn-active',  val === 'no');  }
  // Write to the active campaign object so _bbSaveCampaigns persists it
  const _ynCam = (typeof campaigns !== 'undefined') && activeCampaignId &&
    campaigns.find(c => c.id === activeCampaignId);
  if (_ynCam && !window.BBAds?.active) _ynCam['ynMention' + field.charAt(0).toUpperCase() + field.slice(1)] = val;
  debounceCampaignSave();
}

function updateCopyPreview() {
  const parts=BBSetup.nameParts(profile);
  for(const key of ['firstName','lastName']){const el=document.getElementById('copy-'+key+'-preview');const value=parts[key==='firstName'?'ownerFirstName':'ownerLastName'];if(el)el.textContent=value?'→ '+value:'Not saved — add it in Profile';}
  const rolePreview = document.getElementById('copy-role-preview');
  const card        = document.getElementById('about-you-card');
  if (!card) return;
  const hasName = !!profile.ownerName;
  const hasRole = !!profile.ownerRole;
  const locType = profile.locationType || 'physical';
  const hasAddress = locType !== 'online';
  // Show card if name is saved OR location has a physical address
  // about-you-card is now a persistent collapsed accordion — always visible
  if (rolePreview) {
    const roleLabel = profile.ownerRole === 'manager' ? 'Manager' : profile.ownerRole === 'other' ? 'Other' : 'Owner';
    rolePreview.textContent = hasRole ? `→ "${roleLabel}" added to prompt` : '';
  }
  // Disable role Yes button if no name saved (role alone isn't useful)
  const roleYes = document.getElementById('yn-role-yes');
  if (roleYes) roleYes.disabled = !hasName;
  // Show address row only for physical/both — online never uses address
  const addrRow = document.getElementById('yn-address-row');
  if (addrRow) { if (hasAddress) addrRow.classList.remove('hidden'); else addrRow.classList.add('hidden'); }
  // Show phone/email/website rows only if the profile has those values
  const phoneRow = document.getElementById('yn-phone-row');
  if (phoneRow) { if (profile.phone) phoneRow.classList.remove('hidden'); else phoneRow.classList.add('hidden'); }
  const emailRow = document.getElementById('yn-email-row');
  if (emailRow) { if (profile.email) emailRow.classList.remove('hidden'); else emailRow.classList.add('hidden'); }
  const websiteRow = document.getElementById('yn-website-row');
  if (websiteRow) { if (profile.website) websiteRow.classList.remove('hidden'); else websiteRow.classList.add('hidden'); }
}

// ══════════════════════════════════════════
// AUTO-POST SCHEDULE (per-blast / listingDraft)
// ══════════════════════════════════════════

// In-memory map: draftId → schedule state (for Schedule tab)
var _draftSchedules = {};    // { draftId: { schedule, blastName, campaignId, campaignName, platforms[] } }
var _TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function _defaultSched() {
  return { enabled: false, frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 1, timeSlot: 'morning', timezone: _TZ };
}

// ── Quick-schedule widget (Create-tab accordion) ────────────────────────────
// All writes go to the current draft doc (single source of truth)
var _quickSched = _defaultSched();

var _scheduleSaving = new Set();
async function _persistSchedule(did, changes, quick) {
  const bizId = window.activeBizId;
  const key = bizId + '/' + did;
  const prior = { ...(quick ? _quickSched : _getDraftSchedEntry(did).schedule) };
  if (_scheduleSaving.has(key)) { showToast('Please wait for the schedule save.'); return false; }
  _scheduleSaving.add(key);
  try {
    if (!did || !window._bbUpdateDraftSchedule) throw new Error('Save your generated draft before setting a schedule.');
    const candidate = BBSchedule.normalizeSchedule({ ..._defaultSched(), ...prior, ...changes });
    if (candidate.unsupportedFrequency) throw new Error('Choose daily, weekly, or monthly, then enable the schedule.');
    candidate.nextRunAt = candidate.enabled ? _computeNextRunDate(candidate).toISOString() : null;
    // A changed schedule invalidates the previous email's approval/skip state.
    delete candidate.approved; delete candidate.skipCycle; delete candidate.previewSentAt; delete candidate.pauseReason;
    await window._bbUpdateDraftSchedule(did, candidate);
    if (window.activeBizId !== bizId) return false;
    if (_draftSchedules[did]) _draftSchedules[did].schedule = candidate;
    if (did === window._currentDraftId) loadQuickSchedFromDraft(candidate);
    if (!quick) _renderSchedTabFromData(_draftSchedules);
    showToast('Schedule saved.');
    return true;
  } catch(e) {
    if (window.activeBizId === bizId) {
      if (quick) loadQuickSchedFromDraft(prior);
      else _renderSchedTabFromData(_draftSchedules);
      showToast('Schedule not saved. ' + e.message);
    }
    return false;
  } finally { _scheduleSaving.delete(key); }
}
function _saveQuickSchedToDraft(changes = {}) {
  return _persistSchedule(window._currentDraftId, changes, true);
}
function loadQuickSchedFromDraft(schedule) {
  _quickSched = BBSchedule.normalizeSchedule(Object.assign(_defaultSched(), schedule || {}));
  const en = document.getElementById('sched-enabled');
  if (en) en.checked = _quickSched.enabled;
  const sf = document.getElementById('sched-fields');
  if (sf) sf.classList.toggle('hidden', !_quickSched.enabled && !_quickSched.unsupportedFrequency);
  _renderQuickSchedChips();
  _updateQuickSchedPreview();
}
function toggleSchedEnabled() { return _saveQuickSchedToDraft({enabled: document.getElementById('sched-enabled')?.checked || false}); }
function setSchedFreq(f) { return _saveQuickSchedToDraft({frequency:f}); }
function setSchedDay(d) { return _saveQuickSchedToDraft({dayOfWeek:d}); }
function setSchedDom(d) { return _saveQuickSchedToDraft({dayOfMonth:d}); }
function setSchedTime(t) { return _saveQuickSchedToDraft({timeSlot:t}); }

function _renderQuickSchedChips() {
  ['daily','weekly','monthly'].forEach(f => {
    const el = document.getElementById('sched-freq-' + f);
    if (el) el.classList.toggle('active', _quickSched.frequency === f);
  });
  const isMonthly = _quickSched.frequency === 'monthly';
  const dowWrap = document.getElementById('sched-dow-wrap');
  const domWrap = document.getElementById('sched-dom-wrap');
  if (dowWrap) { if (isMonthly) dowWrap.classList.add('hidden'); else dowWrap.classList.remove('hidden'); }
  if (domWrap) { if (isMonthly) domWrap.classList.remove('hidden'); else domWrap.classList.add('hidden'); }
  [0,1,2,3,4,5,6].forEach(d => {
    const el = document.getElementById('sched-dow-' + d);
    if (el) el.classList.toggle('active', _quickSched.dayOfWeek === d);
  });
  [1,8,15,22].forEach(d => {
    const el = document.getElementById('sched-dom-' + d);
    if (el) el.classList.toggle('active', _quickSched.dayOfMonth === d);
  });
  ['morning','midday','afternoon','evening'].forEach(t => {
    const el = document.getElementById('sched-time-' + t);
    if (el) el.classList.toggle('active', _quickSched.timeSlot === t);
  });
}

function _updateQuickSchedPreview() {
  const el = document.getElementById('sched-next-preview');
  if (!el) return;
  if (_quickSched.unsupportedFrequency) { el.textContent = 'This old schedule is paused. Choose daily, weekly, or monthly, then enable it.'; return; }
  if (!_quickSched.enabled) { el.textContent = ''; return; }
  try {
    const next = _computeNextRunDate(_quickSched);
    const label = next.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', timeZone: (_quickSched.timezone || _TZ) });
    const slot  = { morning:'9am', midday:'12pm', afternoon:'3pm', evening:'6pm' }[_quickSched.timeSlot] || '';
    el.textContent = '📅 Next post: ' + label + ' at ' + slot;
  } catch(_) {}
}

// ── Schedule tab — comprehensive per-blast view ─────────────────────────────
// _draftSchedules map is populated by window._bbLoadDraftSchedules (module script)

function _slotLabel(t) {
  return { morning:'☀️ 9am', midday:'🌤 12pm', afternoon:'⛅ 3pm', evening:'🌙 6pm' }[t] || t;
}

function _freqLabel(s) {
  return { daily:'Daily', weekly:'Weekly', monthly:'Monthly' }[s.frequency] || 'Unsupported — paused';
}

function _schedNextLine(s) {
  try {
    const next  = s.nextRunAt ? new Date(s.nextRunAt) : _computeNextRunDate(s);
    const label = next.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', timeZone:s.timezone || _TZ });
    const slot  = { morning:'9am', midday:'12pm', afternoon:'3pm', evening:'6pm' }[s.timeSlot] || '';
    return '📅 Next post: ' + label + ' at ' + slot;
  } catch(_) { return ''; }
}

function renderScheduleTab() {
  if(window.BBLifecycle && window._bbGetToken && window.activeBizId){BBLifecycle.configure({businessId:window.activeBizId,token:window._bbGetToken});return BBLifecycle.dashboard();}
  if (window._bbLoadDraftSchedules) {
    window._bbLoadDraftSchedules().then(_renderSchedTabFromData).catch(() => _renderSchedTabFromData({}));
  } else {
    _renderSchedTabFromData(_draftSchedules);
  }
}

function _renderSchedTabFromData(data) {
  _draftSchedules = data || {};
  const wrap  = document.getElementById('sched-campaigns-wrap');
  const empty = document.getElementById('sched-no-campaigns');
  if (!wrap) return;

  // Group drafts by campaign
  const bycamp = {}; // { campaignId: { name, drafts: [{draftId, blastName, schedule, platforms}] } }
  Object.entries(_draftSchedules).forEach(([draftId, entry]) => {
    const cid  = entry.campaignId  || '_none';
    const cname = entry.campaignName || 'Uncategorised';
    if (!bycamp[cid]) bycamp[cid] = { name: cname, drafts: [] };
    bycamp[cid].drafts.push({ draftId, ...entry });
  });

  const campEntries = Object.entries(bycamp);
  if (!campEntries.length) {
    if (empty) empty.classList.remove('hidden');
    _renderSchedUpcoming();
    return;
  }
  if (empty) empty.classList.add('hidden');

  wrap.innerHTML = campEntries.map(([, camp]) => {
    const blastCards = camp.drafts.map(d => _buildBlastSchedCard(d)).join('');
    return `<div class="csched-campaign-group">
      <div class="csched-camp-header">📣 ${escHtml(camp.name)}</div>
      ${blastCards}
    </div>`;
  }).join('');

  _renderSchedUpcoming();
}

function _buildBlastSchedCard(entry) {
  const did       = entry.draftId;
  const s         = BBSchedule.normalizeSchedule(entry.schedule || _defaultSched());
  const isMonthly = s.frequency === 'monthly';
  const isDaily   = s.frequency === 'daily';
  const nextLine  = s.enabled ? _schedNextLine(s) : '';
  const freqs     = ['daily','weekly','monthly'];
  const platNames = (entry.platforms || []).join(' · ');

  return `<div class="card csched-card" id="csched-card-${escHtml(did)}">
    <div class="csched-header">
      <div>
        <div class="csched-name">${escHtml(entry.blastName || 'Blast')}</div>
        ${platNames ? `<div class="csched-plats">${escHtml(platNames)}</div>` : ''}
      </div>
      <label class="sched-toggle-wrap">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleDraftSched('${escHtml(did)}',this.checked)" />
        <span class="sched-toggle-track"></span>
      </label>
    </div>
    ${!s.enabled && s.pauseReason ? `<p role="status">Paused: ${escHtml(s.pauseReason)}</p>` : ''}
    <div class="csched-fields${s.enabled || s.unsupportedFrequency ? '' : ' hidden'}" id="csched-fields-${escHtml(did)}">
      ${s.unsupportedFrequency ? '<p role="status">Old schedule paused. Choose a supported frequency, then enable it.</p>' : ''}
      <label class="csched-lbl">How often?</label>
      <div class="sched-chips" id="csched-freq-row-${escHtml(did)}">
        ${freqs.map(f => `<button type="button" class="sched-chip${s.frequency===f?' active':''}" onclick="setDraftSchedFreq('${escHtml(did)}','${f}')">${_freqLabel({frequency:f,customDays:s.customDays})}</button>`).join('')}
      </div>
      <div id="csched-dow-wrap-${escHtml(did)}"${isMonthly||isDaily?' class="hidden"':''}>
        <label class="csched-lbl">Which day?</label>
        <div class="sched-chips">
          ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=>`<button type="button" class="sched-chip${s.dayOfWeek===i?' active':''}" onclick="setDraftSchedDay('${escHtml(did)}',${i})">${d}</button>`).join('')}
        </div>
      </div>
      <div id="csched-dom-wrap-${escHtml(did)}"${isMonthly?'':' class="hidden"'}>
        <label class="csched-lbl">Which day of the month?</label>
        <div class="sched-chips">
          ${[[1,'1st'],[8,'8th'],[15,'15th'],[22,'22nd']].map(([v,l])=>`<button type="button" class="sched-chip${s.dayOfMonth===v?' active':''}" onclick="setDraftSchedDom('${escHtml(did)}',${v})">${l}</button>`).join('')}
        </div>
      </div>
      <label class="csched-lbl">What time?</label>
      <div class="sched-chips">
        ${['morning','midday','afternoon','evening'].map(t=>`<button type="button" class="sched-chip${s.timeSlot===t?' active':''}" onclick="setDraftSchedTime('${escHtml(did)}','${t}')">${_slotLabel(t)}</button>`).join('')}
      </div>
      ${nextLine ? `<div class="csched-next">${escHtml(nextLine)}</div>` : '<div class="csched-next" id="csched-next-'+escHtml(did)+'"></div>'}
    </div>
  </div>`;
}

function _renderSchedUpcoming() {
  const list = document.getElementById('sched-upcoming-list');
  if (!list) return;
  const rows = Object.values(_draftSchedules)
    .filter(e => e.schedule?.enabled)
    .map(e => {
      const nextDate = (() => { try { return _computeNextRunDate(e.schedule); } catch(_) { return null; } })();
      return { name: (e.campaignName ? e.campaignName + ' — ' : '') + (e.blastName || 'Blast'), next: _schedNextLine(e.schedule), sortTs: nextDate ? nextDate.getTime() : Infinity };
    })
    .filter(r => r.next)
    .sort((a, b) => a.sortTs - b.sortTs);

  if (!rows.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">🗓️</div><div class="empty-text">No active schedules yet.<br/>Turn on a schedule on any blast below.</div></div>';
    return;
  }
  list.innerHTML = rows.map(r => `
    <div class="csched-upcoming-row">
      <div class="csched-upcoming-name">${escHtml(r.name)}</div>
      <div class="csched-upcoming-next">${escHtml(r.next)}</div>
    </div>`).join('');
}

// ── Per-blast schedule controls (Schedule tab inline editing) ────────────────
function _getDraftSchedEntry(did) {
  return _draftSchedules[did] || { schedule: _defaultSched() };
}

function _updateDraftSchedAndSave(did, changes) { return _persistSchedule(did, changes, false); }
function toggleDraftSched(did, enabled) { return _updateDraftSchedAndSave(did, { enabled }); }
function setDraftSchedFreq(did, frequency) { return _updateDraftSchedAndSave(did, { frequency }); }
function setDraftSchedDay(did, dayOfWeek) { return _updateDraftSchedAndSave(did, { dayOfWeek }); }
function setDraftSchedDom(did, dayOfMonth) { return _updateDraftSchedAndSave(did, { dayOfMonth }); }
function setDraftSchedTime(did, timeSlot) { return _updateDraftSchedAndSave(did, { timeSlot }); }
function _computeNextRunDate(sched) { return BBSchedule.computeNextRunAt(sched, new Date()); }

// ══════════════════════════════════════════
// PENDING POSTS (review queue)
// ══════════════════════════════════════════
var _pendingPosts = [];

window._bbSetPendingPosts = function(posts) {
  _pendingPosts = posts || [];
  _renderPendingPosts();
};

function _renderPendingPosts() {
  const card  = document.getElementById('pending-posts-card');
  const list  = document.getElementById('pending-posts-list');
  const badge = document.getElementById('pending-posts-count');
  if (!card || !list) return;

  const pending = _pendingPosts.filter(p => p.status === 'pending');
  if (card) { if (pending.length) card.classList.remove('hidden'); else card.classList.add('hidden'); }
  if (badge) badge.textContent = pending.length + ' draft' + (pending.length !== 1 ? 's' : '');

  list.innerHTML = pending.map(p => {
    const d = p.createdAt?.toDate ? p.createdAt.toDate() : (p.createdAt ? new Date(p.createdAt) : new Date());
    const dateLabel = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
    const platformRows = (p.platforms || []).map(pl => {
      const text = (p.adaptations || {})[pl.id] || '';
      if (!text) return '';
      return `<div class="pending-platform-item">
        <div class="pending-platform-name">${escHtml(pl.name)}</div>
        <div class="pending-platform-text">${escHtml(text)}</div>
      </div>`;
    }).join('');
    return `<div class="pending-post-card">
      <div class="pending-post-date">Drafted ${dateLabel}</div>
      ${platformRows}
      <div class="pending-post-actions">
        <button type="button" onclick="_approvePendingPost('${p.id}')" class="pending-approve-btn">
          ✅ Approve &amp; Post
        </button>
        <button type="button" onclick="_dismissPendingPost('${p.id}')" class="pending-skip-btn">
          🗑️ Skip
        </button>
      </div>
    </div>`;
  }).join('');
}

const pendingDecisions = new Set();
async function _decidePendingPost(id, action) {
  const bizId = window.activeBizId;
  const key = bizId + '/' + id;
  if (pendingDecisions.has(key)) return;
  pendingDecisions.add(key);
  try {
    if (!bizId || !window._bbGetToken) throw new Error('Please sign in and select a business.');
    const token = await window._bbGetToken();
    if (!token) throw new Error('Please sign in again.');
    const resp = await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/approvePendingPost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ pendingPostId: id, bizId, action }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(result.error || 'Could not save your decision.');
    showToast(action === 'dismiss' ? 'Draft dismissed' : 'Approved — check Publishing Status for the next step.');
  } catch(e) {
    showToast(e.message + ' You can retry.');
  } finally { pendingDecisions.delete(key); }
}
async function _approvePendingPost(id) { return _decidePendingPost(id, 'approve'); }
async function _dismissPendingPost(id) { return _decidePendingPost(id, 'dismiss'); }

// ══════════════════════════════════════════
// AI ENRICHMENT — bizInsights + factoids
// ══════════════════════════════════════════
var bizInsights      = [];   // [{question, answer, askedAt, answeredAt}]
var factoidScope     = 'campaign'; // 'campaign' | 'global'

function loadInsights(insights) {
  bizInsights = insights || [];
  renderEnrichmentQuestions();
  renderProfileInsights();
}

var teachAIOpen = false;

function toggleTeachAI() {} // legacy stub — kept for safety

// ── Right-column accordion ────────────────────────────────────────────────────
function toggleRightAccordion(bodyId, chevronId, onOpenCallback) {
  const body = document.getElementById(bodyId);
  const chev = document.getElementById(chevronId);
  if (!body) return;
  const nowHidden = body.classList.toggle('hidden');
  if (chev) chev.style.transform = nowHidden ? '' : 'rotate(90deg)';
  if (!nowHidden && typeof onOpenCallback === 'function') onOpenCallback();
}

// ── Campaign memory: edits retain their original business and campaign. ──────
const _campaignMemoryEdits = new Map();
let _businessMemoryReview = null;
const _memoryEditorIds = ['tai-memory-text', 'create-camp-memory-text'];
function initTeachAIAccordion() {
  syncCampaignMemoryEditors();
  renderFactoidQuickLook();
}
function syncCampaignMemoryEditors() {
  const cam = campaigns.find(c => c.id === activeCampaignId);
  const businessId = window.activeBizId || '';
  for (const id of _memoryEditorIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.dataset.businessId !== businessId || el.dataset.campaignId !== (cam?.id || '')) {
      el.dataset.businessId = businessId;
      el.dataset.campaignId = cam?.id || '';
      el.value = cam?.campaignMemory || '';
    }
    el.disabled = !cam;
  }
  for (const id of ['tai-memory-working', 'create-memory-working']) {
    const el = document.getElementById(id);
    if (el) el.textContent = cam ? 'Working on: ' + cam.name : 'Choose a campaign first.';
  }
  for (const el of document.querySelectorAll('.memory-share-action')) el.disabled = !cam;
}
function memoryEditStatus(id, text) {
  if (id === 'tai-memory-text') _showTAISaved(text);
  else _showCreateCampMemorySaved(text);
}
function captureCampaignMemory(id) {
  const el = document.getElementById(id);
  if (!el?.dataset.campaignId || !window.currentUser?.uid) throw new Error('Choose a campaign first.');
  const edit = { id, businessId: el.dataset.businessId, campaignId: el.dataset.campaignId,
    uid: window.currentUser.uid, text: el.value };
  const key = JSON.stringify([edit.uid, edit.businessId, edit.campaignId]);
  const previous = _campaignMemoryEdits.get(key);
  clearTimeout(previous?.timer);
  edit.key = key;
  edit.previous = previous?.promise || previous?.previous;
  _campaignMemoryEdits.set(key, edit);
  // Both editors show the same campaign brief. Only the field being edited supplies a write.
  for (const otherId of _memoryEditorIds) {
    const other = document.getElementById(otherId);
    if (other && other !== el && other.dataset.businessId === edit.businessId && other.dataset.campaignId === edit.campaignId) other.value = edit.text;
  }
  return edit;
}
async function persistCampaignMemory(edit) {
  clearTimeout(edit.timer);
  if (edit.promise) return edit.promise;
  edit.promise = (async () => {
    await edit.previous?.catch(() => {});
    try {
      if (!window._bbSaveCampaignMemory) throw new Error('Saving is not ready yet.');
      await window._bbSaveCampaignMemory(edit.campaignId, edit.text, edit);
      if (_campaignMemoryEdits.get(edit.key) === edit) {
        _campaignMemoryEdits.delete(edit.key);
        if (window.activeBizId === edit.businessId) {
          const cam = campaigns.find(c => c.id === edit.campaignId);
          if (cam) cam.campaignMemory = edit.text;
        }
        const el = document.getElementById(edit.id);
        if (el?.dataset.businessId === edit.businessId && el.dataset.campaignId === edit.campaignId) memoryEditStatus(edit.id, 'Saved for this campaign ✓');
      }
    } catch (error) {
      memoryEditStatus(edit.id, 'Could not save. Tap Save to retry.');
      throw error;
    }
  })();
  try { return await edit.promise; }
  finally { edit.promise = null; }
}
function queueCampaignMemory(id) {
  try {
    const edit = captureCampaignMemory(id);
    memoryEditStatus(id, 'Saving…');
    edit.timer = setTimeout(() => void persistCampaignMemory(edit).catch(() => {}), 1500);
  } catch (error) { showToast(error.message); }
}
async function saveCampaignMemoryEditor(id) {
  try { await persistCampaignMemory(captureCampaignMemory(id)); }
  catch (error) { showToast(error.message); }
}
async function flushCampaignMemoryEdits() {
  await Promise.all([..._campaignMemoryEdits.values()].map(persistCampaignMemory));
}
function debounceAIMemorySave() { queueCampaignMemory('tai-memory-text'); }
function saveAIMemoryNow() { return saveCampaignMemoryEditor('tai-memory-text'); }
function debounceCreateCampMemorySave() { queueCampaignMemory('create-camp-memory-text'); }
function saveCreateCampMemoryNow() { return saveCampaignMemoryEditor('create-camp-memory-text'); }
function _showTAISaved(msg) {
  const el = document.getElementById('tai-save-status');
  if (el) { el.textContent = msg; el.style.opacity = '1'; }
}
function openBusinessMemoryReview(editorId) {
  if (!window.activeBizId || !window.currentUser?.uid || !activeCampaignId) { showToast('Choose a campaign first.'); return; }
  const el = document.getElementById(editorId);
  const selected = el ? el.value.slice(el.selectionStart, el.selectionEnd).trim() : '';
  _businessMemoryReview = { businessId: window.activeBizId, uid: window.currentUser.uid };
  const businessName = profile.businessName || profile.name || 'this business';
  document.getElementById('business-memory-title').textContent = 'Use across all ' + businessName + ' campaigns';
  document.getElementById('business-memory-fact').value = selected;
  document.getElementById('business-memory-error').textContent = '';
  document.getElementById('business-memory-dialog').showModal();
  document.getElementById('business-memory-fact').focus();
}
async function confirmBusinessMemoryReview() {
  const fact = document.getElementById('business-memory-fact').value.trim();
  const error = document.getElementById('business-memory-error');
  if (!fact) { error.textContent = 'Enter the fact you want to use across all campaigns.'; return; }
  const target = _businessMemoryReview;
  if (!target || target.businessId !== window.activeBizId || target.uid !== window.currentUser?.uid) {
    error.textContent = 'The business changed. Close this and try again.'; return;
  }
  const button = document.getElementById('business-memory-confirm');
  button.disabled = true;
  try {
    const memory = await window._bbAppendBusinessMemory(fact, target);
    if (target.businessId === window.activeBizId && target.uid === window.currentUser?.uid) {
      window._globalMemory = memory;
      profile.globalMemory = memory;
    }
    document.getElementById('business-memory-dialog').close();
    showToast('Saved across this business’s campaigns.');
  } catch (e) { error.textContent = 'Could not save. Your fact is still here. Please retry.'; }
  finally { button.disabled = false; }
}

function _showCreateCampMemorySaved(msg) {
  const el = document.getElementById('create-camp-memory-status');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// #1 Trial save nudge — flash the trial banner to draw attention
window._flashTrialBanner = function() {
  const b = document.getElementById('trial-banner');
  if (!b || getComputedStyle(b).display === 'none') return;
  b.style.background = '#a84000';
  clearTimeout(b._ft);
  b._ft = setTimeout(() => { b.style.background = '#7c2d00'; }, 900);
};

// #8 Profile save indicator — same pattern as _showCreateCampMemorySaved
window._showProfileSaved = function(msg) {
  const el = document.getElementById('profile-save-status');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
};

// #3 Recent campaigns bar — shown for returning users with 2+ campaigns
function renderRecentActivity() {
  const bar  = document.getElementById('recent-activity-bar');
  const list = document.getElementById('recent-activity-list');
  if (!bar || !list) return;
  const _camps = (typeof campaigns !== 'undefined' && campaigns.length) ? campaigns : (window._bbCampaigns || []);
  if (_camps.length < 2) { bar.style.display = 'none'; return; }
  const sorted = [..._camps].sort((a, b) =>
    new Date(b.lastUsedAt || b.createdAt || 0) - new Date(a.lastUsedAt || a.createdAt || 0)
  ).slice(0, 3);
  list.innerHTML = '';
  sorted.forEach(c => {
    const ts  = c.lastUsedAt || c.createdAt;
    const ago = ts ? _bbTimeAgoShort(new Date(ts)) : '';
    const statusText = c.offer ? 'In progress' : 'New';
    const statusColor = c.offer ? '#4caf50' : '#888';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;border-radius:4px;';
    const nameSpan   = document.createElement('span');
    nameSpan.style.cssText = 'font-size:13px;font-weight:600;color:var(--light,#f0f0f0);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameSpan.textContent = c.name || '(unnamed)';
    const statusSpan = document.createElement('span');
    statusSpan.style.cssText = `font-size:11px;color:${statusColor};flex-shrink:0;`;
    statusSpan.textContent = statusText;
    const agoSpan    = document.createElement('span');
    agoSpan.style.cssText = 'font-size:11px;color:var(--muted,#888);flex-shrink:0;';
    agoSpan.textContent = ago;
    row.appendChild(nameSpan); row.appendChild(statusSpan); row.appendChild(agoSpan);
    row.addEventListener('click', () => { if(typeof selectCampaign==='function') selectCampaign(c.id, c.name || ''); });
    list.appendChild(row);
  });
  bar.style.display = 'block';
}
function _bbTimeAgoShort(date) {
  if (!date || isNaN(date)) return '';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)  return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function renderProfileInsights() {
  const el      = document.getElementById('profile-insight-list');
  const sub     = document.getElementById('teach-ai-sub');
  const moreBtn = document.getElementById('profile-enrich-more-btn');
  if (!el) return;

  const answered   = bizInsights.filter(i => !!i.answer);
  const unanswered = bizInsights.filter(i => !i.answer);

  if (sub) {
    sub.textContent = answered.length
      ? answered.length + ' answered — AI knows you better!'
      : 'Answer a few questions — AI uses them in every post';
  }

  if (!bizInsights.length) {
    el.innerHTML = '<p class="pir-empty">Generating personalized questions…</p>';
    if (moreBtn) moreBtn.classList.add('hidden');
    return;
  }

  el.innerHTML = bizInsights.map((item, idx) => {
    const hasAnswer = !!item.answer;
    return `<div class="pir-row">
      <button type="button" onclick="toggleInsightRow(${idx})" class="pir-btn">
        <div class="pir-content">
          <div class="pir-question">${escHtml(item.question)}</div>
          <div style="font-size:12px;margin-top:3px;color:${hasAnswer ? 'var(--green)' : 'var(--muted)'};">${hasAnswer ? '✓ ' + escHtml(item.answer) : 'Tap to answer'}</div>
        </div>
        <span id="pir-chevron-${idx}" class="pir-chevron">›</span>
      </button>
      <div id="pir-body-${idx}" class="pir-body-wrap bb-style-c8be1ccb">
        <textarea id="pir-inp-${idx}" rows="2" class="pir-textarea"
          placeholder="Your answer…"
          oninput="this.style.height='auto';this.style.height=Math.max(42,this.scrollHeight)+'px'"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();saveProfileInsightAnswer(${idx},this.value);}"
        >${escHtml(item.answer||'')}</textarea>
        <button type="button" onclick="saveProfileInsightAnswer(${idx},document.getElementById('pir-inp-${idx}').value)" class="pir-save-btn">
          ✓ Save
        </button>
      </div>
    </div>`;
  }).join('');

  if (moreBtn) { if (unanswered.length === 0) moreBtn.classList.remove('hidden'); else moreBtn.classList.add('hidden'); }
}

function toggleInsightRow(idx) {
  const body    = document.getElementById('pir-body-' + idx);
  const chevron = document.getElementById('pir-chevron-' + idx);
  const isOpen  = body && getComputedStyle(body).display !== 'none';
  bizInsights.forEach((_, i) => {
    const b = document.getElementById('pir-body-' + i);
    const c = document.getElementById('pir-chevron-' + i);
    if (b) b.style.display = 'none';
    if (c) c.style.transform = '';
  });
  if (!isOpen && body) {
    body.style.display = 'block';
    if (chevron) chevron.style.transform = 'rotate(90deg)';
    const inp = document.getElementById('pir-inp-' + idx);
    if (inp) setTimeout(() => inp.focus(), 50);
  }
}

function saveProfileInsightAnswer(idx, answer) {
  answer = (answer || '').trim();
  if (!answer) { showToast('Type your answer first'); return; }
  if (bizInsights[idx]) {
    bizInsights[idx].answer     = answer;
    bizInsights[idx].answeredAt = new Date().toISOString();
  }
  renderProfileInsights();
  renderEnrichmentQuestions();
  if (window._saveInsightToFirestore) window._saveInsightToFirestore(bizInsights);
  showToast('✓ Saved — AI will use this in every post');
}

// ══════════════════════════════════════════
// ADD INFO — factoid panel
// ══════════════════════════════════════════
function toggleAddInfoPanel() {
  const panel = document.getElementById('add-info-panel');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    if (!activeCampaignId) { showToast('Select a campaign first'); return; }
    panel.classList.remove('hidden');
    document.getElementById('add-info-confirm').classList.add('hidden');
    document.getElementById('add-info-text').focus();
    setFactoidScope('campaign');
  } else {
    panel.classList.add('hidden');
  }
  const chev = document.getElementById('add-info-chevron');
  if (chev) chev.style.transform = panel.classList.contains('hidden') ? '' : 'rotate(90deg)';
}

function setFactoidScope(scope) {
  factoidScope = scope;
  document.getElementById('scope-btn-campaign').classList.toggle('active', scope === 'campaign');
  document.getElementById('scope-btn-global').classList.toggle('active', scope === 'global');
  const badge = document.getElementById('add-info-scope-badge');
  if (badge) {
    badge.textContent = scope === 'global' ? 'All Campaigns' : 'This Campaign';
    badge.className = scope === 'global' ? 'tier-badge tier-badge--global' : 'tier-badge tier-badge--campaign';
  }
}

function refreshPhotoGridForScope() {
  window._bbSelectedPhotoIndex = null;
  const pendingItems = [...window._bbPhotoUploads].filter(photoUploadMatchesView);
  window._bbPhotoItems = pendingItems;
  if (window.renderAllPhotos) window.renderAllPhotos();
  if (photoScope === 'global') {
    window._bbPhotoItems = (window._globalImages || []).map(img => ({
      url: img.url, path: img.path || null, localUrl: img.url,
      done: true, progress: 100, id: img.id, scope: 'global', bizId: window.activeBizId
    }));
    window._bbPhotoItems.push(...pendingItems.filter(item => !window._bbPhotoItems.some(saved =>
      (item.id && saved.id === item.id) || (item.url && saved.url === item.url))));
    if (window.renderAllPhotos) window.renderAllPhotos();
    updatePhotoCapLabel();
    const hint = document.getElementById('photo-scope-hint');
    if (hint) hint.textContent = 'Global photos are shared across all campaigns (logo, storefront, team photos, etc.).';
  } else {
    const hint = document.getElementById('photo-scope-hint');
    if (hint) hint.textContent = activeCampaignId
      ? 'Photos are included automatically. Tap Selected to leave one out of this blast.'
      : 'Select a campaign above before adding campaign photos.';
    const cid = activeCampaignId;
    const applyImages = images => {
      if (window._bbPhotoItems !== pendingItems || photoScope !== 'campaign' || activeCampaignId !== cid) return;
      const cam = campaigns.find(c => c.id === cid) || {};
      // New subcollection records must not hide older campaign-array photos.
      const photos = [...images, ...(cam.photos || [])];
      const seenUrls = new Set();
      window._bbPhotoItems = photos.map(p => {
        const img = typeof p === 'string' ? { url: p } : p;
        if (!img?.url || seenUrls.has(img.url)) return null;
        seenUrls.add(img.url);
        return { ...img, localUrl: img.url, path: img.path || null,
          done: true, progress: 100, scope: 'campaign', campaignId: cid, bizId: window.activeBizId };
      }).filter(Boolean);
      // Keep uploads started while this campaign read was pending.
      window._bbPhotoItems.push(...pendingItems.filter(item => !window._bbPhotoItems.some(saved =>
        (item.id && saved.id === item.id) || (item.url && saved.url === item.url))));
      window._bbSelectedPhotoIndex = null;
      if (window.renderAllPhotos) window.renderAllPhotos();
      updatePhotoCapLabel();
    };
    if (cid && window._bbLoadCampaignImages) {
      window._bbLoadCampaignImages(cid).then(applyImages).catch(() => {
        if (window._bbPhotoItems !== pendingItems || photoScope !== 'campaign' || activeCampaignId !== cid) return;
        applyImages([]);
        if (hint) hint.textContent = 'Could not load campaign photos. Tap Campaign to retry; saved photos may be missing from this view.';
      });
    } else {
      applyImages([]);
    }
  }
}

function setPhotoScope(scope) {
  photoScope = scope;
  document.getElementById('scope-photo-campaign')?.classList.toggle('active', scope === 'campaign');
  document.getElementById('scope-photo-campaign')?.style && (document.getElementById('scope-photo-campaign').style.background = scope === 'campaign' ? 'var(--accent)' : 'transparent');
  document.getElementById('scope-photo-campaign')?.style && (document.getElementById('scope-photo-campaign').style.color = scope === 'campaign' ? '#fff' : 'var(--light)');
  document.getElementById('scope-photo-global')?.classList.toggle('active', scope === 'global');
  document.getElementById('scope-photo-global')?.style && (document.getElementById('scope-photo-global').style.background = scope === 'global' ? 'var(--accent)' : 'transparent');
  document.getElementById('scope-photo-global')?.style && (document.getElementById('scope-photo-global').style.color = scope === 'global' ? '#fff' : 'var(--light)');
  refreshPhotoGridForScope();
}

async function submitFactoid() {
  const text = (document.getElementById('add-info-text').value || '').trim();
  if (!text) { showToast('Add some text first'); return; }
  const entry = { text, addedAt: new Date().toISOString() };
  try {
    let savedId = null;
    if (factoidScope === 'global') {
      if (!window._bbSaveGlobalFact) { showToast('Not ready — try again'); return; }
      const id = await window._bbSaveGlobalFact(entry);
      savedId = id;
      window._globalFactoids.push({ ...entry, id });
    } else {
      if (!activeCampaignId) { showToast('Select a campaign first'); return; }
      if (!window._bbSaveCampaignFact) { showToast('Not ready — try again'); return; }
      const cam = campaigns.find(c => c.id === activeCampaignId);
      if (!cam) { showToast('No active campaign'); return; }
      const id = await window._bbSaveCampaignFact(activeCampaignId, entry);
      savedId = id;
      if (!cam.factoids) cam.factoids = [];
      cam.factoids.push({ ...entry, id });
    }
    document.getElementById('add-info-text').value = '';
    const confirm = document.getElementById('add-info-confirm');
    if (confirm) { confirm.classList.remove('hidden'); setTimeout(() => confirm.classList.add('hidden'), 2000); }
    showToast('✓ Saved — AI will use this');
    if (savedId && window._bbScoreAndSaveFact) window._bbScoreAndSaveFact(savedId, text, factoidScope, activeCampaignId);
    renderFactoidQuickLook();
  } catch(e) {
    showToast('❌ Save failed: ' + (e.message || 'unknown'));
  }
}

function renderFactoidQuickLook() {
  const el = document.getElementById('tai-fact-quicklook');
  if (!el) return;
  const gFacts = window._globalFactoids || [];
  const cam = activeCampaignId ? campaigns.find(c => c.id === activeCampaignId) : null;
  const cFacts = cam ? (cam.factoids || []) : [];
  const top = [...gFacts].sort((a, b) => (b.importance != null ? b.importance : 5) - (a.importance != null ? a.importance : 5)).slice(0, 3);
  el.innerHTML =
    '<div class="bb-style-5d1cafe9">' +
      '<span class="bb-style-9d5113c7">📌 ' + gFacts.length + ' global · ' + cFacts.length + ' campaign facts</span>' +
      '<a href="BlastyBiz-Memory.html" class="bb-style-11bb39db">Manage all →</a>' +
    '</div>' +
    top.map(function(f) {
      var s = f.importance != null ? f.importance : null;
      var bg = s == null ? 'var(--border,#333)' : s >= 7 ? '#16a34a' : s >= 4 ? '#d97706' : '#6b7280';
      var label = s != null ? s : '?';
      var txt = (f.text || '').length > 60 ? f.text.slice(0, 60) + '…' : f.text;
      return '<div class="bb-style-06de7537">' +
        '<span class="bb-style-1fdd5485">' + label + '</span>' +
        '<span class="bb-style-820955e5">' + txt + '</span>' +
        '</div>';
    }).join('');
}
window.renderFactoidQuickLook = renderFactoidQuickLook;

function renderEnrichmentQuestions() {
  const el     = document.getElementById('enrichment-questions');
  const badge  = document.getElementById('enrichment-badge');
  const moreBtn = document.getElementById('enrichment-more-btn');
  if (!el) return;

  const unanswered = bizInsights.filter(i => !i.answer);
  const answered   = bizInsights.filter(i => !!i.answer);

  if (badge) badge.textContent = answered.length ? answered.length + ' answered' : '';

  if (!bizInsights.length) {
    el.innerHTML = '<p class="note-muted-pad">Generating personalized questions…</p>';
    fetchEnrichmentQuestions(false);
    return;
  }

  let html = '';
  unanswered.forEach(item => {
    const idx = bizInsights.indexOf(item);
    html += `<div class="insight-row">
      <div class="insight-q">${escHtml(item.question)}</div>
      <textarea class="insight-input" id="insight-inp-${idx}" rows="1"
        placeholder="Your answer…"
        oninput="this.style.height='auto';this.style.height=Math.max(38,this.scrollHeight)+'px'"
        onblur="saveInsightAnswer(${idx},this.value)"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();saveInsightAnswer(${idx},this.value);}"
      >${escHtml(item.answer||'')}</textarea>
    </div>`;
  });

  if (answered.length) {
    html += '<div class="mt-6">';
    answered.forEach(item => {
      html += `<div class="insight-answered">✓ <strong>${escHtml(item.question)}</strong><br/>${escHtml(item.answer)}</div>`;
    });
    html += '</div>';
  }

  el.innerHTML = html || '<p class="note-muted">All answered — AI knows you well!</p>';
  if (moreBtn) { if (unanswered.length === 0) moreBtn.classList.remove('hidden'); else moreBtn.classList.add('hidden'); }
}

const escHtml = window.escHtml; // escape-utils.js

function saveInsightAnswer(idx, answer) {
  answer = (answer||'').trim();
  if (!answer || bizInsights[idx]?.answer === answer) return;
  bizInsights[idx].answer = answer;
  bizInsights[idx].answeredAt = new Date().toISOString();
  const inp = document.getElementById('insight-inp-' + idx);
  if (inp) inp.classList.add('saved');
  renderEnrichmentQuestions();
  if (window._saveInsightToFirestore) window._saveInsightToFirestore(bizInsights);
}

async function fetchEnrichmentQuestions(forceNew) {
  const btn = document.getElementById('enrichment-more-btn');
  const el  = document.getElementById('enrichment-questions');
  if (!forceNew && bizInsights.some(i => !i.answer)) { renderEnrichmentQuestions(); return; }
  if (btn) btn.disabled = true;
  if (el && forceNew) el.innerHTML = '<p class="note-muted-pad">Generating questions…</p>';
  try {
    const token = window._bbGetToken ? await window._bbGetToken() : null;
    const resp = await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/generateEnrichmentQuestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
      body: JSON.stringify({
        sellerType: profile.sellerType || 'business',
        itemDetails: [document.getElementById('campaign-context')?.value,document.getElementById('biz-offer')?.value].filter(Boolean).join(' '),
        businessName: profile.name || document.getElementById('biz-name')?.value || '',
        category:     profile.category || '',
        address:      profile.address || '',
        locationType: profile.locationType || 'physical',
        region:       profile.region || '',
        existingInsights: bizInsights,
      }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data.questions?.length) {
      const now = new Date().toISOString();
      data.questions.forEach(q => {
        if (!bizInsights.some(i => i.question === q)) bizInsights.push({ question: q, answer: '', askedAt: now });
      });
      if (window._saveInsightToFirestore) window._saveInsightToFirestore(bizInsights);
    }
  } catch(e) {
    console.error('fetchEnrichmentQuestions:', e);
    if (el && !bizInsights.length) el.innerHTML = '<p class="note-muted">Couldn\'t load questions right now.</p>';
  }
  renderEnrichmentQuestions();
  if (btn) btn.disabled = false;
}

// ══════════════════════════════════════════
// PLATFORM CATEGORIES — profile editor
// ══════════════════════════════════════════
function renderPlatformCats(cats) {
  const el = document.getElementById('profile-cat-list');
  if (!el) return;
  if (!window.PLATFORM_CATS || !Object.keys(window.PLATFORM_CATS).length) {
    el.innerHTML = '<p class="note-muted">Category lists loading…</p>';
    return;
  }
  cats = cats || {};
  el.innerHTML = '';
  Object.entries(window.PLATFORM_CATS).forEach(([pid, p]) => {
    const current = cats[pid] || p.cats[0];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);';
    const icon = document.createElement('span');
    icon.style.cssText = 'font-size:18px;flex-shrink:0;';
    icon.textContent = p.icon;
    const name = document.createElement('span');
    name.style.cssText = 'font-size:13px;font-weight:600;color:var(--light);width:96px;flex-shrink:0;line-height:1.3;';
    name.textContent = p.name;
    const sel = document.createElement('select');
    sel.id = 'prof-pcat-' + pid;
    sel.style.cssText = 'flex:1;background:var(--dark);border:1px solid var(--border);border-radius:8px;padding:7px 10px;color:var(--light);font-size:12px;font-family:inherit;-webkit-appearance:none;margin-bottom:0;min-width:0;';
    p.cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      if (c === current) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => {
      profile.platformCats = collectPlatformCats();
      savePlatformCatsToFirestore(profile.platformCats);
    };
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(sel);
    el.appendChild(row);
  });
}

function collectPlatformCats() {
  const cats = {};
  if (!window.PLATFORM_CATS) return cats;
  Object.keys(window.PLATFORM_CATS).forEach(pid => {
    const sel = document.getElementById('prof-pcat-' + pid);
    if (sel) cats[pid] = sel.value;
  });
  return cats;
}

function savePlatformCatsToFirestore(cats) {
  if (window._savePlatformCatsToFirestore) window._savePlatformCatsToFirestore(cats);
}

async function rerunAICats() {
  if (!window.PLATFORM_CATS) { showToast('⚠️ Category data not loaded yet'); return; }
  const btn  = document.getElementById('rerun-ai-cats-btn');
  const note = document.getElementById('platcats-note');
  const bizName    = profile.sellerType === 'personal' ? (profile.ownerName || '') : (document.getElementById('profile-name')?.value?.trim() || profile.name || '');
  if (!bizName && profile.sellerType !== 'personal') { showToast('⚠️ Add your business name first'); return; }
  const descParts = [
    profile.category && profile.category !== 'Other' ? profile.category : null,
    profile.website   ? 'Website: ' + profile.website  : null,
    profile.hours     ? 'Hours: '   + profile.hours    : null,
    profile.ownerRole ? 'Role: '    + profile.ownerRole : null,
  ].filter(Boolean);
  const description = descParts.length ? descParts.join('. ') : bizName;
  const { globalMemory: globalMem, campaignMemory: campaignMem } = _getAIMemory();
  const specialNotes = [globalMem, campaignMem].filter(Boolean).join('\n');

  btn.disabled = true;
  btn.textContent = '⏳ AI is thinking…';
  if (note) note.textContent = '';

  const token = window._bbGetToken ? await window._bbGetToken() : null;
  if (!token) {
    showToast('⚠️ Not signed in');
    btn.disabled = false;
    btn.textContent = '🤖 Re-run AI Category Picker';
    return;
  }

  const locType = profileLocationType || 'physical';
  const platformCatLists = {};
  Object.entries(window.PLATFORM_CATS).forEach(([pid, p]) => { platformCatLists[pid] = p.cats; });

  try {
    const resp = await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/resolveCategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        businessName:  bizName,
        ownerName:     profile.ownerName || '',
        description:   description,
        city:          profile.city  || '',
        state:         profile.state || '',
        specialNotes:  specialNotes  || '',
        locationType:  locType,
        platformCatLists,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'AI failed (' + resp.status + ')');
    }
    const data = await resp.json();
    if (data.categories) {
      profile.platformCats = { ...(profile.platformCats || {}), ...data.categories };
      renderPlatformCats(profile.platformCats);
      savePlatformCatsToFirestore(profile.platformCats);
      if (note) note.textContent = '✅ AI updated ' + Object.keys(data.categories).length + ' categories';
      showToast('✅ AI picked new categories');
    } else if (data.followUpQuestions) {
      if (note) note.textContent = profile.sellerType === 'personal' ? '⚠️ Add more detail about the item you are selling.' : '⚠️ AI needs more info — add more detail to your business name or description';
      showToast('⚠️ AI needs a more detailed description');
    }
  } catch(e) {
    showToast('⚠️ ' + (e.message || 'AI failed'));
    if (note) note.textContent = 'Error: ' + (e.message || 'AI failed');
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Re-run AI Category Picker';
  }
}

// ══════════════════════════════════════════
// DRAFT
// ══════════════════════════════════════════
function formatPhone(el) {
  const digits = el.value.replace(/\D/g, '').slice(0, 10);
  if (digits.length > 6) {
    el.value = digits.slice(0, 3) + '-' + digits.slice(3, 6) + '-' + digits.slice(6);
  } else if (digits.length > 3) {
    el.value = digits.slice(0, 3) + '-' + digits.slice(3);
  } else {
    el.value = digits;
  }
}

// ══════════════════════════════════════════
// CAMPAIGNS
// ══════════════════════════════════════════
function renderCreateCampList() {
  const el = document.getElementById('create-camp-list');
  if (!el) return;
  const list = (typeof campaigns !== 'undefined' && campaigns.length) ? campaigns : (window._bbCampaigns || []);
  const sorted = [...list].sort((a,b) => new Date(b.lastUsedAt || b.createdAt || 0) - new Date(a.lastUsedAt || a.createdAt || 0));
  const active = sorted.find(c => c.id === activeCampaignId);
  el.innerHTML = '<details class="header__business-dropdown workspace-campaign-picker"><summary aria-label="Choose campaign"><span></span></summary><div class="header__business-options"></div></details>';
  const picker = el.firstElementChild, summary = picker.querySelector('summary'), options = picker.querySelector('.header__business-options');
  summary.firstElementChild.textContent = active?.name || 'Choose campaign';
  if (!sorted.length) {
    const empty = document.createElement('div');
    empty.className = 'workspace-campaign-empty';
    empty.textContent = 'No campaigns yet. Tap ＋ New.';
    options.appendChild(empty);
  }
  for (const campaign of sorted) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = campaign.name || '(unnamed)';
    button.setAttribute('aria-current', String(campaign.id === activeCampaignId));
    button.addEventListener('click', async () => {
      await selectCampaign(campaign.id, campaign.name || '');
      el.querySelector('.workspace-campaign-picker > summary')?.focus();
    });
    options.appendChild(button);
  }
  if (active) {
    const manage = document.createElement('details');
    manage.className = 'workspace-campaign-manage';
    const label = document.createElement('summary');
    label.textContent = 'Manage campaign';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete current campaign';
    remove.addEventListener('click', () => deleteCampaign(active.id, active.name || ''));
    manage.append(label, remove);
    options.appendChild(manage);
  }
  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape') { picker.open = false; summary.focus(); event.preventDefault(); return; }
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    event.preventDefault(); picker.open = true;
    const buttons = [...options.children].filter(node => node.tagName === 'BUTTON');
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  });
  if (!window._bbWorkspaceMenusBound) {
    window._bbWorkspaceMenusBound = true;
    document.addEventListener('click', event => {
      document.querySelectorAll('.workspace-campaign-picker[open], .workspace-manage[open]').forEach(menu => {
        if (!menu.contains(event.target)) menu.open = false;
      });
    });
  }
}

function renderCampaignChips() {
  syncCampaignMemoryEditors();
  renderCreateCampList();
  if (typeof renderRecentActivity === 'function') renderRecentActivity();
}

async function selectCampaign(id, name, options = {}) {
  if(window.BBLifecycle?.hasUnsavedChanges?.()&&!window.BBLifecycle.canLeave())return;
  if(window._bbAdaptationBusy || (window.BBAds?.operationBusy ?? window.BBAds?.busy)){showToast('Wait for the current save or generation to finish.');return;}
  if(window.BBAds?.dirty||window.BBAds?.busy){try{await window.BBAds.save();}catch(e){showToast('Could not save your changes. Please retry before switching.');return;}}
  if (window._bbDraftSavePending) { showToast('Use Retry save before switching campaigns.'); return; }
  try { await flushCampaignMemoryEdits(); } catch { showToast('Save your campaign details before switching.'); return; }
  clearTimeout(_campaignSaveTimer);
  activeCampaignId   = id;
  activeCampaignName = name;
  const adReady = window.BBAds?.open(options.adId || '');
  createWizGoTo(1, false, {record:false});
  showTab('create', {record:false});
  document.getElementById('campaign-content')?.classList.remove('hidden');

  const cam = campaigns.find(c => c.id === id) || {};

  const ctxEl = document.getElementById('campaign-context');
  if (ctxEl) ctxEl.value = cam.campaignStory || '';

  // Populate create-tab Teach AI card
  const campMemEl = document.getElementById('create-camp-memory-text');
  if (campMemEl) campMemEl.value = cam.campaignMemory || '';

  // Use the existing scope loader for campaign selection too.
  refreshPhotoGridForScope();

  // Load campaign factoids from subcollection (keep existing if subcollection empty)
  if (window._bbLoadCampaignFactoids) {
    window._bbLoadCampaignFactoids(id).then(facts => {
      const c = campaigns.find(c => c.id === id);
      if (!c) return;
      if (facts.length > 0) {
        c.factoids = facts;
      }
      // If subcollection empty, c.factoids keeps its existing value from campaign doc field
    }).catch(() => {
      // Network error — keep existing c.factoids if any
    });
  }

  renderCampaignChips();
  renderPlatformHistory();
  await adReady;
  if (activeCampaignId !== id) return;
  window._bbRecordWorkspaceRoute?.();
  _updateAdDiscardBtn();
  checkAdaptBtn();
}

function openNewCampaign() {
  const row = document.getElementById('new-campaign-row');
  if (!row) return;
  row.classList.remove('hidden');
  document.getElementById('campaign-content')?.classList.add('hidden');
  const input = document.getElementById('new-campaign-input');
  if (input) { input.value = ''; input.focus(); }
}

function cancelNewCampaign() {
  const row = document.getElementById('new-campaign-row');
  if (row) row.classList.add('hidden');
  if (activeCampaignId) {
    document.getElementById('campaign-content')?.classList.remove('hidden');
  }
}

let quickCampaignSaving = false;
let quickCampaignPending = null;
async function saveNewCampaign() {
  if (quickCampaignSaving) return;
  const input = document.getElementById('new-campaign-input');
  if (!input) return;
  const name  = input.value.trim();
  if (!name) { input.focus(); return; }
  const story = (document.getElementById('new-campaign-story')?.value || '').trim();

  const businessId = window.activeBizId;
  if (!quickCampaignPending || quickCampaignPending.businessId !== businessId) quickCampaignPending = { businessId, id: 'c_' + crypto.randomUUID() };
  const id = quickCampaignPending.id;
  const now = new Date().toISOString();
  const newCampaign = {
    id,
    name,
    createdAt:       now,
    lastUsedAt:      '',
    photos:          [],
    offer:           '',
    adName:          '',
    price:           '',
    campaignStory:   story,
    factoids:        [],
    platformHistory: {},
  };
  quickCampaignSaving = true;
  try {
    if (!window._bbSaveCampaigns) throw new Error('Saving is not ready yet');
    await window._bbSaveCampaigns([newCampaign]);
    if(window.BBAds)await window.BBAds.api('create',{businessId,campaignId:id,adId:'first',requestId:'first',creative:{name:name+' — First Ad',offer:'',price:'',context:'',platforms:platforms.filter(p=>p.enabled).map(p=>p.id)}});
  } catch(e) {
    showToast('Campaign was not saved. Your entries are still here — tap Quick Create to retry.');
    return;
  } finally { quickCampaignSaving = false; }
  quickCampaignPending = null;
  if (window.activeBizId !== businessId) return;
  campaigns = campaigns.filter(c => c.id !== id).concat(newCampaign);
  _sortCampaigns();
  activeCampaignId = id;
  activeCampaignName = name;

  document.getElementById('new-campaign-row').classList.add('hidden');
  document.getElementById('campaign-content')?.classList.remove('hidden');
  // Pre-populate campaign-context textarea with the story entered at creation
  const ctxEl = document.getElementById('campaign-context');
  if (ctxEl) ctxEl.value = story;

  await selectCampaign(id, name);
  showToast('Campaign "' + name + '" created');

  if (window._bbFirstRun) {
    window._bbFirstRun = false;
    const banner = document.getElementById('firstrun-banner');
    if (banner) banner.remove();
    setTimeout(() => {
      const offerField = document.getElementById('biz-offer');
      if (offerField) {
        offerField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        offerField.focus();
        offerField.placeholder = "What are you promoting? e.g. 20% off all services this weekend only";
      }
    }, 400);
  }
}

const deletingCampaigns = new Set();
async function deleteCampaign(id, name) {
  if(deletingCampaigns.has(id))return;
  if (!confirm('Remove campaign "' + name + '"? Scheduled posts will stop. Its history will be kept.')) return;
  deletingCampaigns.add(id);
  try {
    if(!window._bbDeleteCampaign)throw new Error('Please sign in again.');
    await window._bbDeleteCampaign(id);
    campaigns = campaigns.filter(c => c.id !== id);
    if (activeCampaignId === id) {
      activeCampaignId = ''; activeCampaignName = '';
      document.getElementById('campaign-content')?.classList.add('hidden');
    }
    renderCampaignChips();
    showToast('Campaign removed. History kept.');
  } catch(e) { showToast((e.message || 'Campaign could not be removed.') + ' You can retry.'); }
  finally { deletingCampaigns.delete(id); }
}

function _sortCampaigns() {
  campaigns.sort((a, b) => {
    const ta = new Date(a.lastUsedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.lastUsedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
}

// ── Immediate in-memory campaign sync (no Firestore) ─────────────────────────
function updateCampaignMemory() {
  if (!activeCampaignId) return;
  const cam = campaigns.find(c => c.id === activeCampaignId);
  if (!cam) return;
  cam.campaignStory = document.getElementById('campaign-context')?.value || '';
}

// ── Debounced campaign Firestore persistence ─────────────────────────────────
var _campaignSaveTimer = null;

function _showAdDraftStatus(msg) {
  const el = document.getElementById('ad-draft-status');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._fadeTimer);
  el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

function _updateAdDiscardBtn() {
  const cam = campaigns.find(c => c.id === activeCampaignId);
  const hasContent = window.BBAds?.active && ['biz-offer','biz-ad-name','biz-price'].some(id => document.getElementById(id)?.value.trim());
  const btn = document.getElementById('btn-discard-ad');
  if (btn) btn.style.display = hasContent ? 'inline' : 'none';
}

function debounceCampaignSave() {
  if ((window._bbUserPlan || '') === 'trial') { if (window._flashTrialBanner) window._flashTrialBanner(); return; }
  updateCampaignMemory(); // immediate in-memory sync on every keystroke
  _updateAdDiscardBtn();
  clearTimeout(_campaignSaveTimer);
  _campaignSaveTimer = setTimeout(async () => {
    if (!activeCampaignId || !window._bbSaveCampaigns) return;
    const cam = campaigns.find(c => c.id === activeCampaignId);
    if (!cam) return;
    cam.lastUsedAt = new Date().toISOString();
    try {
      await window._bbSaveCampaigns([cam]);
      if (!window.BBAds) throw new Error('Ad saving is not ready yet');
      await window.BBAds.ready();
      await window.BBAds.save();
      _showAdDraftStatus('Saved ✓');
    } catch(e) {
      console.warn('Campaign auto-save failed:', e);
      _showAdDraftStatus('Not saved — tap Save details to retry');
    }
  }, 1500);
}

async function discardAdDraft() {
  if (!confirm('Discard this ad and clear all fields?\n\nThe campaign stays but the offer, details, and price will be erased.')) return;
  ['biz-offer','biz-ad-name','biz-price'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const offerCount = document.getElementById('offer-count');
  if (offerCount) offerCount.textContent = '0 / 500';
  updateCampaignMemory();
  _updateAdDiscardBtn();
  if (activeCampaignId && window._bbSaveCampaigns) {
    try {
      if (!window.BBAds?.active) throw new Error('Your saved ad is still loading.');
      window.BBAds.markDirty();
      await window.BBAds.save();
      _showAdDraftStatus('Ad cleared');
    } catch(e) { console.warn('Discard save failed:', e); }
  }
  checkAdaptBtn();
}

// ── Platform history panel ────────────────────────────────────────────────────
function renderPlatformHistory() {
  const card = document.getElementById('platform-history-card');
  const list = document.getElementById('platform-history-list');
  if (!card || !list) return;

  const cam = campaigns.find(c => c.id === activeCampaignId);
  if (!cam) { card.classList.add('hidden'); return; }

  card.classList.remove('hidden');
  const history = cam.platformHistory || {};

  list.innerHTML = PLATFORMS.map(p => {
    const entries = (history[p.id] || []).slice().reverse();
    const latest  = entries[0];
    const hasHist = entries.length > 0;
    const dateStr = latest ? new Date(latest.ranAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
    const raw     = latest ? (latest.copy || '').replace(/<br\/?>/gi, ' ') : '';
    const preview = raw.length > 80 ? raw.slice(0, 80) + '…' : raw;

    return `<div class="ph-row" onclick="togglePlatformHistory('${p.id}')">
      <div class="ph-row-head">
        <span class="ph-icon">${p.icon}</span>
        <div class="ph-meta">
          <div class="ph-name">${escHtml(p.name)}</div>
          <div class="ph-preview">${hasHist ? escHtml(preview) : '<span class="bb-style-57f9e31d">Not yet used</span>'}</div>
        </div>
        ${hasHist ? `<span class="ph-date">${dateStr}</span>` : ''}
      </div>
      <div class="ph-detail hidden" id="ph-detail-${p.id}">
        ${entries.map(e => `<div class="ph-entry">
          <div class="ph-entry-date">${new Date(e.ranAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'})}${e.schedule && e.schedule.frequency ? ' · ' + escHtml(e.schedule.frequency) : ''}</div>
          <div class="ph-entry-copy">${escHtml((e.copy||'').replace(/<br\/?>/gi,'\n'))}</div>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function togglePlatformHistory(pid) {
  const detail = document.getElementById('ph-detail-' + pid);
  if (detail) detail.classList.toggle('hidden');
}

function saveDraft() {
  updateCampaignMemory(); // keep campaign in-memory object current on every edit
  draft = {
    name:           document.getElementById('biz-name')?.value,
    category:       document.getElementById('biz-category')?.value,
    offer:          document.getElementById('biz-offer')?.value,
    price:          document.getElementById('biz-price')?.value,
    phone:          document.getElementById('biz-phone')?.value,
    locationType:   locationType,
    address:        document.getElementById('biz-address')?.value,
    region:         document.getElementById('biz-region')?.value,
    website:        document.getElementById('biz-website')?.value,
    hours:          document.getElementById('biz-hours')?.value,
    adName:         document.getElementById('biz-ad-name')?.value || '',
    campaignId:     activeCampaignId || '',
    campaignName:   activeCampaignName || '',
  };
  checkAdaptBtn();
}

function loadDraft() {
  if (!draft || !draft.name) {
    // Pre-fill from profile if no draft
    if (profile.name)    document.getElementById('biz-name').value    = profile.name;
    if (profile.phone)   document.getElementById('biz-phone').value   = profile.phone;
    if (profile.website) document.getElementById('biz-website').value = profile.website;
    if (profile.hours)   document.getElementById('biz-hours').value   = profile.hours;
    if (profile.locationType) setLocationType(profile.locationType);
    if (profile.address) document.getElementById('biz-address').value = profile.address;
    if (profile.region)  { const r = document.getElementById('biz-region'); if (r) r.value = profile.region; }
    return;
  }
  document.getElementById('biz-name').value     = draft.name     || '';
  document.getElementById('biz-category').value = draft.category || '';
  document.getElementById('biz-phone').value    = draft.phone    || '';
  document.getElementById('biz-address').value  = draft.address  || '';
  const regionEl = document.getElementById('biz-region');
  if (regionEl) regionEl.value = draft.region || '';
  document.getElementById('biz-website').value  = draft.website  || '';
  document.getElementById('biz-hours').value    = draft.hours    || '';
  if (draft.locationType) setLocationType(draft.locationType);
  if (draft.campaignId) { activeCampaignId = draft.campaignId; activeCampaignName = draft.campaignName || ''; renderCampaignChips(); }
  checkAdaptBtn();
}

// ══════════════════════════════════════════
// STATS
// ══════════════════════════════════════════
function updateStats() {
  const prefs   = window._bbPlatPrefs || {};
  const active  = platforms.filter(p => platformEligible(p) && prefs[p.id]?.status !== 'dismissed');
  const enabled = active.filter(p => p.enabled).length;
  const api     = active.filter(p => p.enabled && p.type === 'api').length;
  const manual  = active.filter(p => p.enabled && p.type === 'manual').length;
  document.getElementById('stat-enabled').textContent = enabled;
  document.getElementById('stat-api').textContent     = api;
  document.getElementById('stat-manual').textContent  = manual;
}

// ══════════════════════════════════════════
// STORAGE HELPERS
// ══════════════════════════════════════════
function savePlatforms() {
  applyPlatformEligibility();
  document.dispatchEvent(new CustomEvent('bb:savePlatforms', { detail: { platforms } }));
}

function clearAllPrompt() {
  document.getElementById('clear-all-confirm').classList.remove('hidden');
  document.getElementById('clear-all-btn').classList.add('hidden');
}
function clearAllCancel() {
  document.getElementById('clear-all-confirm').classList.add('hidden');
  document.getElementById('clear-all-btn').classList.remove('hidden');
}
function clearAllConfirmed() {
  if (generatedDraftSaving) { showToast('Please wait for the draft save to finish.'); return; }
  platforms = PLATFORMS.map(p => ({...p}));
  history = [];
  profile = {};
  draft = {};
  window._currentDraftId = null;
  window._bbPendingDraft = null;
  window._bbDraftSavePending = false;
  const saveError = document.getElementById('draft-save-error');
  if (saveError) saveError.hidden = true;
  try { localStorage.removeItem('bb_profile'); } catch(e) {}
  init();
  clearAllCancel();
  showToast('🗑️ Data cleared');
  document.dispatchEvent(new CustomEvent('bb:clearAll'));
}
function clearAll() { clearAllPrompt(); }

// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), Math.min(12000, Math.max(4000, String(msg).length * 65)));
}

// ══════════════════════════════════════════
// START
// ══════════════════════════════════════════
init();

// ── Apply config/platforms admin overrides (name, icon, type, order, enabled, proOnly) ──
// Uses platforms-config.js (the canonical source shared with onboarding/admin pages).
// Runs after init() so user-enabled state from localStorage is already applied.
// Falls back silently if config/platforms doesn't exist yet.
(async function _applyAdminPlatformConfig() {
  try {
    const { PLATFORM_DEFAULTS, loadPlatformsREST } = await import('./platforms-config.js?v=20261018-personal-facebook');
    const activePlatforms = await loadPlatformsREST();
    // Build a complete adminMap: mark all defaults disabled first, then enable the active ones.
    // This ensures admin-disabled platforms are properly excluded by _bbSetPlatforms.
    const adminMap = {};
    PLATFORM_DEFAULTS.forEach(d => { adminMap[d.slug] = { ...d, enabled: false }; });
    activePlatforms.forEach(p => { adminMap[p.slug] = p; }); // re-enable with admin overrides
    // Cache admin config — _bbSetPlatforms applies it on every subsequent call
    window._bbAdminPlatformConfig = adminMap;
    // Apply immediately to current platform state (re-render via _bbSetPlatforms)
    if (window._bbSetPlatforms) window._bbSetPlatforms(platforms);
  } catch(e) {
    console.warn('[BlastyBiz] config/platforms overlay failed:', e.message);
  }
})();

// Window setters — module script calls these to push Firestore data into UI
window._bbSetPlatforms = function(updatedPlatforms) {
  updatedPlatforms = updatedPlatforms.map(p => BBPlatforms.normalizeSelection(p, window._bbProfileGlobal || {}));
  // Always apply the admin display overlay (name, icon, type, order, proOnly, globally-disabled).
  // window._bbAdminPlatformConfig is populated by _applyAdminPlatformConfig() / module script.
  const adminMap = window._bbAdminPlatformConfig;
  if (adminMap) {
    updatedPlatforms = updatedPlatforms
      .filter(p => adminMap[p.id]?.enabled !== false)
      .map(p => {
        const a = adminMap[p.id];
        if (!a) return p;
        const isManual = a.capabilityLevel === 'manual_assisted';
        return Object.assign({}, p, {
          name:    a.name    || p.name,
          icon:    a.icon    || p.icon,
          type:    isManual ? 'manual' : 'api',
          // Display overrides cannot gate shared platform access.
          proOnly: false,
        });
      })
      .sort((a, b) => ((adminMap[a.id]?.order || 99) - (adminMap[b.id]?.order || 99)));
  }
  platforms = updatedPlatforms;
  renderPlatforms();
  renderQuickSelect();
  updateStats();
};
window._bbGetHistory = () => history;
window._bbSetHistory = function(items) {
  history = items;
  renderHistory();
};
window._bbSetProfile = function(p) {
  profile = p;
  // Cache to localStorage so the profile loads instantly on next visit
  try {
    localStorage.setItem('bb_profile', JSON.stringify({
      sellerType: p.sellerType || 'business',
      name: p.name, ...BBSetup.nameParts(p), ownerRole: p.ownerRole,
      category: p.category, phone: p.phone, email: p.email,
      street: p.street, city: p.city, state: p.state, zip: p.zip,
      region: p.region, locationType: p.locationType, website: p.website,
      hours: p.hours, tone: p.tone, platformCats: p.platformCats || {},
      postingSchedule: p.postingSchedule || null, aiContext: p.aiContext || null,
      ynMentionFirstName: BBSetup.profileMentions(p).firstName, ynMentionLastName: BBSetup.profileMentions(p).lastName, ynMentionRole: p.ynMentionRole || 'no',
      ynMentionAddress: p.ynMentionAddress || 'yes',
      ynMentionPhone: p.ynMentionPhone || 'yes', ynMentionEmail: p.ynMentionEmail || 'yes',
      ynMentionWebsite: p.ynMentionWebsite || 'yes'
    }));
  } catch(e) {}
  loadProfile();
  renderPlatforms();
  renderQuickSelect();
  if (p.sellerType === 'personal' && document.querySelector('#tab-profile.active, #tab-story.active')) showTab('create');
  document.body.classList.remove('workspace-loading');
  document.getElementById('workspace-loading-status').hidden = true;
  // ynMention* is now per-campaign (restored in selectCampaign), not per-business profile
};

// _saveInsightToFirestore and _saveGlobalFactoidsToFirestore are defined in the
// module script below where activeBizId, db, and currentUser are in scope.

// ══════════════════════════════════════════
// BUSINESS SWITCHER BAR (regular scope)
// ══════════════════════════════════════════
function getBizLimit() { return window._bizLimit || 1; }

function renderSwitcherBar() {
  const bizList   = window.BUSINESSES || [];
  const currentId = window.activeBizId;
  const active    = bizList.find(b => b.id === currentId);
  const activeName = active ? (active.sellerType === 'personal' ? (active.ownerName || active.name || 'Personal') : (active.businessName || active.name || 'Business')) : 'Select profile';

  // Keep hidden select in sync (used elsewhere)
  const select = document.getElementById('biz-select');
  if (select) select.innerHTML = bizList.map(b =>
    `<option value="${escHtml(b.id)}"${b.id===currentId?' selected':''}>${escHtml(b.businessName||b.name||'')}</option>`
  ).join('');

  // Keep workspace info bar in sync
  const wbName = document.getElementById('wb-biz-name');
  if (wbName) wbName.textContent = activeName;

  // One selector in the header; this card only identifies the managed business.
  const tabBar = document.getElementById('biz-tab-bar');
  if (tabBar) {
    const label = document.createElement('span');
    label.className = 'biz-solo-name';
    label.textContent = activeName;
    tabBar.replaceChildren(label);
  }
  window._bbRenderHeaderBusinesses?.(bizList, currentId);
}

function renderAgencyBar() {
  const bizList = window.BUSINESSES || [];
  const used    = bizList.length;
  const limit   = getBizLimit();
  const usageEl = document.getElementById('agency-usage-text');
  if (usageEl) usageEl.textContent = `${used}/${limit} businesses`;
  const pips = document.getElementById('agency-pips');
  if (!pips) return;
  pips.innerHTML = '';
  for (let i = 0; i < limit; i++) {
    const pip = document.createElement('div');
    const isActive = i === bizList.findIndex(b => b.id === window.activeBizId);
    pip.className = 'pip' + (i < used ? (isActive ? ' active-pip' : ' used') : '');
    pips.appendChild(pip);
  }
}

// Legacy callers delegate to the canonical workspace switch handler
function toggleBizDropdown() {}
function _closeBizDdOutside() {}
function selectBizOption(bizId) { if (window.switchBusiness) window.switchBusiness(bizId); }

// ── Plan overlay activation ───────────────────────────────────────────
window._applyPlanOverlays = function() {
  const plan = window._bbUserPlan || 'starter';

  // #4+#9 Show persistent workspace info bar on all tabs
  const infoBar = document.getElementById('workspace-info-bar');
  if (infoBar) infoBar.style.display = 'flex';

  // #1 Show trial banner only for trial users
  const trialBanner = document.getElementById('trial-banner');
  if (trialBanner) trialBanner.style.display = plan === 'trial' ? 'flex' : 'none';

  // #9 Plan badge in persistent header
  const planBadge = document.getElementById('wb-plan-badge');
  if (planBadge) {
    const badgeStyles = {
      trial:   { bg:'#7c2d00', color:'#ffcca0' },
      starter: { bg:'#1a3a1a', color:'#66bb6a' },
      pro:     { bg:'#1e1a3a', color:'#818cf8' },
      agency:  { bg:'#3a2200', color:'#fbbf24' },
    };
    const s = badgeStyles[plan] || badgeStyles.starter;
    planBadge.textContent  = plan.charAt(0).toUpperCase() + plan.slice(1);
    planBadge.style.background = s.bg;
    planBadge.style.color      = s.color;
    planBadge.style.display    = 'inline';
  }

  // Activate overlays whose data-plan list includes the current plan
  document.querySelectorAll('.pro-overlay[data-plan]').forEach(el => {
    const plans = (el.getAttribute('data-plan') || '').split(' ');
    // Free-tier recurring Refire policy remains unresolved; preserve that existing gate only.
    el.classList.toggle('visible', el.id === 'schedule-pro-overlay' && plans.includes(plan));
    el._pendingVisible = false;
  });

  // Hide Agency promo card entirely for Agency users (they already have the feature)
  if (plan === 'agency') {
    const agCard = document.getElementById('agency-promo-card');
    if (agCard) agCard.style.display = 'none';
  }

  // Fixed-position tab overlays: defer until user navigates to that tab
  ['history-pro-overlay','schedule-pro-overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.classList.contains('visible')) {
      el.classList.remove('visible');
      el._pendingVisible = true;
    }
  });
};

// Show deferred fixed overlays when switching to their tab
const _origShowTab = window.showTab;
window.showTab = function(name) {
  // Hide all deferred fixed overlays first
  ['history-pro-overlay','schedule-pro-overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  });
  if (typeof _origShowTab === 'function') _origShowTab(name);
  // Show the overlay for this tab if pending
  const tabOverlayMap = { history: 'history-pro-overlay', schedule: 'schedule-pro-overlay' };
  const overlayId = tabOverlayMap[name];
  if (overlayId) {
    const el = document.getElementById(overlayId);
    if (el && el._pendingVisible) el.classList.add('visible');
  }
};

