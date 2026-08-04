---
name: BlastyBiz enterprise audit tracking
description: Current completion status of the bb_ent_01 audit findings (47 total). Corrected 2026-08-04 after discovering many items were already done in prior sessions.
---

## Score: 29/47 complete (~62%)

### Done (29)
1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9,
2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9,
3.2, 3.3, 3.4, 3.5, 3.6,
4.1, 4.2, 4.3, 4.5, 4.6, 4.7,
5.5, 5.6

### Partial (1)
- 3.1 — CI check blocks future regressions; original 9 sites need manual spot-check

### Remaining (17 findings + 11 Section 6 gaps)

**Month 2 (architectural, well-defined):**
- 2.10 — Invert Firestore rules denylist → allowlist (`affectedKeys().hasOnly([...])`)
- 4.4 — `config/plans` Firestore doc as single source of truth for entitlements
- 4.8 — Error tracking (Sentry / GCP Error Reporting) + structured logging
- 4.9 — Enable PITR, scheduled GCS export, one tested restore
- 1.2 — Staging Firebase project + extract 173 hardcoded `blastybiz-9523e` occurrences
- 5.1 — Split `functions/index.js` (4,757 lines) into modules

**Nice-to-have:**
- 5.2 — Extract inline scripts from `BlastyBiz.html` (6,653 lines) to `public/js/`
- 5.3 — Dependabot + `npm audit` in CI
- 5.4 — SRI `integrity` attributes on ~40 Firebase CDN `<script>` tags

**Product decision (not a code task):**
- 5.7 — Should BlastyBiz nudge users who skipped Story to fill it in later?

**Quarter:**
- 1.1 — `organizations`/`memberships`/RBAC (blocks all 11 Section 6 enterprise gaps)

**Section 6 (all blocked on 1.1):**
SSO/SAML, SCIM, RBAC, per-user audit log, data export, data residency,
DPA/subprocessor list, uptime SLA/status page, retention policy, pen test, SOC 2

**Why:** Audit was written before fixes began. Many items (1.4–1.9, 2.5–2.6, 3.3–3.4, 4.1, etc.)
were already in the code when checked 2026-08-04 — they were done in earlier sessions
not captured in prior memory entries.
