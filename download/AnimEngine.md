# BlastyBiz — Blasty Reference Guide

Everything you need to know about Blasty: how it was built, where it lives on the page, its visual design, animations, facial features, and the full onboarding question flow.

---

## What Is Blasty?

Blasty is the BlastyBiz mascot — a kawaii-style rocket character rendered entirely in inline SVG. No image files, no external assets. Every expression, animation, and mood state is driven by CSS classes and keyframe animations applied directly to the SVG.

Blasty appears on:
- `BlastyBiz-Trial.html` — the magic-link sign-up page
- `BlastyBiz-Onboard2.html` — the full post-signup onboarding flow

---

## Physical Design / Anatomy

Blasty is a rocket with a personality. Built from SVG shapes:

| Part | Description |
|------|-------------|
| **Nose cone** | Red pointed triangle at the top (`<path>`) |
| **Body** | White rounded rectangle cylinder (`<rect rx="30">`) — main body |
| **Red band** | Lower section of body is red, clipped with `clipPath` for clean rounded corners |
| **Left fin** | Red swept fin, left side (`<path>`) |
| **Right fin** | Red swept fin, right side (mirrored) |
| **Porthole** | Blue circle window on the body |
| **Left eye** | White ellipse + dark navy pupil circle + white shine dot |
| **Right eye** | White ellipse + dark navy pupil circle + white shine dot |
| **Rosy cheeks** | Two soft pink ellipses, semi-transparent (`opacity: 0.75`) |
| **Mouth** | Dark navy smile arc |
| **Flame** | Multi-layer orange/yellow ellipses at the base, always pulsing |
| **Motion lines** | Short lines beside the fins for speed effect |
| **Confetti** | 6 colored rectangles hidden until `s-celebrate` fires |

**Pupil groups** (`pupil-group-l`, `pupil-group-r`) are SVG `<g>` elements with `transition: transform .3s ease` — this lets mood states shift the pupils smoothly without JavaScript.

---

## Location on Page

Blasty lives in a fixed zone (`pb-blasty-zone`) that stays visible as the user scrolls through the chat thread.

### Desktop (≥860px)
- Zone: right-side fixed column
- Width: **160px**
- Caption appears below Blasty

### Tablet (580px–859px)
- Zone: top of page, full width, centered
- Width: **110px**
- Caption appears beside Blasty
- Left/right positioning: `blasty-pos-left` → `flex-start`, `blasty-pos-right` → `flex-end` + `flex-direction: row-reverse`

### Mobile (<580px)
- Zone: top of page, compact
- Width: **68px**
- Caption: smaller font, max-width 160px

### Left vs Right Positioning
Each step in the onboarding declares `pos: 'left'` or `pos: 'right'`. The `setPosition()` function toggles the `blasty-pos-left` / `blasty-pos-right` class on `pb-blasty-zone`. This mirrors Blasty's side to match where the conversation is happening, making it feel like Blasty is looking at the user's response bubble.

---

## Mood States

Blasty has 5 mood states, set by adding a class to `#pb-blasty`. Each triggers animations on the SVG body, pupils, and flame. Mood transitions strip all classes, force a reflow (`void el.offsetWidth`), then re-apply to restart animations fresh every time.

### `s-wave` — Greeting
- **Body:** Tilts side-to-side (4 cycles of `b-wave`), then settles into idle float
- **Pupils:** Scale up 1.15× and shift up — wide-eyed excitement
- **Use:** First step, welcoming the user
- **Caption:** "Hey there! 👋"

### `s-happy` — Positive acknowledgment
- **Body:** Quick bounce with squish on landing (3 cycles of `b-bounce`), then float
- **Pupils:** Shift down + compress vertically — happy squint
- **Use:** After a good answer, mid-flow affirmation
- **Caption:** "Looking good! 🎉"

### `s-ask` — Leaning in, curious
- **Body:** Slow rhythmic lean (`b-lean`, infinite) — Blasty leans toward the input
- **Pupils:** Shift left 5px — looking at the form
- **Use:** When asking for detail (phone, address, story questions)
- **Caption:** "Tell me more..."

