# Rocket Mascot — Component Guide

A self-contained, portable animated SVG rocket mascot. Drop it into any site with one script tag. No framework, no build step, no external dependencies.

---

## Architecture — Two Separate Layers

The mascot is intentionally split into two independent layers:

| Layer | What it is | File |
|---|---|---|
| **SVG Structure** | The anatomy — groups, paths, gradients | embedded in each page (centralised file coming) |
| **Animation CSS** | The motion vocabulary — keyframes + trigger classes | same file for now; will be its own swappable `.css` |

**Why this matters:** You can drop in a completely different animation set without touching the SVG. Same rocket body, totally different motion vocabulary. A future "neon" or "minimal" animation theme is just a different CSS file.

---

## Portability Rules

- No brand-specific names in component identifiers. All IDs, classes, and JS globals use `mascot-` or `pb-mascot` prefix.
- Fully self-contained — all CSS, SVG markup, and JS bundled together.
- Any external site drops in one `<script>` tag and a placeholder `<div id="pb-mascot-zone">`.
- Animation class names describe what they **do**, not what they're called (`s-nose-pop-fast`, not `s-anim-3`).

---

## SVG Anatomy

The mascot element is `<div class="pb-mascot s-ask" id="pb-mascot">`. All animation classes are applied here.

Inside `<svg id="mascot-svg" viewBox="0 0 360 460">`:

| Group ID / Class | What it is | Animation target |
|---|---|---|
| `#mascot-svg` | Whole SVG | arrive-land, s-spin |
| `#mascot-body` | Full rocket body group | float, lean, wave, celebrate |
| `#mascot-exhaust .flame` | Flame gradient paths | flame color variants |
| `#mascot-nose .mascot-nose` | Nose cone group | spin, pop variants |
| `#mascot-nose-light` | Beacon dot on tip | s-light-nose blink |
| `.pupil-group-l` / `.pupil-group-r` | Left/right eye pupils | eye direction variants |
| `.mouth-happy` / `.mouth-working` / `.mouth-celebrate` / `.mouth-ask` | Mouth shapes | toggled by mood class |
| `#mascot-lights-waist .w-light` | 7 belt light circles | pulse, sequence, flash |
| `#mascot-smoke .smoke-puff` | 3 smoke ellipses (opacity:0 default) | smoke variants |
| `#mascot-arms .mascot-arm-wave` | Waving hand | revealed on s-wave |
| `#mascot-arms .mascot-arm-point` | Pointing hand | revealed on s-working |
| `#mascot-effects .confetti > g` | Confetti burst shapes | s-celebrate |
| `#mascot-badge` | Green B-logo band | static |

---

## Animation Class Reference

All classes applied to `#pb-mascot` (the wrapper div).

### Mood (body posture + mouth + pupils)

| Class | Description |
|---|---|
| `s-ask` | Default — slight lean left, ask mouth |
| `s-ask-2` | Lean right, pupils right |
| `s-ask-3` | Look up, slow bob |
| `s-wave` | Wave animation, arm revealed |
| `s-wave-2` | Big 5× wave |
| `s-happy` | Happy bounce, happy mouth |
| `s-working` | Focus float, working mouth, arm point |
| `s-celebrate` | Bounce + confetti + celebrate mouth |
| `s-spin` | 360° body spin + settle |
| `s-tilt-left` | 8° lean left float |
| `s-tilt-right` | 8° lean right float |
| `s-arrive-land` | Descend from above + bounce settle |

### Flame color

| Class | Color |
|---|---|
| *(none)* | Orange (default) |
| `s-flame-blue` | Blue |
| `s-flame-green` | Green |
| `s-flame-red` | Red |
| `s-flame-purple` | Purple |
| `s-flame-white` | White |

### Lights (waist belt)

| Class | Pattern |
|---|---|
| *(none)* | Off |
| `s-lights-pulse` | All pulse together |
| `s-lights-sequence` | Sequential left→right |
| `s-lights-flash` | Fast strobe |

### Eyes

| Class | Direction |
|---|---|
| *(none)* | Default (forward) |
| `s-eyes-up` | Look up |
| `s-eyes-down` | Look down |
| `s-eyes-left` | Look left |
| `s-eyes-right` | Look right |
| `s-eyes-roll` | Eye roll (2×) |
| `s-eyes-surprise` | Wide surprise |

