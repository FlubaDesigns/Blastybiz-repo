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

## Instance model (the mascot is no longer a singleton)

The component is instance-based: a factory creates a mascot bound to a container, and all state
(gaze, drag, park/mood timers) lives on the instance. The old top-level API still works — it
delegates to a lazily-created default instance bound to the conventional container id — so pages
written against the original API keep working untouched.

Constraints that are easy to break and cost real debugging time:

1. **Artwork must be addressed by class, never by id.** Ids in the artwork make it a singleton
   again: a second mascot's animations would drive the first one's elements.
2. **The artwork's internal gradient/clip ids must be uniquified per instance.** They are
   referenced with `url(#id)`; two instances defining the same ids means the second silently
   renders with the first one's colours. This failure is invisible until two mascots differ.
3. **The animation CSS lives in the component only.** A duplicate copy previously existed in the
   global stylesheet and a third inside a page. Never re-add animation rules to the global
   stylesheet — page-level rules there should be size/placement overrides and nothing else.
4. **A new instance needs an explicit width.** The wrapper class sets no width, so an
   unstyled container sizes to the SVG's intrinsic default (~300px) and blows up the layout.

**Why:** Dave built the mascot to be swappable, renameable, and usable more than once on a page.
Each rule above is a way the singleton assumptions creep back in.

**How to apply:** When adding a mascot anywhere, create an instance rather than reusing the
default container id, and give the container a width.

## Known wart: the global stylesheet's mascot size rule leaks

The global stylesheet carries a mascot width rule scoped to the conventional container **id**,
commented as a login-page tweak. Because id specificity beats class, it silently overrides the
size that any other page sets for its own mascot. Left alone deliberately during the portability
work — changing it alters the current appearance of several pages, which is a visual decision
for Dave, not a refactor.

