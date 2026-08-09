---
name: BlastyBiz HTML escaping
description: Rules for escaping owner-supplied text in innerHTML across public/ pages
---

Every owner-supplied value (business/campaign/owner name, email, AI copy, job error text) must be escaped before reaching `innerHTML`, or rendered with DOM APIs + `textContent`.

**Why:** Business names like `<script>&'Quote` are stored and re-rendered on every visit; a single unescaped sink is persistent XSS. Task-completion code review rejects any remaining sink — including shared renderers (`blastybiz-menu.js` header biz-tab strip), admin widgets (failed-jobs list), and pre-auth pages.

**How to apply:**
- Canonical helper: `public/escape-utils.js` → `window.escHtml` / `window._esc`. Load it via `<script src="escape-utils.js">` **in the head, before any inline consumer** — several pages referenced `window.escHtml` without ever loading it (silent runtime break), and BlastyBiz.html loaded it at the bottom after `const escHtml = window.escHtml` ran.
- For IDs interpolated into inline `onclick='fn("${id}")'`: strip quotes/backslashes then escHtml, or better, build with `createElement` + `addEventListener` (pattern used in blastybiz-menu.js header tabs).
- Plain-text mascot/chat bubbles: use `textContent`, not `innerHTML`.
- Audit grep: `innerHTML|insertAdjacentHTML` sinks with `${...}` or `+` concatenation, per file, and compare against escape-helper usage.

## escHtml is NOT enough inside an inline `onclick`

`onclick="fn('<value>')"` decodes HTML entities *before* the handler is compiled
as JavaScript, so `escHtml(value)` does not protect that position — an
apostrophe in the value breaks out of the string literal and the rest executes.

Use a `data-` attribute plus one delegated listener on the container instead, so
the value is only ever read as data:

    el.innerHTML = '<button data-thing-id="' + escHtml(id) + '">';
    container.addEventListener('click', function (e) {
      var hit = e.target.closest && e.target.closest('[data-thing-id]');
      if (hit) doThing(hit.getAttribute('data-thing-id'));
    });

Bind the delegated listener ONCE (guard with a module-level flag); the container
survives `innerHTML` rewrites of its children, so re-binding on every render
stacks duplicate handlers.

**Why:** the publish page's preview rail shipped with `escHtml()` inside inline
handlers and a review flagged it as exploitable.

## URLs need a scheme check, not just escaping

`escHtml` stops attribute breakout but happily passes `javascript:` into a
`src`/`href`. Any stored URL rendered into markup must be scheme-checked first:

    function safePhotoUrl(u) {
      return /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
    }

**How to apply:** anywhere owner- or import-supplied image URLs reach `src` or
`href` — photo strips, thumbnails, avatars.
