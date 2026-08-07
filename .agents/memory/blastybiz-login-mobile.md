---
name: BlastyBiz Login Mobile Blasty
description: Why Blasty doesn't show on mobile Login page for returning users coming from onboarding
---

# Login Page — Blasty Invisible for Returning Users from Onboarding

## The Rule
`bb_guide_done` check must come AFTER `bb_start_choice` check, not before it.

**Why:** The MutationObserver that shows Blasty was bailing out early with `if (bb_guide_done) return` — this ran before checking `bb_start_choice`. Returning users (anyone who has signed in before) have `bb_guide_done` set, so Blasty never appeared even when they came from the Start Page.

**How to apply:** Any time the guide is gated on `bb_guide_done`, check `bb_start_choice` first. Coming from the Start Page always overrides the returning-user skip.

## Mobile Positioning — Use Inline, Not Fixed
`position:fixed` is unreliable on mobile for this use case (SVG sizing collapse, CDN cache, viewport issues). The correct approach: on mobile (<540px), move `#login-blasty-float` INSIDE `.auth-card` via `card.insertBefore(floatEl, card.firstChild)` in `setup()`, add class `login-blasty-inline`, and let CSS handle it with `position:relative !important; opacity:1 !important`. `positionBlasty()` returns early when `login-blasty-inline` is present — no positioning math needed. Desktop keeps the `position:fixed` floating approach unchanged.

## URL Param Fallback
`?start=guided` or `?start=forms` URL params act as fallback for `bb_start_choice` localStorage. Added for testing and marketing deep-links.

## Social Buttons
Sign Up form restructured: Google/Facebook buttons now appear at the TOP of the signup form (before OR divider, before email/password form). Immediately visible on mobile without scrolling. Sign In form still has social buttons at bottom — flagged as follow-up task.
