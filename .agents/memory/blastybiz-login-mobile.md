---
name: BlastyBiz Login Mobile Blasty
description: Why Blasty doesn't show on mobile Login page for returning users coming from onboarding
---

# Login Page — Blasty Invisible for Returning Users from Onboarding

## The Rule
`bb_guide_done` check must come AFTER `bb_start_choice` check, not before it.

**Why:** The MutationObserver that shows Blasty was bailing out early with `if (bb_guide_done) return` — this ran before checking `bb_start_choice`. Returning users (anyone who has signed in before) have `bb_guide_done` set, so Blasty never appeared even when they came from the Start Page.

**How to apply:** Any time the guide is gated on `bb_guide_done`, check `bb_start_choice` first. Coming from the Start Page always overrides the returning-user skip.

## Mobile Positioning
On mobile (<540px), the float element uses column layout (mascot above, bubble below). Total element width is ~124px (bubble dominates, not mascot). The JS `floatW` must be 124, not 62 — using 62 pushes Blasty 54px off-screen right.

Position: right-aligned to viewport (`left = window.innerWidth - 124 - 4`), above anchor's top.

## URL Param Fallback
`?start=guided` or `?start=forms` URL params act as fallback for `bb_start_choice` localStorage. Added for testing and marketing deep-links.

## Social Buttons
Sign Up form restructured: Google/Facebook buttons now appear at the TOP of the signup form (before OR divider, before email/password form). Immediately visible on mobile without scrolling. Sign In form still has social buttons at bottom — flagged as follow-up task.
