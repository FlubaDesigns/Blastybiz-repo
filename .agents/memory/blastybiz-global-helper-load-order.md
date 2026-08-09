---
name: Global helper scripts must load in <head>
description: Why escape-utils.js (window.escHtml) silently blanked whole pages, and the rule for any shared global helper on BlastyBiz.
---

# Shared global helper scripts belong in `<head>`

Any plain `<script src="...">` that defines a **global helper used by page code**
(`window.escHtml` / `window._esc` from `escape-utils.js` is the live example) must be
loaded inside `<head>`, before any script that calls it.

**Why:** a change once added `escape-utils.js` near the bottom of the body, next to
`header-loader.js` / `session.js`, on pages that call `escHtml` hundreds of lines
earlier. Classic scripts run in document order, so at call time the global was
`undefined` and every render touching it threw `TypeError: escHtml is not a function`.

The failure is brutal and misleading: the throw happens inside a render function, so
the *container renders empty* rather than showing an error. On the blast wizard this
looked exactly like "the review step is broken / the feature was never deployed" —
several deploy-verification cycles were burned before the console error was traced.
It also broke the profile load on the same page.

**How to apply:**
- Adding or moving a shared helper script? Put it directly after `<head>`.
- Watch for the module-scope bridge pattern `const escHtml = window.escHtml;` near the
  top of a big inline script — that snapshots the value at parse time, so a late load
  cannot fix it retroactively.
- Audit for regressions with: for each HTML file, compare the line number of the
  `escape-utils.js` include against the line of the first `escHtml`/`_esc` use; a
  later include (or a missing one, while `window.escHtml(...)` is still called) is a bug.
- A blank container with no visible error on a page that "should work after deploy" is
  worth one console check before assuming a bad deploy.
