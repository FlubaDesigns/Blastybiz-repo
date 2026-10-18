function _revealAdminNav() {
  (async function() {
    try {
      const { auth, db } = await import('./firebase-init-v2.js');
      const { doc, getDoc, collection, getDocs, setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      await auth.authStateReady();
      const user = auth.currentUser;

      if (!user) {
        // Firebase confirmed: not logged in — clear any stale optimistic state
        document.body.classList.remove('logged-in');
        localStorage.setItem('bb_auth', '0');
        return;
      }

      // Mark body as logged-in so CSS reveals app nav links
      document.body.classList.add('logged-in');

      // ── Mascot animation setting ────────────────────────────────────────
      // Read once per page load. Applies immediately via body.mascot-static so
      // every page that includes mascot.js respects the admin toggle.
      try {
        const uiSnap = await getDoc(doc(db, 'config', 'ui'));
        const mascotAnimations = uiSnap.exists() ? uiSnap.data().mascotAnimations : true;
        document.body.classList.toggle('mascot-static', mascotAnimations === false);
      } catch(e) { /* non-fatal — animations stay on if config unreadable */ }

      // ── Admin nav link ──────────────────────────────
      let isAdmin = user.email === 'info@blastybiz.com';
      if (!isAdmin) {
        try {
          const snap = await getDoc(doc(db, 'config', 'admins'));
          if (snap.exists()) isAdmin = (snap.data().emails || []).includes(user.email);
        } catch(e) {}
      }
      if (isAdmin) {
        var d = document.getElementById('header__nav-testconsole');
        var m = document.getElementById('header__mobile-testconsole');
        if (d) d.style.display = '';
        if (m) m.style.display = '';
        var da = document.getElementById('header__nav-admin');
        var ma = document.getElementById('header__mobile-admin');
        if (da) da.style.display = '';
        if (ma) ma.style.display = '';
      }

      // The workspace owns selection (including bizId deep links and save guards).
      // Do not race it with an independent read of the account's last business.
      if (document.getElementById('biz-select')) {
        window._bbRenderHeaderBusinesses(window.BUSINESSES || [], window.activeBizId);
      } else {
        try {
          const ud = await getDoc(doc(db, 'users', user.uid));
          if (!ud.exists()) return;
          const bizSnap = await getDocs(collection(db, 'users', user.uid, 'businesses'));
          const businesses = bizSnap.docs.map(d => ({ ...d.data(), id: d.id }));
          const requested = new URLSearchParams(location.search).get('bizId');
          const active = businesses.find(b => b.id === (requested || ud.data().activeBusiness)) || businesses[0];
          window._bbHeaderSwitchBiz = async function(bizId) {
            if (!businesses.some(b => b.id === bizId)) return;
            await setDoc(doc(db, 'users', user.uid), { activeBusiness: bizId }, { merge: true });
            location.assign('BlastyBiz.html?' + new URLSearchParams({bizId, tab:'create'}));
          };
          window._bbRenderHeaderBusinesses(businesses, active?.id);
        } catch(e) { /* Firestore unavailable — leave selector hidden. */ }
      }

    } catch(e) { /* not logged in or firebase not available */ }
  })();
}

// Global sign-out — defined here so every page has it regardless of whether
// the page's own module script also defines one.
window.doSignOut = function() {
  Promise.all([
    import('./firebase-init-v2.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js')
  ]).then(function(mods) {
    var auth   = mods[0].auth;
    var signOut = mods[1].signOut;
    localStorage.setItem('bb_auth', '0');
    signOut(auth).finally(function() { window.location.href = 'BlastyBiz-Login.html'; });
  }).catch(function() { window.location.href = 'BlastyBiz-Login.html'; });
};

window.toggleMenu = function() {
  var m = document.getElementById('header__mobile-menu');
  if (m) m.classList.toggle('open');
};
window.closeMenu = function() {
  var m = document.getElementById('header__mobile-menu');
  if (m) m.classList.remove('open');
};
document.addEventListener('click', function(e) {
  var menu = document.getElementById('header__mobile-menu');
  var btn  = document.getElementById('header__hamburger-btn');
  if (!menu || !btn) return;
  if (menu.classList.contains('open') && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.remove('open');
  }
}, true);

// Keep focused desktop links fully visible without moving the page itself.
document.addEventListener('focusin', function(event) {
  var link = event.target;
  var nav = link && link.parentElement;
  if (!nav || !nav.classList.contains('header__nav')) return;
  var bounds = nav.getBoundingClientRect();
  var target = link.getBoundingClientRect();
  if (target.right > bounds.right) nav.scrollLeft += target.right - bounds.right;
  else if (target.left < bounds.left) nav.scrollLeft -= bounds.left - target.left;
});

// Measure the real rendered header height and update --main-offset and --header-h
// so every page's content clears the fixed header exactly — no hardcoded guessing.
function _applyHeaderOffset() {
  var h = document.querySelector('.header');
  if (!h) return;
  var px = h.offsetHeight + 'px';
  document.documentElement.style.setProperty('--main-offset', px);
  document.documentElement.style.setProperty('--header-h', px);
}

document.addEventListener('DOMContentLoaded', function() {
  var injectEl = document.getElementById('header__inject');
  if (!injectEl) {
    // Header is inline — still need auth state check + offset
    _applyHeaderOffset();
    _revealAdminNav();
  } else if (document.querySelector('.header')) {
    // Header already rendered (fast load / cache)
    _applyHeaderOffset();
    _revealAdminNav();
  } else {
    // Header injected asynchronously — watch for it
    var obs = new MutationObserver(function() {
      if (document.querySelector('.header')) {
        obs.disconnect();
        // Double rAF ensures layout is fully settled before measuring
        requestAnimationFrame(function() {
          requestAnimationFrame(_applyHeaderOffset);
        });
        _revealAdminNav();
      }
    });
    obs.observe(injectEl, { childList: true, subtree: true });
  }
  window.addEventListener('resize', _applyHeaderOffset);
});

// A real in-page dropdown: bounded list directly below its trigger on phones too.
window._bbRenderHeaderBusinesses = function(businesses, activeId) {
  const bar = document.getElementById('header__biz-tabs');
  if (!bar) return;
  bar.replaceChildren();
  const active = businesses.find(b => b.id === activeId);
  if (!active) { bar.style.display = 'none'; requestAnimationFrame(_applyHeaderOffset); return; }
  const name = b => b.sellerType === 'personal' ? (b.ownerName || b.name || 'Personal') : (b.businessName || b.name || b.bizName || 'Business');
  const dropdown = document.createElement('details');
  dropdown.className = 'header__business-dropdown';
  const trigger = document.createElement('summary');
  trigger.textContent = name(active);
  trigger.setAttribute('aria-label', 'Business: ' + name(active));
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'header__business-options');
  const list = document.createElement('div');
  list.className = 'header__business-options';
  list.id = 'header__business-options';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Choose business');
  businesses.forEach(b => {
    const option = document.createElement('button');
    option.type = 'button';
    option.textContent = name(b);
    if (b.id === activeId) option.setAttribute('aria-current', 'true');
    option.addEventListener('click', async () => {
      dropdown.open = false;
      trigger.focus();
      if (b.id === activeId) return;
      // Always use the workspace handler so unsaved work is protected.
      const change = document.getElementById('biz-select') ? window.switchBusiness : window._bbHeaderSwitchBiz;
      if (!change) return;
      trigger.setAttribute('aria-busy', 'true');
      try { await change(b.id); }
      catch(e) { (window.showToast || window.alert)('Could not switch business. Please try again.'); }
      finally { trigger.removeAttribute('aria-busy'); }
    });
    list.appendChild(option);
  });
  dropdown.append(trigger, list);
  dropdown.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(dropdown.open)));
  dropdown.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dropdown.open = false; trigger.focus(); e.preventDefault(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); dropdown.open = true;
      const options = [...list.children], index = options.indexOf(document.activeElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : e.key === 'ArrowDown' ? (index + 1) % options.length : (index <= 0 ? options.length : index) - 1;
      options[next]?.focus();
    }
  });
  bar.appendChild(dropdown);
  bar.style.display = 'flex';
  requestAnimationFrame(_applyHeaderOffset);
};
document.addEventListener('pointerdown', e => {
  const dropdown = document.querySelector('.header__business-dropdown');
  if (dropdown && !dropdown.contains(e.target)) dropdown.open = false;
});
document.addEventListener('focusin', e => {
  const dropdown = document.querySelector('.header__business-dropdown');
  if (dropdown && !dropdown.contains(e.target)) dropdown.open = false;
});
