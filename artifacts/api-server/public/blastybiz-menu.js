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
      }
    });
    obs.observe(injectEl, { childList: true, subtree: true });
  }
  window.addEventListener('resize', _applyHeaderOffset);
});
