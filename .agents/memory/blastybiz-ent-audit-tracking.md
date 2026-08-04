---
name: BlastyBiz enterprise audit tracking
description: Current completion status through bb_ent_04. Pass 04 introduced 3 regressions that are now fixed.
---

## Production Gate Status (Pass 04 resolved — 2026-08-04)

All Pass 03 gate items remain closed. Pass 04 found 3 new regressions, all fixed.

### Pass 04 regressions — all fixed

| # | Item | Fix |
|---|---|---|
| 2.1 | `scheduledPostingCheck` read from `scheduledPosts` (nothing writes there) | Reverted to `collectionGroup('listingDrafts').where('schedule.enabled', '==', true)` — matches what frontend writes |
| 2.2 | Yelp functions missing `secrets: ['YELP_API_KEY']` | Removed entirely — Dave dropped the $229/mo Yelp API |
| 2.3 | 5 cron schedules changed with no rationale | Restored originals; both nudge emails set to weekly (Monday) per Dave |

### Yelp removal (2026-08-04)
Removed `refreshYelpCategories`, `scheduledYelpCategoryRefresh`, `fetchAndCacheYelpCategories`, import in scheduled.js, and all admin UI. Barrel now exports **62 functions** (down from 65). `check-release.cjs` EXPECTED_EXPORTS updated to 62. Existing `yelpCategories` Firestore data left in place.

### Current cron schedules
- `scheduledPostingCheck` — every 1 hours
- `scheduledUpgradeNudge` — every monday 10:00 ET (weekly — no more than once/week)
- `scheduledSetupNudge` — every monday 09:00 ET (weekly — no more than once/week)
- `scheduledWeeklyDigest` — every monday 08:00 ET
- `scheduledFirestoreExport` — 0 2 * * 0 PT (weekly Sunday)
- `cleanupAbandonedSignups` — every 24 hours

### scheduledPostingCheck — how it works
Reads `collectionGroup('listingDrafts').where('schedule.enabled', '==', true).limit(200)`.
Filters `nextRunAt <= now` in memory (ISO string in `schedule.nextRunAt`, not a Timestamp).
Path shape: `users/{uid}/businesses/{bizId}/listingDrafts/{id}`.
Content from `draft.adaptations[platformId]` (plain string). API platforms: google, facebook, instagram.
Updates `schedule.nextRunAt` and `schedule.lastRunAt` (ISO strings) after each run.

---

## Remaining open items (not production blockers)

### Security
- **2.8** — triggers read `job.uid`/`job.businessId` from doc data instead of `event.params`
- **2.9** — `admin-guard.js` no `emailVerified` check (client-side only; server enforcement correct)
- **3.5** — client uploads bypass server-side magic-byte validation
- **3.6** — signed URLs 10-year expiry
- **1.7 (half)** — admin still email allowlist not custom claim; 2 addresses in functions vs 1 in rules
- **1.5 / 1.9 (ops)** — revoke old OAuth tokens + Anthropic key rotation (console work)

### Scale
- **4.2** — 4 unbounded queries in `admin.js` now limited to 2000/5000; migrate to aggregation counters at scale

### Process
- **1.3 / 5.5** — CI exists (.github/workflows/check-release.yml) but not yet wired to a real GitHub remote
- **5.3** — no dependency scanning
- **5.4** — no SRI on CDN script tags

### Quarter
- **1.2** — staging project
- **1.1** — org/RBAC (blocks all Section 6 enterprise)

### Ops backfill
- Backfill `users/{uid}` docs for magic-link trial signups with missing docs
- Sweep orphaned `private` subcollection docs from accounts deleted before the fix
- Provider-side OAuth token revocation for tokens exposed before Pass 01 §1.5
- Delete `YELP_API_KEY` from Firebase Secret Manager (console)
