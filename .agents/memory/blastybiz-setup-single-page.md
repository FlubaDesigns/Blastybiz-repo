---
name: Setup is ONE page with a guide layer
description: The conversational onboarding wizard is not a separate page — it is a layer over the real Create Business form. Rules for changing setup.
---

# Setup is one page: the real form, with Blasty layered over it

Onboarding used to fork into a conversational wizard page (its own inputs, its own
save) and a plain form page (different save schema). That fork is gone. There is now
**one** setup page — the Create Business form — and the conversational experience is a
docked mascot + speech-bubble layer that walks the user through the *real* form inputs
one question at a time (`guided-setup.js`, a page-agnostic library configured with a
step list). `?guide=1` starts it; without the param the user just gets the plain form.

**Why:** two pages meant two sets of fields and two save paths, and they drifted. The
form path wrote a nested `address` object and a `toggles` object, while the rest of the
app reads **top-level** `street`/`city`/`state`/`zip`, `ynMention*` as `'yes'`/`'no'`
strings, and `aiContext`. Businesses created via the form therefore silently lost their
address and mention preferences in the AI prompt. Any second setup path will drift the
same way.

**How to apply:**
- Never add a second setup page or a second business-save path. New setup questions are
  a new form field plus one entry in the guide's step list.
- The old wizard filename is kept as a stub because trial magic-link emails, bookmarks
  and several in-app links point at it. The stub is **not** a bare redirect: sign-in
  email links are delivered to that URL, and the setup form sits behind the auth guard,
  which would bounce a not-yet-signed-in visitor to login and burn the link. The stub
  must complete `signInWithEmailLink` first, strip `oobCode`/`apiKey`/`mode`/`lang`,
  then forward. Check this whenever the stub or the trial email URL is touched.
- Before changing what setup writes, check how the app *reads* a business doc (the
  Create tab, the Profile page, and the adaptListing prompt) — the canonical shape is
  defined by the readers, not by whichever writer you are editing.

## Tear down visible UI before calling third-party teardown

`GuidedSetup.stop()` removes its layer FIRST, then destroys the mascot inside a
try/catch. Doing it the other way round meant a throw inside the mascot's
`destroy()` left the guide bar stuck on screen — "I'll fill it in myself" looked
like a dead button.

**Why:** the mascot is a shared component maintained separately; any change to it
can throw, and the user must still be able to dismiss the guide.

**How to apply:** in any dismiss/close path, detach the visible element before
running cleanup that reaches into code you don't control, and wrap that cleanup so
a failure only logs.
