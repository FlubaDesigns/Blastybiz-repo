# Ghost handoff — Pass 07

Scope: ten new assessment repairs R04, R06, R07, R08, R16, R17, R18, R19, R25, R26. Deliver BB07.zip for Claude review; do not push or deploy. Pass 06 remains a separate review batch.

Blast radius inspected:
- Profile and CreateBiz step branches, real form validity, setup save paths and their existing tests.
- Quick/per-draft schedules, draft persistence, both recurring worker consumers, existing preview creation, all computeNextRunAt and signature call sites.
- Signed email action handler, saved draft loader, auth guard and login destination handling.
- Google/Facebook/Instagram adapters, normal dispatcher claims/retry state, administrative retry recovery and existing regressions.
- reserveAiAction, draft creation/update/regeneration, dedup records, server grant creation, protected listingDraft rules.
- Every AI module provider-call site, usage/health logging helpers, category native Gemini path and anonymous preview path.
- Function barrel/release consistency and reachability checks. No independent scheduling or allowance architecture added.

Canonical recurrence source is functions/lib/schedule.js. Run node scripts/sync-schedule.cjs to update its generated browser asset; --check verifies identity. Website validation is public/website-utils.js for both form surfaces. Shared logging calls the existing provider/usage functions.

See BlastyBiz-Pass07-Review.md for behavior, tests, remaining groups, rollout compatibility notes and unverified live/rules acceptance. Changes are local and packaged for review only.
