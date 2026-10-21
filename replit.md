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

## Campaign memory boundaries — October 21, 2026

Teach AI opens on the selected campaign and labels its working context. Both editors share that campaign brief; delayed saves capture the owner, business and campaign, serialize in-flight edits, preserve failures for retry, and write only campaignMemory. Switching campaign/business and generating copy flush pending edits first. Sharing a company fact uses an explicit review dialog and an append transaction; campaign interviews cannot write company memory. The standalone Memory page defaults to campaign facts, reads the canonical campaign subcollection, and captures the destination through scoring. Its company-wide fact action reviews the exact text.

The permanent category briefing excludes campaign fields. Ad generation and scheduled refresh use company identity as background and the selected campaign/Ad for audience, offer and message. No existing company memory is rewritten or migrated. No paid AI call, real blast, or customer email is needed for the fixture checks.

Checks: scripts/test-campaign-memory.cjs (DOM, write targets, retry/ordering, sharing and actual AI prompt captures); scripts/test-campaign-memory-browser.cjs (320–1440px, native dialog and explicit confirmation). Both are included in the existing release checks. Production deployment and authenticated acceptance require separate release evidence.
