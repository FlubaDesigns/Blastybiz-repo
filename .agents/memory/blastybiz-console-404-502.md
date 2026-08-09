---
name: BlastyBiz console 404/502 root causes
description: Where the mystery browser-console 404/502 errors came from and how to hunt similar ones.
---

## Root causes found (2026-08-09)
1. **404 — cloudfunctions.net URL missing for exported CFs**: `previewAds` and `extractBizContext` existed in code and at their run.app URLs, but the `us-central1-...cloudfunctions.net/<name>` mapping returned 404 until an explicit `firebase deploy --only functions:<name>` re-run. After adding a new CF, always curl `-X OPTIONS` the cloudfunctions.net URL (expect 204) — don't trust that "the module exports it".
2. **404 — Firestore REST fetch of a nonexistent doc**: `platforms-config.js` fetches `config/platforms` via unauthenticated REST; the doc didn't exist, so every page using it logged a 404 (code fell back to defaults silently). Fixed by creating an empty `config/platforms` doc. **Why:** graceful JS fallbacks still leave HTTP-level console errors.
3. **Page error on /BlastyBiz load**: `loadProfile()` wrote `.textContent` to `#profile-biz-name`/`#profile-biz-cat`, which no longer exist in markup — guard all legacy-element writes with null checks.
4. **Server-side 500 every 30 min (not browser)**: `checkPlatformTokenExpiry` needed a COLLECTION_GROUP fieldOverride on `platformConnections.status` (single-field CG queries need an exemption in firestore.indexes.json, not a composite index).

## How to apply
- To hunt console errors on the live site: system playwright chromium fails (libdbus); launch with `executablePath` pointing at the nix store playwright-browsers chromium (`/nix/store/*playwright-browsers-chromium/chromium-*/chrome-linux/chrome`, `--no-sandbox`).
- Login-page `#btn-signin` click is intercepted by an overlay in headless runs — press Enter in `#si-password` instead.
- Cloud Logging REST (`logging.googleapis.com/v2/entries:list` with the configstore-refresh token, filter `httpRequest.status>=500`) quickly separates server-side 5xx from browser-only noise.
- Firestore Listen/Write channel `net::ERR_ABORTED` failures are benign navigation aborts, not console HTTP errors.
