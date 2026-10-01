/* guided-setup.js — Conversational guide layer for an ordinary HTML form. v1.0

   The point of this file: a form and a guided wizard should not be two separate
   pages. This presents the existing form inputs beside the mascot and question,
   walking the user through them one question at a time. The form stays the single source of truth — there is no
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
    '.gs-layer{position:relative;width:100%;z-index:1;',
    '  background:linear-gradient(180deg,rgba(8,16,8,.92),rgba(8,16,8,.99));',
    '  border-top:1px solid rgba(57,255,20,.35);',
    '  box-shadow:0 -8px 40px rgba(0,0,0,.55);',
    '  padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));',
    '  border-radius:16px;}',
    '.gs-layer.gs-open{display:block;}',
    '.gs-history{display:grid;gap:12px;margin-bottom:20px;}',
    '.gs-answer{display:block;text-align:left;width:100%;padding:14px;border:1px solid #29492e;border-radius:14px;background:#0d1a0d;color:#e0f0e3;font:inherit;cursor:pointer;overflow-wrap:anywhere;}',
    '.gs-answer small{display:block;color:#7aab82;margin-bottom:6px;}',
    '.gs-answer span{white-space:pre-wrap;}',
    '.gs-input{margin-top:16px;background:#0d1a0d;border:1px solid #29492e;border-radius:14px;padding:14px;}',
    '.gs-input input,.gs-input select,.gs-input textarea{font-size:16px;min-height:46px;}',
    '.gs-input .cb-field{margin:0;}',
    '.gs-btn{min-height:46px;}',
    'body.gs-guiding #cb-form{display:none!important;}',
    'body.gs-guiding .cb-page-sub,body.gs-guiding .cb-guide-start{display:none;}',
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
    this.formId      = opts.formId || 'cb-form';
    this._visited    = new Set();
    this._resume     = null;
    this._moved      = null;
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
        '<div class="gs-history" id="gs-history"></div><div class="gs-inner">'
      +   '<div class="gs-char" id="gs-char"></div>'
      +   '<div class="gs-col">'
      +     '<div class="gs-track"><div class="gs-fill" id="gs-fill"></div></div>'
      +     '<div class="gs-bubble" id="gs-bubble" aria-live="polite"></div>'
      +     '<div class="gs-hint" id="gs-hint"></div>'
      +     '<div class="gs-input" id="gs-input"></div>'
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
    var form=el(this.formId);
    if(form)form.parentNode.insertBefore(layer,form);else document.body.appendChild(layer);
    document.body.classList.add('gs-guiding');
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
      if(!self.layer)return;
      self.layer.classList.add('gs-open');
      self._pad();
      self.render();
    });
    return this;
  };

  /* Keep the docked layer from covering the bottom of the form. */
  GuidedSetup.prototype._pad = function () {};

  // Move the actual form control into the conversation, then restore it before
  // navigating. Every answer still comes from that one control and save path.
  GuidedSetup.prototype._restoreInput = function () {
    if(this._moved){this._moved.marker.replaceWith(this._moved.box);this._moved=null;}
  };
  GuidedSetup.prototype._showHistory = function () {
    var self=this,history=el('gs-history'),answers=this.answers();
    if(!history)return;
    history.replaceChildren();
    this._visited.forEach(function(i){
      var step=self.steps[i];
      if(i===self.idx || (step.skipIf&&step.skipIf(answers)))return;
      var button=document.createElement('button');button.type='button';button.className='gs-answer';
      var label=document.createElement('small');label.textContent=typeof step.ask==='function'?step.ask(answers):step.ask;
      var answer=document.createElement('span'),v=valueOf(step);
      var field=el(step.field);
      if(field&&field.tagName==='SELECT')v=field.options[field.selectedIndex]?.textContent||v;
      answer.textContent=step.summary?step.summary():Array.isArray(v)?v.join(', '):(v||'Skipped');
      button.append(label,answer);button.setAttribute('aria-label','Edit: '+label.textContent);
      button.addEventListener('click',function(){self._resume=self.idx;self.idx=i;self.render();});
      history.appendChild(button);
    });
  };

  GuidedSetup.prototype.stop = function () {
    /* Tear the visible layer down FIRST. Mascot teardown reaches into a third-party
       component; if it throws, the user must not be left staring at a guide bar that
       refuses to close. */
    this._restoreInput();
    document.body.classList.remove('gs-guiding');
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
    this._restoreInput();
    var step = this.steps[this.idx];
    if (!step) return this.finish();
    this._showHistory();

    var a       = this.answers();
    var bubble  = el('gs-bubble');
    var hintEl  = el('gs-hint');
    var errEl   = el('gs-err');
    var target  = el(step.field || step.group);

    errEl.textContent = '';
    bubble.textContent = typeof step.ask === 'function' ? step.ask(a) : step.ask;
    hintEl.textContent = step.hint || '';
    hintEl.style.display = step.hint ? '' : 'none';

    var applicable=this.steps.filter(function(s){return !s.skipIf||!s.skipIf(a);});
    el('gs-count').textContent = (applicable.indexOf(step) + 1) + ' of ' + applicable.length;
    el('gs-fill').style.width  = Math.round((applicable.indexOf(step) / applicable.length) * 100) + '%';
    el('gs-back').style.visibility = this.idx === 0 ? 'hidden' : '';
    el('gs-skip').style.display    = step.required ? 'none' : '';
    el('gs-next').textContent = this._applicable(this.idx+1,1) >= this.steps.length ? this.finishLabel : 'Next →';

    if (step.mood && this.mascot && this.mascot.setMood) this.mascot.setMood(step.mood);

    if (step.section) this.openSection(step.section);

    this._clearTarget();
    if (target) {
      var focusEl = step.group
        ? target.querySelector('input[type=checkbox]')
        : target;
      var box = step.group ? target : (target.closest('.cb-field') || target);
      var marker=document.createComment('guided field location');
      box.parentNode.insertBefore(marker,box);
      el('gs-input').appendChild(box);
      this._moved={marker:marker,box:box};
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
    this._visited.add(this.idx);
    if(this._resume!==null){this.idx=this._applicable(this._resume,1);this._resume=null;return this.render();}
    this.advance(1);
  };

  GuidedSetup.prototype.skip = function () {
    if (this.steps[this.idx] && this.steps[this.idx].required) return this.next();
    this._visited.add(this.idx);
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

  GuidedSetup.prototype.finish = async function () {
    if(this._finishing)return;
    this._finishing=true;
    el('gs-fill').style.width='100%';
    this._clearTarget();
    var button=el('gs-next');if(button)button.disabled=true;
    try{await this.onFinish(this.answers());}
    catch(e){if(el('gs-err'))el('gs-err').textContent=e.message||'Could not save. Please retry.';}
    finally{this._finishing=false;if(button)button.disabled=false;}
  };

  window.GuidedSetup = GuidedSetup;
})();
