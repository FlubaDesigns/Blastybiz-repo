---
name: BlastyBiz architecture
description: Stack, file locations, and the non-negotiable deploy rule for BlastyBiz
---

## Stack
- Firebase Hosting — serves all static files from `public/` (blastybiz-9523e.web.app)
- Firebase Auth — Email/Password + Google
- Firestore — primary database (us-east1)
- Cloud Functions — all server logic in `functions/index.js`
- Anthropic Claude — AI via `ANTHROPIC_API_KEY`

## There is NO dev server
The Express API server has been permanently deleted. There is no local preview server.
Do NOT create Vite apps, React apps, Express servers, or any Replit-hosted artifact. Ever.

## Where things live
- `public/` — all HTML/CSS/JS (source of truth; Firebase Hosting public dir)
- `functions/index.js` — all Cloud Functions
- `firestore.rules` — security rules
- `firebase.json` — hosting public dir is `public/`

## DEPLOY RULE — NON-NEGOTIABLE
**Deploy immediately after EVERY change. No exceptions. No batching.**

```
firebase deploy --only hosting          # any HTML/CSS/JS change
firebase deploy --only functions        # any Cloud Function change
firebase deploy --only firestore:rules  # any rules change
```

**Why:** Dave does not use the Replit preview at all. Firebase IS the environment.
Every change that isn't deployed is invisible to him and wastes his time.

**How to apply:** After every Edit/WriteFile to public/ or functions/ — deploy before
closing out the response. If multiple changes are made in one turn, one deploy covers all.
