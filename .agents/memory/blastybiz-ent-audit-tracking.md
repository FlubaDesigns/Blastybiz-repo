---
name: BlastyBiz enterprise audit tracking
description: Current completion status of the bb_ent_01/02 audit findings (47 original). Pass 02 corrected several items the memory had wrong — trust this file over session summaries.
---

## Score: ~24/47 done (Pass 02 ground truth, 2026-08-04)

Pass 02 audited actual source and overruled the old session-summary scores.
Items 2.8, 2.9, 3.5, 3.6, 4.2, 4.3 were NOT done — old memory was wrong.

### Confirmed done (Pass 02 §1, verified in source)
1.4, 1.5, 1.6, 1.8,
2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.10,
3.1, 3.2, 3.3, 3.4,
4.1, 4.4, 4.5, 4.6, 4.7, 4.8,
5.1

### Done this session (Pass 02 §0 + new finding)
- **§0 barrel bug** — `functions/index.js` required `./ai` etc (MODULE_NOT_FOUND); fixed to `./modules/ai` etc; added `./modules/business` and `./modules/misc`; header comment updated to match actual disk layout. 65 exports verified with `node -e` before deploy.
- **private/tokens orphan** — `deleteAccount` in `modules/business.js` now enumerates `private` subcollection under each platformConnection before batching deletes (Firestore doesn't cascade-delete subcollections).

### Partial
- **1.7** — email_verified check added; custom-claims half still open (admin is still email allowlist in functions AND rules, with drift: 2 addresses in BOOTSTRAP_ADMIN_EMAILS vs 1 hardcoded in isAdmin() rules)
- **1.9** — Anthropic key removal from Replit shared env: cannot verify from source (ops step)
- **4.9** — scheduledFirestoreExport CF deployed; PITR + GCS bucket + IAM + tested restore are console/CLI ops steps

### Remaining (still open, not done)

**Security — do soon:**
- **2.8** — publish triggers still read `job.uid` / `job.businessId` instead of `event.params` (4 triggers in `modules/publishing.js`)
- **2.9** — `public/admin-guard.js` has no `emailVerified` check
- **3.5** — client uploads direct via `uploadBytesResumable`, bypassing magic-byte validation in `uploadImage` CF
- **3.6** — signed URLs still 10-year expiry
- **1.5 (ops)** — rotate the OAuth tokens that were browser-readable before the subcollection fix

**Scale — do soon:**
- **4.2** — 4 unbounded queries in `modules/admin.js`: line 157 (collectionGroup platformConnections), 368 (collection users), 371 (collectionGroup publishJobs), 489 (collection users). Lines 368+371 are same handler — one admin page load reads entire user table + every publish job ever.
- **4.3** — N+1 per-user reads in scheduled jobs; no `getAll` anywhere

**Process:**
- **1.3 / 5.5** — no CI; `check-release.cjs` resolves PUBLIC to `../artifacts/api-server/public` (doesn't exist); need to repoint to `public/` and add barrel-count check (expect ≥65 exports)
- **5.3** — no dependency scanning / Dependabot
- **5.4** — no SRI on ~40 Firebase CDN script tags
- **5.6** — replit.md had stale references (fixed 2026-08-04)

**Nice-to-have / product:**
- **5.2** — extract inline JS from `BlastyBiz.html` (6,653 lines)
- **5.7** — product decision: nudge users who skipped Story

**Quarter (architectural):**
- **1.2** — staging Firebase project; `blastybiz-9523e` hardcoded 172×
- **1.1** — `organizations`/`memberships`/RBAC (blocks all 11 Section 6 enterprise gaps)

**Section 6 (all blocked on 1.1):**
SSO/SAML, SCIM, RBAC, per-user audit log, data export, data residency,
DPA/subprocessor list, uptime SLA/status page, retention policy, pen test, SOC 2
