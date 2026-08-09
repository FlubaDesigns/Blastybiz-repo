---
name: BlastyBiz e2e testing gotchas
description: How to drive the live site with the Playwright test account, and the traps that produce false failures.
---

# Running e2e tests against BlastyBiz

## The test account password has stray whitespace

The Playwright test-account password secret carries surrounding whitespace. Testers
that paste it literally get "Wrong email or password" and then waste the run trying
to create an account that already exists.

**How to apply:** tell the tester to strip ALL whitespace anywhere in the secret
(tr -d '[:space:]' equivalent — plain trim has failed testers before), fill the field
programmatically rather than typing, and use the Sign In form only — never fall back
to Create Account. Test email is playwright@blastybiz.dev. If a tester still reports
"Wrong email or password", verify the credential yourself via the Identity Toolkit
signInWithPassword REST call before believing it.

## Nothing is testable until it is deployed

There is no local server. Every change needs a Hosting (and, for functions, a
function) deploy before a tester can see it, and the tester must hard-reload to
beat the cache. A tester reporting old behaviour usually means one of those two
steps was skipped.

## Testers report false failures on persistence

Testers probe element ids that don't exist and conclude data didn't save. Confirm
persistence claims against Firestore directly (collection-group query on
`businesses`, no `orderBy` — ordering a collection-group query needs a composite
index and 400s without one) before believing a "did not persist" verdict.

## Distinguish "guide finished" from "guide broke"

Finishing the guided setup redirects into the blast flow with autogenerate on, so a
tester sees saving/publishing states rather than a lingering success screen. That is
correct behaviour, not a failed handoff.