### `s-working` — Processing / thinking
- **Body:** Rapid side-to-side shake (`b-work`, infinite)
- **Pupils:** Drop down — concentration
- **Flame:** Goes wild — flares to 1.9× scale at high frequency (`b-flame-work`, 0.35s loop)
- **Use:** AI calls, saving data, generating content
- **Caption:** "On it..."

### `s-celebrate` — Done!
- **Body:** Fast repeated bounce (`b-celebrate`, 5 cycles)
- **Confetti:** 6 colored pieces burst outward (`confetti-burst`, 1.6s forwards)
- **Use:** End of onboarding, successful blast
- **Caption:** "Let's blast! 🚀"

---

## Always-On Effects

Regardless of mood state, two things are always running:

1. **Idle float** (`b-float`, 3.2s infinite) — gentle up/down bob after mood animations complete. Each mood chains into float after its active animation finishes.

2. **Flame pulse** (`b-flame-pulse`, 0.55s infinite) — the flame at the base always flickers. Scale oscillates subtly. `transform-origin: top center` so it flickers from the rocket down.

---

## Arrive Animation

When Blasty first appears on the page, it triggers `s-arrive` for 450ms — a spring-like scale-in (`cubic-bezier(.34,1.56,.64,1)`) that makes Blasty pop in with a bounce overshoot. Runs once on load, then mood takes over.

---

## Mood Captions

Each mood has a text label that appears below (desktop) or beside (tablet/mobile) Blasty:

| Mood | Caption |
|------|---------|
| `s-wave` | Hey there! 👋 |
| `s-ask` | Tell me more... |
| `s-happy` | Looking good! 🎉 |
| `s-working` | On it... |
| `s-celebrate` | Let's blast! 🚀 |

The caption element (`pb-blasty-caption`) updates via `setMood()` any time the mood changes.

---

## Onboarding Question Flow — Full Step List

All 22 steps in `BlastyBiz-Onboard2.html`. Each step shows: Blasty's mood, which side Blasty is on, what's asked, the input type, and skip logic.

| # | Mood | Side | Question / Action | Input Type | Skip If |
|---|------|------|-------------------|------------|---------|
| 1 | s-wave | Right | Blasty intro + "What's your name?" | text | — |
| 2 | s-happy | Left | "Nice to meet you, [ownerName]! What's the name of your business?" | text | — |
| 3 | s-ask | Right | What's your title at [bizName]? | text | — |
| 4 | s-happy | Left | Best phone number for [bizName]? | tel | — |
| 5 | s-ask | Right | Is [bizName] a physical location, online only, or both? | choice | — |
| 6 | s-ask | Left | Street address? | text | locationType = online |
| 7 | s-happy | Right | City? | text | locationType = online |
| 8 | s-ask | Left | State? | text | locationType = online |
| 9 | s-happy | Right | ZIP code? | text | locationType = online |
| 10 | s-working | Left | Website for [bizName]? | url | locationType = brick |
| 11 | s-celebrate | Right | **Fork** — "Let's blast!" vs "Tell me your story" | choice | — |
| 12 | s-ask | Left | How did [bizName] get started? | textarea | answer = blast |
| 13 | s-happy | Right | What makes [bizName] different from the competition? | textarea | answer = blast |
| 14 | s-ask | Left | Any awards, press, or milestones worth knowing? | textarea | answer = blast |
| 15 | s-happy | Right | Who's the ideal customer for [bizName]? | textarea | answer = blast |
| 16 | s-ask | Left | Anything else the AI should always know? | textarea | answer = blast |
| 17 | s-working | Right | What's this campaign called? | text | — |
| 18 | s-ask | Left | What's this campaign about? | textarea | — |
| 19 | s-happy | Right | Who are you targeting with this campaign? | text | — |
| 20 | s-ask | Left | Any special offer or call to action? | textarea | — |
| 21 | s-working | Right | Which platforms do you want to blast on? | multiselect | — |
| 22 | s-working | Left | **AI Category** — Blasty calls `suggestCategory` CF, states result: "The best category for [bizName] on the platforms is [Category] — does that sound right?" | ai-suggest | — |

