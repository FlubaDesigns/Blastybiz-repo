---
name: BlastyBiz enterprise audit tracking
description: Current completion status of the bb_ent_01/02/03 audit findings. Pass 03 is the production-gate audit — four items, two now done. Trust this file over session summaries.
---

## Production Gate Status (Pass 03 — 2026-08-04)

Pass 03 asked: "what breaks if you go live tomorrow?" Answer: 4 items.

| # | Item | Status |
|---|---|---|
| 1 | Broken barrel | ✅ Fixed (prior session) |
| 2 | 13 dead lib/ files | ✅ Fixed (deleted) |
| 3 | reserveAiAction throws on missing user doc | ✅ Fixed (tx.set merge:true) |
| 4 | private/tokens survives deleteAccount | ✅ Fixed (prior session) |

**All four production-gate items are closed. Safe to take payments.**

---

## Fixes applied this session (2026-08-04)

- **Dead lib/ files (§2)** — Deleted 13 unimported files: `ai.js auth.js config.js db.js email.js logging.js plans.js platforms.js publishers.js rateLimit.js square.js unsub.js yelp.js`. Only `lib/shared.js` remains (the live file). Also removed duplicate `setGlobalOptions` call from `shared.js` (kept in `index.js`).
- **reserveAiAction (§3)** — `tx.update()` → `tx.set({merge:true})` in both branches (`lib/shared.js`). Affects any user whose `users/{uid}` doc is missing (pre-fix magic-link trial signups).
- **check-release.cjs (§ strongly recommended)** — Added Check 6 (barrel export count ≥65) and Check 7 (no dead files in `lib/`). All 7 checks pass. Run with `node scripts/check-release.cjs` before every deploy.

---

## Remaining open items (not production blockers)

### Security (do soon)
- **2.8** — publish triggers read `job.uid`/`job.businessId` from doc data instead of `event.params`; not exploitable (admin-only job writes) but wrong pattern
- **2.9** — `public/admin-guard.js` no `emailVerified` check; client-side only, server enforcement correct
- **3.5** — client uploads bypass server-side magic-byte validation in `uploadImage`
- **3.6** — signed URLs 10-year expiry
- **1.7 (second half)** — admin still email allowlist (not custom claim); drift: 2 addresses in `BOOTSTRAP_ADMIN_EMAILS` vs 1 in rules `isAdmin()`
- **1.5 (ops)** / **1.9 (ops)** — revoke browser-exposed OAuth tokens + Anthropic key rotation (console/ops work, not code)

### Scale (do before significant user growth)
- **4.2** — 4 unbounded queries in `modules/admin.js`: lines 157, 368, 371, 489; lines 368+371 are same handler (reads entire users collection + all publish jobs on one page load)
- **4.3** — N+1 reads in scheduled jobs

### Process
- **1.3 / 5.5** — no CI; wire `node scripts/check-release.cjs` into a GitHub Action
- **5.3** — no dependency scanning
- **5.4** — no SRI on ~40 Firebase CDN script tags

### Nice-to-have / product
- **5.2** — extract inline JS from `BlastyBiz.html`
- **5.7** — product decision: nudge users who skipped Story

### Quarter
- **1.2** — staging Firebase project; `blastybiz-9523e` hardcoded 172×
- **1.1** — `organizations`/`memberships`/RBAC (blocks all 11 Section 6 enterprise gaps)

### Outstanding ops tasks (backfill)
- One-time sweep for orphaned `private` subcollection docs from accounts deleted before the deleteAccount fix
- Backfill missing `users/{uid}` documents for authenticated users who have no doc (magic-link trial signups before §3.3 fix)
- Provider-side token revocation: `deleteAccount` should revoke Google/Facebook tokens before deleting docs (like `disconnectPlatform` already does)
