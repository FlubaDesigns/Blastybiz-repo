# BlastyBiz Pass 11 corrections — BB11R

September 29, 2026. All five findings in BlastyBiz-Pass11-Fixes-Needed.md were confirmed against the original BB11 candidate and corrected in the same Pass 11. Original candidate: `57d4ee43f3649b605795833e361b4e75dd7b0270`. No Main push or deployment was performed.

| Finding | Correction | Evidence |
|---|---|---|
| P11-1 — historical reminders/lapse | Migration sets config/lifecycle.remindersStartAt once at apply time. Missing/invalid configuration disables manual reminders and lapse. Worker, notify entry, transaction, and send boundary enforce eligibility. startedAt takes precedence, with approvedAt as fallback; missing or old launch dates and completed Blasts are excluded. | Historical jobs unchanged, no emails, no lifecycle transactions; Timestamp approval supported; new eligible ready email sent once; dry-run and concurrent/repeated migration checks. |
| P11-2 — unnecessary worker transactions | Skip unprepared Ads more than 48 hours away; skip historical/completed Blasts from the loaded document, then skip those without remaining manual jobs before reconcile/notify transactions. | 500 future Ads exercise both worker modes with zero lifecycle transactions. Due and prepared Ads still process. Completed/no-manual-work fixtures skip. |
| P11-3 — AI purpose labels | Explicit story_extract, campaign_chat, ad_preview and fact_score mappings for the four identified operations; unknown operations use other. Context overrides still win. | Actual logging function tested for all mappings, owner_regeneration override, failure attribution and stored cost; actual rollup keeps separate categories. |
| P11-4 — plan fallbacks | Free/Pro/Agency fallback allowances now 100/1000/5000. | Actual plan-card renderer checked with absent limits and explicit overrides, including zero. |
| P11-5 — raw errors | Typed errors retain their status/message. Unexpected errors are logged server-side and return HTTP 500 with “That could not be saved. Try again.” | Actual HTTP handler tested for both paths and server-side logging. |

## Authority and scope

These changes use the existing lifecycle config, worker, records, AI log and plan renderer. No parallel store or product feature was introduced. The original specification's six purpose categories remain supported; P11-3 adds diagnostic labels for existing calls as explicitly requested in the review. Historical log rows and recorded costs are not rewritten or repriced.

The cursor scans still read matching documents in bounded pages. This correction removes unnecessary lifecycle transactions; it does not claim to eliminate all scan costs. The legacy scan cadence is unchanged from BB11.

## Validation

673 assertions pass across 17 suites (44 new correction assertions), plus release checks, generated-authority synchronization checks, endpoint scanner self-tests and git whitespace checks. CI now includes the correction suite. See validation.json and release-check.txt for captured output.

Services are isolated using the existing Firestore model; browser scripts use jsdom where applicable. No real customer emails, provider posts, billing actions or production writes occurred. Firestore emulator, signed-in browser acceptance and phone visual checks remain release acceptance work.

## Release

Use the existing Authorization Engine after review. Deploy and await indexes, then rules/backend, migration dry-run and apply, then hosting and live verification. The new backend is safe if it starts before migration because manual reminders/lapse remain off without the cutoff. Never backdate or reset that cutoff to catch up old work.

The ZIP contains the recovered text-source tree, not every remote asset. Apply the recorded changed-file overlay to the full repository and preserve untouched assets. Main remains at the previously recorded corrected Pass 09/10 release; BB11R is a review candidate.