### Smoke

| Class | Effect |
|---|---|
| *(none)* | Off |
| `s-smoke-sm` | 1 small puff, compact rise (1.2s) |
| `s-smoke-lg` | 1 large puff, big billow (1.9s) |
| `s-smoke-2` | 2 puffs staggered |
| `s-smoke-3` | 3 puffs staggered |
| `s-smoke` | Legacy alias for 3 puffs (kept for compat) |

### Nose

| Class | Effect |
|---|---|
| *(none)* | Off |
| `s-nose-spin-l` | CCW continuous spin (1.1s linear) |
| `s-nose-spin-r` | CW continuous spin (1.1s linear) |
| `s-nose-pop-slow` | Float up 32px → drift back (1.5s springy) |
| `s-nose-pop-fast` | Flick up 22px → snap back (0.45s springy) |
| `s-nose-spin` | Legacy one-shot 360° CW spring (kept for compat) |

### Other

| Class | Effect |
|---|---|
| `s-light-nose` | Beacon light blinks on nose tip |

---

## Composing Animations

Any combination of one class per category is valid:

```js
// In JS — set via setMood() or direct className
setMood({
  mood:     's-celebrate',
  flame:    's-flame-green',
  lights:   's-lights-flash',
  smoke:    's-smoke-3',
  noseSpin: 's-nose-spin-r'
});

// Or direct className (used in admin preview)
el.className = 'pb-mascot s-celebrate s-flame-green s-lights-flash s-smoke-3 s-nose-spin-r';
```

### DEFAULT_ANIM presets (in OB1)

Calling `setMood('s-celebrate')` auto-layers flame + lights + smoke from `DEFAULT_ANIM`. Explicit values in the spec override defaults.

| Mood | Auto-defaults |
|---|---|
| `s-wave` | green flame + sequence lights |
| `s-wave-2` | green flame + sequence lights + spin right nose |
| `s-ask-3` | pulse lights |
| `s-happy` | green flame + spin right nose |
| `s-working` | blue flame + pulse lights |
| `s-celebrate` | green flame + flash lights + 3-puff smoke |
| `s-spin` | purple flame + spin right nose |
| `s-arrive-land` | blue flame + pulse lights |

---

## Usage (drop-in)

```html
<!-- 1. Placeholder -->
<div class="pb-mascot s-ask" id="pb-mascot">
  <!-- SVG goes here (centralised file coming) -->
</div>

<!-- 2. Animation trigger -->
<script>
  document.getElementById('pb-mascot').className = 'pb-mascot s-wave s-flame-green s-lights-sequence';
</script>
```

---

## Changelog

| Date | Change |
|---|---|
| 2026-07-20 | Initial animation library built — flame colors, eye states, smoke (3-puff), nose spin (one-shot), lights (pulse/sequence/flash), arrive-land, spin, tilt, wave-2, ask variants, celebrate confetti |
| 2026-07-20 | `DEFAULT_ANIM` presets added — `setMood()` auto-layers flame/lights/smoke for each mood |
| 2026-07-20 | `setMood()` upgraded to accept composition object `{ mood, flame, lights, eyes, smoke, noseSpin }` or legacy string |
| 2026-07-21 | Smoke variants added — `s-smoke-sm`, `s-smoke-lg`, `s-smoke-2`, `s-smoke-3` |
| 2026-07-21 | Nose variants added — `s-nose-spin-l`, `s-nose-spin-r`, `s-nose-pop-slow`, `s-nose-pop-fast` |
| 2026-07-21 | All identifiers renamed `blasty-*` → `mascot-*`, `pb-blasty` → `pb-mascot` across all 4 pages |

---

## Roadmap

- [ ] Extract SVG into single source file (`mascot/mascot.svg` or `mascot/mascot.js`)
- [ ] Extract animation CSS into swappable layer (`mascot/mascot-anim-default.css`)
- [ ] Single `<script src="mascot.js">` drop-in that injects SVG + CSS into any placeholder div
- [ ] Audit which pages actually need the full mascot vs a lightweight fallback
