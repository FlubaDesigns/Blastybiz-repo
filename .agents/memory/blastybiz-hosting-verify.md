---
name: BlastyBiz hosting deploy verification
description: Why curling a .html URL to verify a Firebase Hosting deploy gives a false negative on this project.
---

## The trap
`firebase.json` sets `"cleanUrls": true`. Requesting `https://blastybiz.com/SomePage.html`
returns a **~34-byte redirect stub**, not the page. Grepping that stub for your change
returns 0 matches, which looks exactly like "the deploy silently failed."

**Why:** cleanUrls serves pages at the extensionless path and 301s the `.html` form.
A plain `curl` (no `-L`) captures the stub, never the real document.

**How to apply:** to verify any hosting deploy, curl the **extensionless** path and follow
redirects:

```
curl -sL "https://blastybiz.com/BlastyBiz-Onboard2" | grep -c "<some string from your change>"
```

Sanity check: the real page is tens of KB. If `curl ... | wc -c` returns a number in the
tens of bytes, you fetched the redirect stub, not the page. Compare against
`wc -c public/<file>.html` before concluding a deploy failed.

## The second trap: cleanUrls pages were NOT covered by the no-cache header
The header rule `"source": "**/*.html"` matches the *request path*, and a cleanUrls page is
requested as `/BlastyBiz-Onboard2` — **no `.html`, so the rule never applied**. Those pages
silently fell back to Firebase Hosting's default `cache-control: max-age=3600`.

Consequence: after a deploy, real browsers (phones especially) kept serving the **previous**
version of every page for up to an hour, while `curl` fetched fresh. This produces the worst
possible debugging signal — "verified fixed from the shell, user still sees it broken" — and
sends you hunting for backend bugs that do not exist.

Fixed by adding a rule ahead of the js/css rules:
```json
{ "source": "**/!(*.*)",
  "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }] }
```
`!(*.*)` is extglob for "path with no dot" = every cleanUrls page. Verify after deploy:
`curl -s -o /dev/null -D - -L "https://blastybiz.com/<Page>" | grep -i cache-control`
should say `no-cache`, while `/session.js` should still say `max-age=3600`.

## Related
Do not start re-deploying, cache-busting, or auditing the predeploy script until you have
confirmed the read itself was valid. That misdiagnosis is expensive.

**If the shell says fixed and the user says broken, check the cache header on the clean URL
before touching backend code.**
