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

      // ── Business tab strip (pro/agency, 2+ businesses) ─
      try {
        const ud = await getDoc(doc(db, 'users', user.uid));
        if (!ud.exists()) return;
        const plan = ud.data().plan || 'starter';
        const activeBizId = ud.data().activeBusiness || null;
        if (plan !== 'pro' && plan !== 'agency') return;

        const bizSnap = await getDocs(collection(db, 'users', user.uid, 'businesses'));
        const bizzes = [];
        bizSnap.forEach(function(d) { bizzes.push({ id: d.id, bizName: d.data().bizName, name: d.data().name, businessName: d.data().businessName }); });
        if (bizzes.length < 2) return;

        var tabBar = document.getElementById('header__biz-tabs');
        if (!tabBar) return;

        tabBar.innerHTML = bizzes.map(function(b) {
          var isActive = b.id === activeBizId;
          var name = b.bizName || b.name || b.businessName || '(unnamed)';
          return isActive
            ? '<span class="header__biz-tab active">' + name + '</span>'
            : '<button type="button" class="header__biz-tab" onclick="window._bbHeaderSwitchBiz(\'' + b.id + '\')">' + name + '</button>';
        }).join('');
        tabBar.style.display = 'flex';

        // Switch handler — update activeBusiness then reload the current page
        window._bbHeaderSwitchBiz = function(bizId) {
          setDoc(doc(db, 'users', user.uid), { activeBusiness: bizId }, { merge: true })
            .then(function() { window.location.reload(); })
            .catch(function(e) { alert('Error switching business: ' + e.message); });
        };

        // Header grew — recalculate offset
        requestAnimationFrame(_applyHeaderOffset);
      } catch(e) { /* not pro/agency or Firestore unavailable */ }

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
