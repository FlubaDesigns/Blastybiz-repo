function _revealAdminNav() {
  (async function() {
    try {
      const { auth, db } = await import('./firebase-init-v2.js');
      const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) return;
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
      }
    } catch(e) { /* not logged in or firebase not available */ }
  })();
}

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
  if (!injectEl) { _applyHeaderOffset(); return; }
  // Header is injected asynchronously via fetch — watch for it
  if (document.querySelector('.header')) {
    _applyHeaderOffset();
  } else {
    var obs = new MutationObserver(function() {
      if (document.querySelector('.header')) {
        obs.disconnect();
        // Double rAF ensures layout is fully settled before measuring
        requestAnimationFrame(function() {
          requestAnimationFrame(_applyHeaderOffset);
        });
        // Reveal Test Console link for admins
        _revealAdminNav();
      }
    });
    obs.observe(injectEl, { childList: true, subtree: true });
  }
  window.addEventListener('resize', _applyHeaderOffset);
});
