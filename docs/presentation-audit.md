# Shared presentation inventory

Issue [#38](https://github.com/FlubaDesigns/Blastybiz-repo/issues/38) owns completion and live evidence. This document describes the presentation owners and verification coverage; it is not another completion checklist.

The section 7 baseline is `4c7dda6a6d559e3ad748ef7714edb6c7c2e4cb30`. All 68 HTML documents/partials and their linked browser modules were inventoried. Static comparison retains all 871 existing links, buttons, inputs, selectors and text areas, including handlers, destinations, selection values and secondary-panel targets. Existing functional regressions cover the saved-record behavior separately.

| Concern | Owner and treatment |
| --- | --- |
| Page appearance | `public/global-style.css`. Nineteen page style blocks moved here with page scopes to prevent selector collisions. Fixed inline presentation is deduplicated into shared declarations. Older pale admin editors use the existing dark/green tokens. |
| Controls | `public/Buttons.css`. Existing button rules moved together with their order retained. Normal right-side three-dot menus preserve their native keyboard behavior, bounded scrolling and existing handlers. |
| Layout | Existing `.row` and `.layout__*` helpers. Old `grid`, `split*`, `two-col`, `three-col`, pricing and editor column aliases were migrated. Responsive tables retain native semantics inside keyboard-scrollable containers. |
| Plan and capability display | Existing `pricing.js` safe projection from `settings/pricing` and `config/plans`; `functions/lib/platforms.js` through the checked browser/public-copy generators. Section 7 introduces no prices, plan limits or capability authority. |
| Platform details | Repeated memory explanations remain in the page and are opened through the existing right-side menu. Primary platform facts and plan links stay visible. |
| Artwork | Ten retained source PNGs have 480px/896px WebP derivatives. `scripts/presentation-images.json` records source/variant sizes; `scripts/optimize-presentation-images.py` reproduces the derivatives. HTML uses `srcset`, explicit dimensions and lazy loading. |
| Dynamic presentation | Platform colors come from the existing platform object through a validated CSS custom property. Fact-score modifiers replace three malformed CSS declarations that contained literal JavaScript. |

The ten original PNGs total **13,977,665 bytes**. Phone derivatives total **358,084 bytes** (97.4% smaller); larger derivatives total **849,426 bytes** (93.9% smaller). These totals compare the asset set, not an invented single-page transfer count. Live verification checks served bytes and browser-selected sources separately.

Deliberate exceptions: the fail-closed authentication visibility rule remains in page heads; handlers retain initial hidden/display state and runtime progress/color values; SVG mascot animation retains its component styling; email-template HTML retains inline styles for mail-client compatibility. Historical source artwork and saved-record compatibility are preserved.

Focused verification uses the actual shipped markup/styles at 320, 384, 430 and 1280 pixels, with all external application requests blocked for fixture checks. It checks menu bounds/Escape, retained controls, card bounds, table scrolling to the final action, responsive-image decoding and explicit screenshots. Authenticated production verification reuses the existing Authorization Engine owner handoff and isolated section 6 fixture; it does not authorize writes to admin configuration, real customer data, billing, paid AI, email or publishing.
