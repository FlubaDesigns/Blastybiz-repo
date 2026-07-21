---
name: BlastyBiz mascot portability rules
description: Dave's standing requirements for the SVG mascot component — naming, self-containment, portability.
---

## Rules (apply to every fix involving the mascot)

1. **No "Blasty" in the component name.** The mascot widget is a portable asset, not a BlastyBiz brand artifact. File names, web component tags, and JS globals must NOT use "Blasty" or "blasty" as an identifier. Use a generic descriptive name (e.g. `rocket-mascot`, `pb-mascot`, `mascot`).

2. **Fully self-contained.** The component file should bundle its own SVG markup, all CSS keyframes/classes, and all JS behavior in one file. No external stylesheet dependencies, no separate SVG file to fetch.

3. **Portable by design.** Any external site should be able to drop in a single `<script>` tag and have a working animated mascot. No BlastyBiz-specific globals, no Firebase, no Firestore required.

4. **Descriptive naming, not generic.** CSS class names and JS identifiers should describe what they DO — `s-nose-pop-fast`, `s-smoke-lg` — NOT generic tags like `s-anim-3` or `oseAnimChange`. The "anim" prefix is too vague; prefer the actual behavior name.

**Why:** Dave intends to use the mascot on other sites. BlastyBiz-specific naming would make it confusing to reuse and would create brand leakage.

**How to apply:** Before naming any new mascot-related file, class, function, or CSS identifier, ask: "Would this make sense on a non-BlastyBiz site?" If not, rename it.
