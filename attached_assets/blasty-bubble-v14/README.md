# Blasty Bubble System v1

This package directly addresses the two problems identified in the current onboarding:

1. The speech-bubble connection is a broad, rounded speech nub rather than a long sharp triangle.
2. Every message row contains its own Blasty rocket on desktop and mobile.

## Files

- `blasty-master.svg` — one authoritative layered production mascot.
- `blasty-bubbles.css` — responsive layout, rounded speech bubble, expressions and animations.
- `blasty-bubbles.js` — safely injects the master SVG into every message and rewrites duplicate SVG IDs.
- `blasty-bubble-demo.html` — working five-message example.

## Run the demo

Serve the folder through a local or hosted web server. `fetch()` is used to load the SVG, so opening the HTML directly with a `file://` URL may be blocked by the browser.

## Required message markup

```html
<article class="blasty-message" data-state="ask">
  <div class="blasty-avatar" aria-hidden="true"></div>
  <div class="blasty-bubble">
    <h3>Hey!</h3>
    <p>Want a little help getting started?</p>
    <span class="blasty-accent"></span>
  </div>
</article>
```

## Supported states

- `wave`
- `ask`
- `think`
- `working`
- `celebrate`

Talking can be triggered without changing mood:

```js
const message = document.querySelector('.blasty-message');
blastySystem.talk(message, 1600);
```

## Integration rule

Do not keep one rocket in a page-level header while rendering several disconnected bubbles below it. Render one `.blasty-message` for each piece of Blasty dialogue. That guarantees the rocket and bubble remain a visual pair at every breakpoint.

## Mobile behavior

At widths below 620 px, each row remains two columns:

- 76 px Blasty rocket
- flexible bubble

The rocket does not move to a separate top row. On very narrow phones it scales to 64 px.

## Notes for BlastyBiz integration

The current `s-wave`, `s-happy`, `s-ask`, `s-working`, and `s-celebrate` logic can map to this component as follows:

- `s-wave` → `wave`
- `s-happy` → `wave` or `celebrate`
- `s-ask` → `ask`
- `s-working` → `working`
- `s-celebrate` → `celebrate`

Keep the existing onboarding flow and replace only the page-level mascot/caption presentation with repeated `.blasty-message` rows.
