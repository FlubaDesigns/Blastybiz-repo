# BlastyBiz Pass 09 — review candidate

## Scope and baseline

Pass 09 contains the final **two** groups in the existing production repair assessment: **R28 (settled plan gates)** and **R29 (shared platform facts)**. It is based on corrected Pass 08 plus its release-check ordering correction, local baseline `d60b0b5`. The equivalent reviewed Pass 08 Main commit is `1a4398971c1f04b308b6ea8714e7f6f2e2acc51c`.

This is a candidate for review, not a Pass 09 production deployment. This closes the scope of the 32-group repair assessment; it does not claim that the separate remaining V1 packages are complete.

## R28 — shared features, capacity-based plans

- New approved automatic-publishing jobs work on Trial, Starter, Pro and Agency. Google, Facebook and Instagram use the existing publishers; unsupported/unknown destinations remain manual. A supplied `type: api` cannot invent a Bing publisher. Missing/legacy types on pending posts remain manual.
- Copy Library save/open/archive, business documents, history, photos and existing-business navigation no longer have paid feature restrictions. Existing businesses stay accessible following a downgrade. Server-enforced business creation capacity and AI reservation limits remain unchanged.
- The plan screen, preview screen, platform selector, public plan pages, onboarding copy and default email copy stop selling shared features as paid-only. The plan comparison now displays one delivery column for every plan.
- The existing free-tier recurring Refire restriction is deliberately retained. Master specification section 11C16 leaves that policy unresolved; this pass does not choose a new policy.
- Historical jobs already marked `planGated` are not automatically replayed or posted. They remain manual/held records. A new, explicit owner-approved draft uses the corrected policy.

## R29 — one maintained source of platform facts

- `functions/lib/platforms.js` owns the 15 platform records, delivery modes, names/icons, existing writing guidance and manual instructions. `public/platforms-authority.js` is its byte-for-byte generated browser copy. `scripts/sync-platforms.cjs --check` is required in CI.
- The only delivery modes are `auto` and `manual`. Owner labels are **Blasty Posts It** and **Ready for You to Post**. The compatibility fields used by existing jobs are derived as `full_auto` or `manual_assisted`; no current platform uses `partial_auto`.
- Shared backend exports, the existing scheduler, browser display configuration, main app registry/rules, preview metadata and the landing-page generator derive delivery facts from that source. Provider adapter dispatch remains explicit implementation code.
- Admin settings can customize names, icons, ordering and visibility. They cannot advertise an unimplemented publisher or reinstate a paid feature gate. Cached client platform types are normalized.
- `suggestPlatforms` derives its existing prompt from the same platform documents and admin writing-guide overrides as adaptation. This removes the separate hardcoded provider/suitability rulebook, including the false Bing auto-post claim. Pinterest is included. This does not introduce V2 suitability scoring or a new recommendation system.

## Existing configuration migration

`scripts/migrate-platform-config.cjs` prepares a transaction-safe migration of known records in `config/platforms`:

- Normalize the known delivery fields, including Facebook/Instagram `partial_auto` → `full_auto`.
- Set known platform `proOnly` fields false and add canonical `deliveryMode`.
- Preserve display text, icons, enabled state, ordering, unknown platforms and unrelated data.
- Dry-run by default; idempotent and atomic when applied.

Run from the repository root with the established Authorization Engine identity after this candidate is reviewed and authorized for release:

```sh
node scripts/migrate-platform-config.cjs --project=blastybiz-9523e
node scripts/migrate-platform-config.cjs --project=blastybiz-9523e --apply
```

The migration has **not** been run against production. Runtime normalization already handles legacy display values. Custom email templates and custom onboarding messages are preserved; their owner-written text may need editorial review separately.

## Validation

- **410 passing assertions** across nine regression suites, including **46 new Pass 09 behavior assertions**.
- Pass 09 exercises actual approval handlers for all four plans; unknown/forged platform types; duplicate approval; atomic/dry-run/idempotent migration; actual AI suggestion prompt construction with admin guidance; preview behavior; plan-overlay transitions; and an actual Starter Copy Library save.
- The existing Pass 06 and Pass 08 fixtures now import the canonical capability map, rather than supplying their own incomplete/legacy maps. All prior assertions remain.
- Release consistency checks, browser/server source sync and schedule source sync pass.
- 31 changed HTML pages (73 inline scripts) and backend modules pass syntax checks. ZIP includes a validation transcript.
- Tests use isolated database/provider/DOM fixtures. No paid checkout, live social post, custom-template rewrite or authenticated browser acceptance test was performed for this candidate.

## Deployment review notes

A later Pass 09 release must use the Authorization Engine, deploy the reviewed backend before Hosting and verify both domain release markers. Because the shared platform module changed, include all Functions that consume its changed facts: at minimum `approveDraft`, `approvePendingPost`, `scheduledPostingCheck`, `adaptListing`, `suggestPlatforms`, `getPlanOptions`, plus the changed default-copy consumers `businessCreatedTrigger`, `scheduledUpgradeNudge` and `adminSendOnboardingNudge`. These names were checked against the source exports; do not infer deployment from a Git push.

Review only this pass's delta against the corrected Pass 08 baseline. Verify suspected findings against the code and tests before calling them corrections. Corrections to this candidate remain part of Pass 09.
