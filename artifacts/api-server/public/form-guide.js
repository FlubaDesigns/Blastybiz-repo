/* form-guide.js — Portable step-by-step form guide v1.0
   Zero BlastyBiz-specific dependencies — drop in on any page.

   Usage:
     <script src="form-guide.js"></script>
     // Tag form sections:
     // <div data-guide-step="1">…</div>
     // <div data-guide-step="2">…</div>
     // Initialise:
     const guide = new FormGuide({
       steps:  document.querySelectorAll('[data-guide-step]'),
       mascot: window.PBMascot   // optional — v2 mascot with .pointTo()
     });
     guide.setActive(0);    // activate first section
     guide.advance();       // move to next section
     guide.complete(0);     // mark section 0 done without advancing
     guide.reset();         // revert all sections to future state
     guide.setActiveEl(el); // activate by element reference
*/
(function () {
  'use strict';

  /* ── CSS injected once ────────────────────────────────────────── */
  var CSS = [
    /* Future: blurred, faded.  pointer-events intentionally NOT disabled —
       users must still be able to click section headers to open/advance.
       Per-field pointer blocking (OB2 rows) is the page's own responsibility. */
    '.fg-future{',
    '  filter:blur(3px);opacity:.4;',
    '  transition:opacity .4s ease,transform .4s ease;}',

    /* Active: full visibility + neon spotlight ring */
    '.fg-active{',
    '  filter:none!important;opacity:1!important;pointer-events:auto;',
    '  outline:2px solid rgba(57,255,20,.65)!important;outline-offset:6px;',
    '  box-shadow:0 0 0 8px rgba(57,255,20,.07),0 0 22px rgba(57,255,20,.18)!important;',
    '  border-radius:12px;',
    '  transition:opacity .4s ease,box-shadow .3s ease;}',

    /* Done: full visibility, no ring */
    '.fg-done{',
    '  filter:none!important;opacity:1!important;pointer-events:auto;',
    '  transition:opacity .4s ease;}',

    /* Mobile (<620px): no blur (too aggressive on small screens);
       spotlight ring also suppressed so the layout stays clean */
    '@media(max-width:619px){',
    '  .fg-future{filter:none;opacity:.55;}',
    '  .fg-active{outline:none!important;box-shadow:none!important;}',
    '}',

    /* Reduced motion: skip all transitions and blur */
    '@media(prefers-reduced-motion:reduce){',
    '  .fg-future,.fg-active,.fg-done{transition:none;}',
    '  .fg-future{filter:none;}',
    '}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('form-guide-css')) return;
    var s = document.createElement('style');
    s.id = 'form-guide-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function isMobile() { return window.innerWidth < 620; }

  /* ── Accessibility helpers ────────────────────────────────────── */
  /* Selector for all natively focusable elements */
  var FOCUSABLE_SEL = 'a[href],button,input,select,textarea,[tabindex]';

  /* lockSection — hide from AT and remove from tab order */
  function lockSection(el) {
    el.setAttribute('aria-hidden', 'true');
    var nodes = el.querySelectorAll(FOCUSABLE_SEL);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      /* Preserve any existing explicit tabindex so we can restore it */
      var orig = n.getAttribute('tabindex');
      if (orig !== null) {
        n.setAttribute('data-fg-tabindex', orig);
      } else {
        n.removeAttribute('data-fg-tabindex');
      }
      n.setAttribute('tabindex', '-1');
    }
  }

  /* unlockSection — restore AT visibility and natural tab order */
  function unlockSection(el) {
    el.removeAttribute('aria-hidden');
    var nodes = el.querySelectorAll(FOCUSABLE_SEL);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var saved = n.getAttribute('data-fg-tabindex');
      if (saved !== null) {
        /* Restore the original explicit tabindex */
        n.setAttribute('tabindex', saved);
        n.removeAttribute('data-fg-tabindex');
      } else {
        /* No original tabindex — let the browser use the natural default */
        n.removeAttribute('tabindex');
      }
    }
  }

  /* ── FormGuide constructor ────────────────────────────────────── */
  function FormGuide(opts) {
    opts = opts || {};
    this._mascot = opts.mascot || null;
    this._steps  = opts.steps ? Array.prototype.slice.call(opts.steps) : [];
    this._active = -1;
    injectCSS();
    /* Initialise all steps as future — hidden from AT and tab order */
    this._steps.forEach(function (el) {
      el.classList.remove('fg-active', 'fg-done');
      el.classList.add('fg-future');
      lockSection(el);
    });
  }

  /* setActive(index) — 0-based.  Applies done / active / future classes,
     manages aria-hidden + tabindex for AT users, and calls mascot.pointTo()
     on the newly active element (desktop only). */
  FormGuide.prototype.setActive = function (index) {
    if (index === this._active) return;   /* idempotent — no flicker */
    this._active = index;
    var self   = this;
    var mobile = isMobile();

    this._steps.forEach(function (el, i) {
      el.classList.remove('fg-future', 'fg-active', 'fg-done');
      if (i < index) {
        el.classList.add('fg-done');
        unlockSection(el);
      } else if (i === index) {
        el.classList.add('fg-active');
        unlockSection(el);
        if (self._mascot && self._mascot.pointTo && !mobile) {
          self._mascot.pointTo(el, { duration: 2200 });
        }
      } else {
        el.classList.add('fg-future');
        lockSection(el);
      }
    });
  };

  /* advance() — convenience: move to the next step */
  FormGuide.prototype.advance = function () {
    this.setActive(this._active + 1);
  };

  /* complete(index) — mark a step done without changing active */
  FormGuide.prototype.complete = function (index) {
    var el = this._steps[index];
    if (!el) return;
    el.classList.remove('fg-future', 'fg-active');
    el.classList.add('fg-done');
    unlockSection(el);
  };

  /* reset() — revert every step to the initial future state */
  FormGuide.prototype.reset = function () {
    this._active = -1;
    this._steps.forEach(function (el) {
      el.classList.remove('fg-active', 'fg-done');
      el.classList.add('fg-future');
      lockSection(el);
    });
  };

  /* setActiveEl(el) — activate by element reference */
  FormGuide.prototype.setActiveEl = function (el) {
    var idx = this._steps.indexOf(el);
    if (idx >= 0) this.setActive(idx);
  };

  window.FormGuide = FormGuide;
}());
