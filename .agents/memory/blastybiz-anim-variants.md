---
name: BlastyBiz animation variant patterns
description: How smoke and nose variants are structured in OB1 + admin editor; backward-compat rules for boolean noseSpin/smoke values.
---

## Pattern
All Blasty animation properties (mood, flame, lights, eyes, smoke, noseSpin) are saved as **CSS class-name strings** (not booleans) in Firestore `config/ob1Steps[key].anim`.

Admin editor dropdowns drive the values. `setMood()` in OB1 handles legacy booleans:
- `smoke === true` → `'s-smoke-3'`
- `noseSpin === true` → `'s-nose-spin-r'`

## Smoke classes (in both OB1 + admin editor CSS)
- `s-smoke` — legacy 3-puff (kept for backward compat)
- `s-smoke-sm` — 1 small puff, 1.2s compact rise
- `s-smoke-lg` — 1 large puff, 1.9s billow
- `s-smoke-2` — 2 puffs staggered
- `s-smoke-3` — 3 puffs staggered (canonical replacement for s-smoke)

## Nose classes (in both OB1 + admin editor CSS)
- `s-nose-spin` — legacy one-shot 360° CW spring (kept for backward compat)
- `s-nose-spin-l` — CCW continuous spin, 1.1s linear infinite
- `s-nose-spin-r` — CW continuous spin, 1.1s linear infinite
- `s-nose-pop-slow` — float up 32px → drift back, 1.5s springy
- `s-nose-pop-fast` — snappy flick 22px → snap back, 0.45s springy

## Admin editor constants (BlastyBiz-Admin-OnboardSteps.html)
`SMOKE_OPTS`, `NOSE_OPTS` — follow same pattern as `MOOD_OPTS`, `FLAME_OPTS`, `LIGHTS_OPTS`, `EYES_OPTS`.
All use `sel(OPTS, value)` helper to render `<select>`.

**Why:** Dave's preference is dropdown selects (not checkboxes) for all animation properties. When adding future animation variant families, follow this same pattern: add CSS classes to both OB1 and admin editor, add an `*_OPTS` constant, replace/add a select in the template, handle string value in `_oseAnimChange` and `_osePreview`, add backward-compat in `setMood()`.

## Admin auth fix
`config/admins` Firestore document holds the `emails` array for admin write access.
Dave's mobile account is `perceys@gmail.com` — this is in `config/admins`. `info@blastybiz.com` is the bootstrap hardcoded admin in `firestore.rules`.
