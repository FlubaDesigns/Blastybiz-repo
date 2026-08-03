/**
 * escape-utils.js — shared HTML escaping for all BlastyBiz pages.
 *
 * Single canonical implementation: covers &, <, >, ", and ' (apostrophe).
 * Several pages previously had their own copies; some were missing the apostrophe
 * escape (BizContext.html's copy was confirmed to have this bug).
 *
 * Usage in plain scripts:   escHtml(str)           (global via window.escHtml)
 * Usage in module scripts:  const escHtml = window.escHtml;
 *
 * All 11 local escHtml / _esc function definitions across the codebase now
 * delegate to this canonical version. To update the implementation, change it
 * here — not in any individual page.
 */
(function () {
  'use strict';
  function _escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  window.escHtml = _escHtml;
  window._esc    = _escHtml; // alias used by Admin-Platform-Health, Admin-Queue-Manager, Admin.html
})();
