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

## Related
Do not start re-deploying, cache-busting, or auditing the predeploy script until you have
confirmed the read itself was valid. That misdiagnosis is expensive.