### Platform Options (Step 21)
| Platform | Plan Required |
|----------|--------------|
| 📍 Google Business | All plans |
| 📘 Facebook Page | All plans |
| 📸 Instagram | Pro / Agency only |
| 𝕏 Twitter / X | Pro / Agency only |
| 💼 LinkedIn | Pro / Agency only |

### AI Category Step (Step 22) — How It Works
1. Blasty enters `s-working` mood and says the loading message
2. A spinner appears in the user bubble
3. A `fetch()` call hits the `suggestCategory` Cloud Function with `{ bizName }`
4. The CF calls Gemini via `callAI()` with a tight prompt — returns 1–4 word category
5. Blasty changes to `s-happy`, adds a new bubble stating the category confidently
6. User sees **✅ Yep, that's it** or **✏️ Not quite**
7. "Not quite" swaps in a free-text input for manual entry (Enter key or button)
8. Accepted value saved to Firestore business doc as `category`

---

## Input Types Used in Onboarding

| Type | Description |
|------|-------------|
| `text` / `tel` / `url` | Standard single-line inputs with Continue button |
| `choice` | Tap-to-select buttons — auto-advance on selection, no Continue button |
| `textarea` | Multi-line input for story/campaign fields |
| `multiselect` | Checkbox-style grid — Pro/Agency-locked items shown but disabled for Free/Trial |
| `ai-suggest` | Async AI fetch → Blasty speaks the result → confirm or free-type override |

---

## Blasty JavaScript API

All Blasty control functions are defined in the page's `<script>` block:

| Function | What It Does |
|----------|-------------|
| `setMood(mood)` | Strips all mood classes, forces reflow, applies new class + updates caption |
| `setPosition(pos)` | Toggles `blasty-pos-left` / `blasty-pos-right` on the zone element |
| `addBlastyBubble(html)` | Appends a Blasty speech bubble to the chat thread |
| `addUserBubble(id)` | Appends a user reply bubble, returns the element |
| `lockBubble(el, value)` | Replaces input UI inside a bubble with plain confirmed text |
| `showStep()` | Advances to next STEPS entry — handles skipIf, delay, mood, position, renderInput |
| `renderInput(s)` | Renders the correct input UI for the step's inputType |
| `_ob2Continue()` | Validates current input, locks bubble, advances step |
| `_ob2PickChoice(el)` | Handles choice button tap — auto-advances |
| `_ob2MsChange()` | Syncs multiselect checkboxes to hidden input |
| `_ob2AcceptSuggestion(val)` | Accepts AI category suggestion, locks bubble, advances |
| `_ob2ChangeSuggestion()` | Swaps AI result for a text input so user can type their own |

---

## Cloud Functions Used by Blasty

| Function | Trigger | What It Does |
|----------|---------|-------------|
| `suggestCategory` | Called by Step 22 `fetchFn` | Takes `bizName`, calls Gemini via `callAI()`, returns `{ category }` — 1–4 word business type |

---

## Data Saved on Completion (`_ob2Save`)

When the user completes all steps, `_ob2Save()` writes two Firestore documents:

**Business doc** (`users/{uid}/businesses/{bizId}`):
`name, category, ownerName, role, phone, street, city, state, zip, website, locationType, story, different, awards, customer, other, uid, onboarded: true, createdAt`

**Campaign doc** (`users/{uid}/businesses/{bizId}/campaigns/{campId}`):
`id, name, offer, campaignStory, onboardingPlatforms, createdAt, lastUsedAt, photos, adName, price, factoids, platformHistory`

After save, redirects to:
`BlastyBiz.html?bizId=xxx&cid=yyy&autogenerate=1`

---

## File Locations

| File | Purpose |
|------|---------|
| `artifacts/api-server/public/BlastyBiz-Onboard2.html` | Full Blasty onboarding flow — source of truth |
| `artifacts/api-server/public/BlastyBiz-Trial.html` | Blasty on the magic-link sign-up page |
| `functions/index.js` | `suggestCategory` Cloud Function |
