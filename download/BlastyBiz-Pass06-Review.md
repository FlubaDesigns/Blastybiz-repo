# BlastyBiz Pass 6 — ten document-backed repairs

Baseline: FlubaDesigns/Blastybiz-repo Main `837cb1484ac6d4cb869b015c0252534d6f77af32`.
Recovered unfinished Pass 6 work, corrected it, and exercised the actual changed functions with isolated services. Corrections to this pass are not another numbered pass.

| Assessment group | Delivered behavior |
| --- | --- |
| R01 | Profile saves business and account pointer in one batch. Profile/Story stay on the page on write failure, retain answers, and expose Retry save. |
| R03 | Business contact email remains on the business; Profile no longer replaces the account email. |
| R05 | Pending-post Dismiss uses the authenticated existing backend and visibly reports failure. |
| R14 | Approval and deterministic per-platform jobs commit together in a transaction; repeated/concurrent approvals cannot create duplicate jobs. |
| R15 | Approved pending-post image URLs are retained in the publish-job payload. |
| R20 | Publishing Status recognizes processing and manual_followup, including follow-up action cards. |
| R24 | Campaign chat reserves the existing server allowance before calling AI; exhausted/unavailable allowance blocks the call and explains the failure. |
| R27 | Owner account usage meters and credit/free-retry labels are removed from both account surfaces and regeneration controls. |
| R31 | Business deletion repairs activeBusiness and businessIds server-side, keeps the last business, and supports cleanup retries. |
| R32 | Quick/chat campaign creation selects and announces a campaign only after saving. Generated-draft failures retain the generated copy and retry identity, block approval/navigation, and allow retry without another AI call. |

## Validation

- 38 Pass 6 assertions execute actual handlers/UI functions with isolated Firestore, DOM, and AI doubles.
- 123 earlier regression assertions pass (52 review, 29 photo, 42 setup).
- All 134 executable inline scripts parse; changed backend modules parse; git diff whitespace check passes.
- Local release consistency checks pass, including loading all 74 exported functions. Initial preflight reached 36 of 37 endpoints; adaptListing timed out and was retried separately. The exact-source release gate must pass before deployment.
- No real customer content was posted, no payment was made, and no customer business was deleted by these tests.

## Review boundaries

This is Pass 6, not completion of the whole V1 specification. Remaining repair groups: R02, R04, R06–R13, R16–R19, R21–R23, R25–R26, R28–R30: 22 groups. The additional V1 implementation packages remain separately scoped by the production assessment.

R26 is not counted complete merely because campaign-chat success logging is now awaited. R08 schedule-save feedback is not included. Existing starter-plan posting gates remain pending R28. No second scheduler, platform registry, or AI allowance system was introduced.

Deployment uses the existing Fluba Authorization Engine. The changed backend targets are approvePendingPost, chatCampaign, and deleteBusiness, alongside Hosting. Production deployment/source verification is separate from authenticated user-journey validation. Failed-save/concurrency tests here are isolated tests, not claims of live customer-account verification.

## ZIP contents

Changed source files, the Pass 6 regression script, release-verification updates, this review, a baseline-to-candidate patch, and source hashes. Apply against the baseline or review the exact source commit recorded in RELEASE.json. Do not count Claude review corrections as a new pass.
