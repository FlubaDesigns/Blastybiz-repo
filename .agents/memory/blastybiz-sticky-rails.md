---
name: Sticky rails / position:sticky on BlastyBiz pages
description: Why position:sticky silently fails in this codebase, and the two conditions that must both hold before a sticky side rail actually pins.
---

# position:sticky in this codebase

Two independent things break sticky here. A rail that "isn't sticky" is almost
always one of them, and the first is invisible in the CSS you just wrote.

## 1. Ancestor scroll containers created by `overflow-x: hidden`

The global stylesheet sets `overflow-x: hidden` on `html, body` and on
`body.has-site-header .main`. Per spec, an element with overflow non-visible on
one axis computes the other axis to `auto` — so each of those becomes a
**scroll container**, and any `position: sticky` descendant sticks relative to
that container (which never scrolls) instead of the viewport. The result looks
exactly like sticky being ignored.

Fix: override to `overflow-x: clip` for the page in question. `clip` gives the
same horizontal-overflow protection but does **not** create a scroll container.
Scope the override to the page's body class so other pages are untouched.

**Why:** the global `overflow-x: hidden` rules exist to stop horizontal scroll
on phones and must not simply be deleted.

## 2. The sticky element must be SHORTER than the viewport

A sticky element only has travel equal to
`containingBlockHeight - stickyElementHeight`. A rail card taller than the
viewport bottoms out almost immediately and scrolls away, which reads as
"sticky is broken" even though it is working.

Cap it: `max-height: calc(100dvh - var(--main-offset, 77px) - 32px)` plus
`overflow-y: auto` on the card, so it scrolls internally.

**How to apply:** when a sticky rail "doesn't stick", measure before theorising —
computed `overflow` of every ancestor, plus containing-block height vs element
height. A y that goes deeply negative immediately means cause 1; a y that pins
for a while and then slides away means cause 2.

## Sticky offsets

Sticky tops must use `var(--main-offset)` (55px base, 77px at >=768px), never a
hard-coded pixel value — the fixed site header sits above it.
