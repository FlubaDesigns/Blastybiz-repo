---
name: BlastyBiz architecture
description: Stack decisions and proxy routing for BlastyBiz — no React/Vite, static HTML + Express.
---

## Stack
- Static HTML files in `artifacts/api-server/public/` — served by Express static middleware
- Express API server at port 8080, proxy paths: `/` (static) and `/api` (API routes)
- Firebase Auth + Firestore client-side via CDN imports in each HTML page
- No React, no Vite, no dev server for the front end — Dave's explicit requirement

## Proxy routing
- artifact.toml has `paths = ["/", "/api"]` both pointing to localPort 8080
- Static HTML is accessible at `/BlastyBiz-Dashboard.html`, etc.
- API routes are at `/api/adaptListing`, `/api/resolveCategories`, etc.

## Firebase
- Project: blastybiz-9523e
- Auth: Email/Password + Google enabled
- Firestore: us-east1 production mode
- SDK via CDN in firebase-init.js shared across all pages
- Auth guard in auth-guard.js imported as module script

## Cloud Functions
- functions/index.js has all 9 functions ready to deploy
- Requires Blaze plan to deploy
- As fallback: same logic runs as Express routes at /api/*

## Environment secrets needed
- ANTHROPIC_API_KEY — for /api/adaptListing and /api/resolveCategories
- No FIREBASE_SERVICE_ACCOUNT needed — approveDraft runs client-side

## Download zip + audit rule
After every fix or change: (1) update `download/BlastyBiz_Audit.md` — add a row to the 🐛 Bugs Fixed table and update the "Last updated" date and any affected page/function descriptions; (2) rebuild `download/BlastyBiz_Site.zip` using the Python zipfile script. Do both before responding to the user. The zip includes: `artifacts/api-server/public/**`, `functions/index.js`, `functions/package.json`, `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.firebaserc`, `download/BlastyBiz_Audit.md`.

**Why:** Dave explicitly asked that all fixes are automatically reflected in both the download zip and the audit markdown so his dev team always has the latest version.
