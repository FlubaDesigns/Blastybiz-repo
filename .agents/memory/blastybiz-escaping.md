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
