---
name: BlastyBiz home-page header clearance
description: Home page uses JS to set body padding-top; CSS must zero out .main padding-top on home-page to prevent double-stacking.
---

# Home-page header clearance — two-layer conflict

## The rule
`body.home-page .main { padding-top: 0 !important; }` must always be present in `global-style.css`.

## Why
`BlastyBiz-Home.html` injects the shared header via `fetch('blastybiz-header.html')` and then runs `_setHeaderOffset()` which sets `document.body.style.paddingTop = headerEl.offsetHeight + 'px'`. This JS reads the actual rendered header height (nav + badge bar combined) and owns body-level clearance on the home page.

The global rule `body.has-site-header .main { padding-top: var(--main-offset) }` also applies because the home page has both classes (`has-site-header home-page`). Without the zero-out, both stack: ~90px (JS on body) + 90px (CSS on .main) = ~180px dead space above the hero.

## How to apply
- All non-home pages: clearance via CSS `var(--main-offset)` on `.main` only.
- Home page: clearance via JS `body.style.paddingTop` only. CSS `.main` padding-top must be 0.
- If the header component height ever changes, `_setHeaderOffset()` adapts automatically — no CSS change needed for the home page.
- The `--main-offset` variable (67px mobile / 90px desktop at ≥768px) remains correct for all other pages.
