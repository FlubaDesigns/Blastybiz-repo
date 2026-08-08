---
name: BlastyBiz Firestore allowlist fail-closed trap
description: Why a save can appear to succeed in the UI while writing nothing, and how to verify rules changes before shipping.
---

## The rule
Business docs and user docs are guarded by `hasOnly([...])` allowlists on **both** `create` and `update`. Any field not on the list fails **closed** — the write is denied.

Several flows commit multiple docs in a single atomic `writeBatch`. One unlisted field on any one write therefore aborts **all** of them, leaving the owner with no business, no campaign, and `onboarded: false`.

**Why:** this burned a long debugging session. The UI showed a generic "something went wrong" and still navigated onward, so a rules rejection read as an AI/generation bug. Symptoms pointed at models and Cloud Functions; the cause was two missing field names.

## How to apply
- Adding a field to a business or user doc write? Add it to **both** the `create` and `update` lists in the same change. The two lists are near-duplicates but not identical — edit both.
- **Multiple pages write these docs** — onboarding, the create-business flow, the profile editor, the story page, and the dashboard. A field added by one breaks nothing else, but an allowlist audit done for only one writer will miss the others. Audit every writer, not just the one you are touching.
- Symptom → check first: a flow appears to finish but Firestore has no new docs → diff the written field set against both allowlists **before** investigating AI, Cloud Functions, or the client.
- Never add server-authoritative fields (plan/subscription/payment identifiers) to these lists.

## Verifying a rules change for real
The firebase-tools OAuth token is admin and **bypasses rules**, so REST writes with it prove nothing. Sign up a throwaway account via the Identity Toolkit REST API, replay the exact write payloads against Firestore `documents:commit` with that account's ID token (this path enforces rules), then delete the docs and the account. See `blastybiz-firestore-rest.md` for the token mechanics.
