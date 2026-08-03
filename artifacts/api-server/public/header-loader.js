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

  function _playHeaderSound() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      function ck(t, f) {
        var b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
        var D = b.getChannelData(0);
        for (var i = 0; i < D.length; i++) {
          var s = i / ctx.sampleRate;
          D[i] = (Math.random() * 2 - 1) * Math.exp(-s / 0.004) * 1.2 +
                  Math.sin(2 * Math.PI * f * s) * Math.exp(-s / 0.005) * 0.3;
        }
        var src = ctx.createBufferSource();
        src.buffer = b;
        var g = ctx.createGain();
        g.gain.setValueAtTime(1, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
        src.connect(g);
        g.connect(ctx.destination);
        src.start(t);
      }
      ctx.resume().then(function () {
        var n = ctx.currentTime;
        ck(n + 0.01, 220);
        ck(n + 0.30, 160);
      }).catch(function () {});
    } catch (e) {}
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
        _playHeaderSound();
        _runTaglineAnim();
      }, { once: true });
    });
})();
