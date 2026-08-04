---
name: BlastyBiz functions module split
description: Structure and gotchas for the modular functions layout introduced in task #125
---

## Layout

```
functions/
  lib/shared.js          — all shared helpers, constants, db init, re-exports firebase-functions v2
  modules/ai.js          — AI CFs
  modules/publishing.js  — job triggers, platform publishers, Firestore triggers
  modules/business.js    — createBusiness, deleteBusiness, deleteAccount, triggers
  modules/payments.js    — Square checkout, webhook, pricing
  modules/oauth.js       — Google/Facebook OAuth + disconnect + checkPlatformTokenExpiry
  modules/admin.js       — all admin* endpoints + refreshYelpCategories + fetchAndCacheYelpCategories
  modules/scheduled.js   — all scheduled CFs
  modules/misc.js        — sendTestEmail, contactForm, unsubscribeEmail
  index.js               — Object.assign(exports, require('./modules/X')) barrel only
```

## Cross-module dependencies (non-circular)
- `admin.js` imports `_publishGoogleJob/_publishFacebookJob/_publishInstagramJob` from `publishing.js`
- `scheduled.js` imports `fetchAndCacheYelpCategories` from `admin.js`
- All modules import from `lib/shared.js`

## Gotchas
- `scheduledYelpCategoryRefresh`: use `every 720 hours` (= 30 days × 24); Cloud Scheduler only accepts `every N hours/minutes` not `every N days`
- `dispatchPublishJob` has `retry: true` — always deploy with `--force`
- `cleanupAbandonedSignups` was previously an HTTPS function; had to delete it first before redeploying as a scheduled function (`firebase functions:delete cleanupAbandonedSignups --region us-central1 --force`)
- `adminSetAiSettings` resets the AI settings cache via `resetAiSettingsCache()` exported from `lib/shared.js` — the cache variables live in shared.js as a singleton

## Why
Deploying the old monolithic index.js triggered all 62 endpoints every time. With modules, you can target `--only functions:adaptListing,functions:suggestPlatforms` etc.
