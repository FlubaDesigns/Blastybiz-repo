/**
 * header-loader.js — shared header initializer for all BlastyBiz pages.
 * Replaces the 27 copies of the inline fetch('blastybiz-header.html') pattern.
 *
 * What it does:
 *   1. Fetches blastybiz-header.html and injects it into #header__inject
 *   2. Sets --main-offset and --header-h CSS vars (and body.paddingTop for
 *      public/non-app pages that don't use the has-site-header CSS class)
 *   3. Runs the tagline bolt animation on load
 *   4. Plays the startup sound on first user interaction (pointerdown)
 */
(function () {
  'use strict';

  function _updateHeaderOffset() {
    var h = document.querySelector('.header');
    if (!h) return;
    var px = h.offsetHeight + 'px';
    document.documentElement.style.setProperty('--main-offset', px);
    document.documentElement.style.setProperty('--header-h', px);
    // Public/marketing pages (no has-site-header class) need body padding
    // to push content below the fixed header. App pages use CSS for this.
    if (!document.body.classList.contains('has-site-header')) {
      document.body.style.paddingTop = px;
    }
  }

  function _runTaglineAnim() {
    var tl = document.getElementById('header__logo-tagline');
    if (!tl) return;
    tl.style.animation = 'none';
    void tl.offsetWidth; // force reflow
    tl.style.animation = 'tagline-bolt 0.55s cubic-bezier(0.25,0.46,0.45,0.94) 0s both';
  }


  fetch('blastybiz-header.html')
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var el = document.getElementById('header__inject');
      if (el) el.innerHTML = html;
      _updateHeaderOffset();
      window.addEventListener('load', _updateHeaderOffset);
      window.addEventListener('resize', _updateHeaderOffset);
      _runTaglineAnim();
      document.addEventListener('pointerdown', function onPD() {
        document.removeEventListener('pointerdown', onPD);
        _runTaglineAnim();
      }, { once: true });
    });
})();
