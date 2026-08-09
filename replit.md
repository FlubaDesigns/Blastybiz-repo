# BlastyBiz

A Firebase-hosted multi-platform social media blasting tool for small businesses.

## Architecture
- Firebase Hosting (static files in `public/`)
- Cloud Functions (Node.js, in `functions/`)
- Firestore database
- No Express server

## User Preferences
- **No inline styles.** All CSS must go in `public/global-style.css` or a dedicated page-level `.css` file. No `<style>` blocks inside HTML files and no `style=""` attributes on individual elements.
- Deploy after every change — no exceptions.

## Pre-deploy checks
- `node scripts/check-release.cjs` — full release audit; includes the Cloud Function endpoint check below (skip that one network check with `SKIP_CF_ENDPOINT_CHECK=1` when offline).
- `node scripts/check-cf-endpoints.cjs` — greps `public/` for every `cloudfunctions.net/<name>` reference and asserts each URL answers an OPTIONS preflight with 204. A 404 means the function shipped undeployed (the previewAds/extractBizContext failure mode). Run after adding any new Cloud Function referenced from a page; fix with `firebase deploy --only functions:<name>`.
