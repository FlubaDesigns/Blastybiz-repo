# Pass 07 — ten new repairs for review

Apply after Pass 06 candidate `4bbf0df9cb84b2ef9e865bbe1c523229b6dc3df6`. This is a delta review package. Pass 06 review corrections remain separate; none have been supplied or counted in this pass.

| Group | Implemented change |
| --- | --- |
| R04 | Profile requires a valid website for online/both businesses; physical businesses answer Yes/No. CreateBiz uses the same URL validator and explicit physical-business Yes/No choice. Invalid schemes/URLs cannot advance. |
| R06 | Daily, weekly, monthly are the available recurrence choices. Legacy biweekly/custom schedules are explicitly disabled by the worker and displayed as paused until the owner chooses and enables a supported frequency. |
| R07 | Browser and server use one canonical calendar/timezone implementation. Monthly day 31 clamps to the month's last day and returns to 31 in later months. Posting hours stay local through daylight-saving changes. |
| R08 | Schedule controls await persistence, retain the prior saved state on failure, and show an error. Unsaved drafts cannot appear scheduled; same-draft writes are guarded while saving. |
| R16 | Email GET requests show a confirmation page and never write. Approve/Skip/Pause require an explicit POST from the confirmation button. |
| R17 | Versioned signatures bind account, business, draft, action, and actual nextRunAt occurrence. Current cycle validation, action consumption, and schedule/business changes commit in one transaction. |
| R18 | Change opens the exact business and draft, preserves that destination through sign-in, checks the intended account, and restores the saved campaign/copy/destinations/schedule. |
| R19 | Ambiguous publication timeouts and server errors enter the existing publicationUncertain manual-recovery state; dispatcher redelivery does not blindly repost. Administrative retries retain this uncertainty too. Explicit provider rejections still follow the existing failure path. |
| R25 | Free regeneration requires a server-created private grant issued after successful paid generation for the draft. The existing reserveAiAction transaction consumes it once. Browser-created/reset public markers cannot manufacture eligibility. Rules protect both public markers and private grants. |
| R26 | Every AI provider call in the AI module awaits the existing usage log with available request business/campaign context. Provider failures, including campaign chat, are logged; anonymous preview/category calls remain anonymous. Existing provider-health failure writes are awaited. |

## Checks

- 57 focused Pass 07 assertions: timezone/DST/month ends, unsupported recurrence, failed schedule writes, scanner-safe GET, signed context, stale/disabled cycles, transaction failure/retry and concurrent action choice, exact draft return, publishing uncertainty, server allowance ownership/consumption, awaited success/failure logs, website branches/validation.
- 161 previous assertions pass: 38 Pass 06, 52 review, 42 setup, 29 photo. Prior fixtures now load the shared URL/logging helpers. These fixture updates are compatibility changes, not new repair groups.
- All 134 executable inline scripts parse. Changed backend/shared files parse. Local release consistency checks pass, including 74 exported functions and reachable source files.
- The release checker now resolves library-to-library require paths, so the actual shared schedule import is recognized. The browser recurrence asset is generated and checked byte-for-byte against functions/lib/schedule.js.
- No deployment, GitHub push, payment, customer deletion, live email, or social post was performed for Pass 07. Live endpoint checks were deliberately not run for this review-only package.

## Review and rollout notes

- Old email signatures intentionally stop working; they lacked the business/current-cycle binding. Their error page directs owners to the dashboard or next preview. Review this visible compatibility change before deploying.
- Legacy drafts have no trustworthy private regeneration grant. They use the normal existing allowance until a successful normal generation creates a server grant. Do not grant free eligibility from browser-owned historical markers. A grant-storage failure is logged and does not discard paid generated copy.
- R19 uses conservative manual reconciliation where provider acceptance is unknown; it does not add a provider lookup service. Existing scheduled direct publishers remain in R09–R13/R10 work; this pass changes the normal job adapters/dispatcher and admin retry path.
- Rules source checks and isolated server tests are not an emulator/live proof of Firestore rules. Run the authenticated rules gate before release. Real phone sign-in, persistence, email delivery, and posting journeys are not claimed verified by this ZIP.
- No payment handling, tier policy, business-creation capacity changes, new scheduler, or second AI allowance system was introduced.
- Remaining original assessment repair groups after Passes 06 and 07: R02, R09–R13, R21–R23, R28–R30 (12 groups). Separate approved V1 work packages are not included in this count.

Deploy only after review, using the Authorization Engine. Affected backend exports: adaptListing, generateEnrichmentQuestions, suggestCategory, previewAds, extractBizContext, resolveCategories, suggestPlatforms, chatCampaign, scoreFact, draftAction, dispatchPublishJob, adminRetryJob, scheduledPostingCheck, scheduledDraftPreview; plus Firestore rules and Hosting. shared.callAI is consumed by the listed AI exports. No secrets or permissions were broadened.
