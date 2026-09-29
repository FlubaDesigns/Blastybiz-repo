/* guided-setup.js — Conversational guide layer for an ordinary HTML form. v1.0

   The point of this file: a form and a guided wizard should not be two separate
   pages. This renders a mascot + speech bubble as a LAYER ON TOP of a form that
   already exists, walking the user through the real inputs one question at a
   time. The form underneath stays the single source of truth — there is no
   second set of inputs, no second answers object, and no second save path.

   Zero product-specific dependencies. Field ids, questions and section ids are
   all supplied by the caller.

   Usage:
     <script src="mascot.js"></script>   // optional; used for the character
     <script src="guided-setup.js"></script>

     const guide = new GuidedSetup({
       name: 'Blasty',                       // what the character calls itself
       steps: [
         { field: 'f-ownerName', section: 'sec-1', required: true,
           ask: "What's your name?", hint: 'First name is fine' },
         { field: 'f-bizName',   section: 'sec-1', required: true,
           ask: (v) => 'Nice to meet you, ' + v['f-ownerName'] + '! Business name?' },
         { group: 'plat-grid',   section: 'sec-3',
           ask: 'Where should I post?' },
       ],
       openSection: (id) => {...},          // optional: how to reveal a section
       finishLabel: 'Ready to launch →',
       onFinish: () => document.getElementById('submit').click(),
     });
     guide.start();     // or guide.start(3) to resume at a step
     guide.stop();      // tear the layer down, leave the plain form
*/
(function () {
  'use strict';

  var CSS = [
    '.gs-layer{position:fixed;left:0;right:0;bottom:0;z-index:800;',
    '  background:linear-gradient(180deg,rgba(8,16,8,.92),rgba(8,16,8,.99));',
    '  border-top:1px solid rgba(57,255,20,.35);',
    '  box-shadow:0 -8px 40px rgba(0,0,0,.55);',
    '  padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));',
    '  transform:translateY(110%);transition:transform .35s cubic-bezier(.2,.9,.3,1);}',
    '.gs-layer.gs-open{transform:translateY(0);}',
    '.gs-inner{max-width:900px;margin:0 auto;display:flex;gap:14px;align-items:flex-start;}',
    '.gs-char{flex-shrink:0;width:64px;}',
    '.gs-char svg{width:64px;height:auto;overflow:visible;display:block;}',
    '.gs-col{flex:1;min-width:0;}',
    '.gs-bubble{background:#12210f;border:1px solid rgba(57,255,20,.4);border-radius:14px;',
    '  padding:10px 14px;color:#e0f0e3;font-size:15px;line-height:1.45;position:relative;}',
    '.gs-bubble::before{content:"";position:absolute;left:-7px;top:16px;width:12px;height:12px;',
    '  background:#12210f;border-left:1px solid rgba(57,255,20,.4);',
    '  border-bottom:1px solid rgba(57,255,20,.4);transform:rotate(45deg);}',
    '.gs-hint{font-size:12.5px;color:#7aab82;margin-top:5px;}',
    '.gs-err{font-size:12.5px;color:#ef5350;margin-top:5px;}',
    '.gs-btns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center;}',
    '.gs-btn{font-family:inherit;font-size:13px;font-weight:700;padding:9px 16px;border-radius:9px;',
    '  border:1px solid rgba(57,255,20,.35);background:transparent;color:#e0f0e3;cursor:pointer;}',
    '.gs-btn:active{opacity:.7;}',
    '.gs-btn-primary{background:#00C853;border-color:#00C853;color:#06210c;}',
    '.gs-btn-quiet{border-color:transparent;color:#7aab82;padding-left:6px;padding-right:6px;}',
    '.gs-spacer{flex:1;}',
    '.gs-track{height:3px;border-radius:2px;background:rgba(57,255,20,.15);margin-bottom:10px;overflow:hidden;}',
    '.gs-fill{height:100%;background:#00C853;width:0;transition:width .3s ease;}',
    '.gs-count{font-size:12px;color:#7aab82;white-space:nowrap;}',
    '.gs-target{outline:2px solid rgba(57,255,20,.85)!important;outline-offset:3px;border-radius:8px;',
    '  transition:outline-color .3s ease;}',
    '@media (max-width:560px){',
    '  .gs-char{width:46px;} .gs-char svg{width:46px;}',
    '  .gs-bubble{font-size:14px;}',
    '}',
    '@media (prefers-reduced-motion:reduce){',
    '  .gs-layer{transition:none;} .gs-fill{transition:none;} .gs-target{transition:none;}',
    '}'
  ].join('');

  var _cssDone = false;
  function injectCSS() {
    if (_cssDone) return;
    _cssDone = true;
    var s = document.createElement('style');
    s.id = 'gs-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(id) { return document.getElementById(id); }

  /* Current value of whatever kind of control a step points at. */
  function valueOf(step) {
    if (step.group) {
      var wrap = el(step.group);
      if (!wrap) return [];
      return Array.prototype.slice
        .call(wrap.querySelectorAll('input[type=checkbox]:checked'))
        .map(function (c) { return c.value; });
    }
    var f = el(step.field);
    if (!f) return '';
    if (f.type === 'checkbox') return f.checked;
    return (f.value || '').trim();
  }

  function isEmpty(v) {
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'boolean') return false;   // a toggle is never "unanswered"
    return !String(v || '').trim();
  }

  function GuidedSetup(opts) {
    opts = opts || {};
    this.name        = opts.name || 'Assistant';
    this.steps       = (opts.steps || []).slice();
    this.openSection = opts.openSection || function () {};
    this.onFinish    = opts.onFinish || function () {};
    this.onStop      = opts.onStop || function () {};
    this.finishLabel = opts.finishLabel || 'Finish →';
    this.mascot      = null;
    this.idx         = 0;
    this.layer       = null;
    this._lastTarget = null;
    this._onKeydown  = this._handleKeydown.bind(this);
  }

  /* Snapshot of every field value, so a question can refer to earlier answers. */
  GuidedSetup.prototype.answers = function () {
    var out = {};
    this.steps.forEach(function (s) {
      if (s.field) out[s.field] = valueOf(s);
      if (s.group) out[s.group] = valueOf(s);
    });
    return out;
  };

  GuidedSetup.prototype.build = function () {
    injectCSS();
    var layer = document.createElement('div');
    layer.className = 'gs-layer';
    layer.id = 'gs-layer';
    layer.setAttribute('role', 'region');
    layer.setAttribute('aria-label', this.name + ' setup guide');
    layer.innerHTML =
        '<div class="gs-inner">'
      +   '<div class="gs-char" id="gs-char"></div>'
      +   '<div class="gs-col">'
      +     '<div class="gs-track"><div class="gs-fill" id="gs-fill"></div></div>'
      +     '<div class="gs-bubble" id="gs-bubble" aria-live="polite"></div>'
      +     '<div class="gs-hint" id="gs-hint"></div>'
      +     '<div class="gs-err" id="gs-err" aria-live="assertive"></div>'
      +     '<div class="gs-btns">'
      +       '<button type="button" class="gs-btn" id="gs-back">← Back</button>'
      +       '<button type="button" class="gs-btn gs-btn-primary" id="gs-next">Next →</button>'
      +       '<button type="button" class="gs-btn gs-btn-quiet" id="gs-skip">Skip</button>'
      +       '<span class="gs-spacer"></span>'
      +       '<span class="gs-count" id="gs-count"></span>'
      +       '<button type="button" class="gs-btn gs-btn-quiet" id="gs-exit">I\'ll fill it in myself</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(layer);
    this.layer = layer;

    var self = this;
    el('gs-next').addEventListener('click', function () { self.next(); });
    el('gs-back').addEventListener('click', function () { self.back(); });
    el('gs-skip').addEventListener('click', function () { self.skip(); });
    el('gs-exit').addEventListener('click', function () { self.stop(); });

    if (window.PBMascot && window.PBMascot.create) {
      this.mascot = window.PBMascot.create(el('gs-char'), { name: this.name });
    }
    document.addEventListener('keydown', this._onKeydown, true);
    return this;
  };

  /* Enter advances from a single-line input; Shift+Enter stays put in textareas. */
  GuidedSetup.prototype._handleKeydown = function (e) {
    if (!this.layer || e.key !== 'Enter' || e.shiftKey) return;
    var step = this.steps[this.idx];
    if (!step || !step.field) return;
    var f = el(step.field);
    if (!f || document.activeElement !== f) return;
    if (f.tagName === 'TEXTAREA') return;
    e.preventDefault();
    this.next();
  };

  GuidedSetup.prototype.start = function (at) {
    if (!this.layer) this.build();
    var self = this;
    this.idx = Math.max(0, Math.min(at || 0, this.steps.length - 1));
    requestAnimationFrame(function () {
      self.layer.classList.add('gs-open');
      self._pad();
      self.render();
    });
    return this;
  };

  /* Keep the docked layer from covering the bottom of the form. */
  GuidedSetup.prototype._pad = function () {
    if (!this.layer) return;
    document.body.style.paddingBottom = (this.layer.offsetHeight + 24) + 'px';
  };

  GuidedSetup.prototype.stop = function () {
    /* Tear the visible layer down FIRST. Mascot teardown reaches into a third-party
       component; if it throws, the user must not be left staring at a guide bar that
       refuses to close. */
    if (this.layer && this.layer.parentNode) this.layer.parentNode.removeChild(this.layer);
    this.layer = null;
    document.body.style.paddingBottom = '';

    try { document.removeEventListener('keydown', this._onKeydown, true); } catch (e) { /* noop */ }
    try { this._clearTarget(); } catch (e) { /* noop */ }
    try { if (this.mascot && this.mascot.destroy) this.mascot.destroy(); }
    catch (e) { console.warn('[guided-setup] mascot teardown failed:', e); }
    this.mascot = null;

    try { this.onStop(); } catch (e) { console.error('[guided-setup] onStop failed:', e); }
  };

  GuidedSetup.prototype._clearTarget = function () {
    if (this._lastTarget) this._lastTarget.classList.remove('gs-target');
    this._lastTarget = null;
  };

  /* Walk forward/back over steps whose skipIf says they don't apply. */
  GuidedSetup.prototype._applicable = function (i, dir) {
    var a = this.answers();
    while (i >= 0 && i < this.steps.length) {
      var s = this.steps[i];
      if (!s.skipIf || !s.skipIf(a)) return i;
      i += dir;
    }
    return i;
  };

  GuidedSetup.prototype.render = function () {
    var step = this.steps[this.idx];
    if (!step) return this.finish();

    var a       = this.answers();
    var bubble  = el('gs-bubble');
    var hintEl  = el('gs-hint');
    var errEl   = el('gs-err');
    var target  = el(step.field || step.group);

    errEl.textContent = '';
    bubble.textContent = typeof step.ask === 'function' ? step.ask(a) : step.ask;
    hintEl.textContent = step.hint || '';
    hintEl.style.display = step.hint ? '' : 'none';

    el('gs-count').textContent = (this.idx + 1) + ' of ' + this.steps.length;
    el('gs-fill').style.width  = Math.round((this.idx / this.steps.length) * 100) + '%';
    el('gs-back').style.visibility = this.idx === 0 ? 'hidden' : '';
    el('gs-skip').style.display    = step.required ? 'none' : '';
    el('gs-next').textContent      = this.idx === this.steps.length - 1 ? this.finishLabel : 'Next →';

    if (step.mood && this.mascot && this.mascot.setMood) this.mascot.setMood(step.mood);

    if (step.section) this.openSection(step.section);

    this._clearTarget();
    if (target) {
      var focusEl = step.group
        ? target.querySelector('input[type=checkbox]')
        : target;
      var box = step.group ? target : (target.closest('.cb-field') || target);
      box.classList.add('gs-target');
      this._lastTarget = box;
      var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      box.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      if (focusEl && !step.group) {
        try { focusEl.focus({ preventScroll: true }); } catch (_) { focusEl.focus(); }
      }
    }
    this._pad();
  };

  GuidedSetup.prototype.next = function () {
    var step = this.steps[this.idx];
    if (!step) return this.finish();

    var v = valueOf(step);
    if (step.required && isEmpty(v)) {
      el('gs-err').textContent = step.requiredMsg || 'I need this one to keep going.';
      var f = el(step.field || step.group);
      if (f && f.focus) f.focus();
      return;
    }
    if (step.validate) {
      var msg = step.validate(v, this.answers());
      if (msg) { el('gs-err').textContent = msg; return; }
    }
    this.advance(1);
  };

  GuidedSetup.prototype.skip = function () {
    if (this.steps[this.idx] && this.steps[this.idx].required) return this.next();
    this.advance(1);
  };

  GuidedSetup.prototype.back = function () { this.advance(-1); };

  GuidedSetup.prototype.advance = function (dir) {
    var i = this._applicable(this.idx + dir, dir);
    if (i < 0) { this.idx = 0; return this.render(); }
    if (i >= this.steps.length) return this.finish();
    this.idx = i;
    this.render();
  };

  GuidedSetup.prototype.finish = function () {
    el('gs-fill').style.width = '100%';
    this._clearTarget();
    this.onFinish(this.answers());
  };

  window.GuidedSetup = GuidedSetup;
})();
