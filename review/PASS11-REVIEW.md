# BlastyBiz Pass 11 — V1 completion candidate

Corrected September 29, 2026 after review of BB11.zip; see PASS11-CORRECTIONS.md for all five dispositions. Built on the corrected Pass 09/10 source. Production Main at the start of this pass was `2b579471107d278a44e694a68b0ea0f265df25fd`; the matching local text-source baseline is `6675dad`. This is a review candidate, not a deployment or a claim that live acceptance has passed.

## Scope and authority

The remaining packages are V11–V18 from BlastyBiz-Production-Repair-Assessment.md. The original `BlastyBiz(9).zip / bb_v1.docx` governs the implementation, particularly Parts 6A/6B/6D, 8–10, 11B, and 11C. Existing Campaigns, Ads, listingDrafts, publishJobs, AI logs, and Authorization Engine remain the owners of their respective work. The separate Activity display remains deferred under 11C.18; it is not included in these eight packages.

| Package | Candidate implementation |
|---|---|
| V11 | `Ad.schedule` owns the recurring rule. Exact local time and UTC storage, once/weekly/biweekly/monthly/quarterly, anchored month-end and DST handling, stop-after, copy/image/review choices, pause/resume/skip/change-next. Existing scheduled functions invoke the Ad flow, and legacy schedules remain compatible. |
| V12 | Campaign + Ad names on cards, previews, and messages. Overlapping selected destinations within an hour produce a warning after save. |
| V13 | Authenticated owner Mark Posted, Skip This One, Skip Remaining, and failed-job retry. Existing publishJobs are authoritative; manual confirmation is explicitly owner-reported. Terminal counts and delivered counts remain separate. |
| V14 | One ready/12-hour/final reminder sequence per occurrence, current-state recheck at send, ON/OFF, pause suppression, and configurable seven-day lapse after the final reminder. Reminders-off/unsubscribed work uses the equivalent final-reminder time for eventual closure. |
| V15 | One server-owned `users/{uid}.firstBlastCompletion` milestone with business, Campaign, Ad, and Blast identity. A mixed launch can finish onboarding while manual work remains. Presentation and eventual first-completion celebration are claimed once. |
| V16 | Existing aiUsageLogs extended with Ad, occurrence, purpose, copy behavior, free-to-owner, and tier attribution. Admin monthly business/purpose, tier mean/p90, and reuse/refresh rollups sum stored costs without repricing history. |
| V17 | Refresh uses the existing AI provider/settings, writing-guide overrides, and atomic allowance gate. Refreshed copy is frozen per occurrence and requires review. At the ceiling or on refresh failure, saved approved copy is retained with the fallback reason. |
| V18 | Publish, Schedule, review/edit scope, status, media, business-scoped links, reminders, and first-use completion operate over the same occurrence. Run As-Is and normal reuse do not invoke AI. |

## Important behavior

- Scheduling is an explicit final action. The button says Schedule Blast and no delivery jobs are created by that save.
- First three approved scheduled occurrences require approval. Refreshed wording and requested image changes also require approval. An email opens the authenticated review; fetching a link cannot publish, skip, or pause work.
- Editing a prepared next Blast invalidates its approval. This Run Only edits the packet, while the reusable Ad remains unchanged. The existing Update the Ad path still offers whether to update an already-prepared packet.
- The worker atomically creates deterministic jobs and advances the rule. Concurrent invocations and lost-response retries cannot create the same run twice. Stop counts count dispatched occurrences; delivered-post counts come only from actual provider success or owner confirmation.
- Owner retry uses the existing dispatcher, provider adapters, and transactional claim. Uncertain publication is not blindly retried. No successful destination is reposted.
- Manual reminders and automatic lapse stay disabled until config/lifecycle.remindersStartAt exists. Only approved, incomplete Blasts launched at or after that fixed cutoff are eligible; historical manual work is unchanged. Migration sets the cutoff once at apply time and never moves it.
- Workers skip unprepared Ads more than 48 hours away, historical/completed Blasts, and Blasts without remaining manual work before lifecycle transactions. Paged scans still read matching documents.
- Manual skip/lapse is terminal but never delivered or reached. Failure in another destination does not prevent reminders about the manual work that is ready.
- Legacy schedules remain visible with pause and migration guidance. Saving the corresponding legacy Ad's new rule disables its old recurring rules in the same transaction. Old creative/media/results are retained.
- The retired quick Profile scheduler is hidden. New scheduling is managed through Publish and Schedule, using the Ad rule.
- Admin rollups identify historical rows lacking attribution as unattributed. Tier mean/p90 covers accounts with logged calls, grouped by the tier recorded at call time; zero-call accounts cannot be reconstructed historically from old logs.
- New fallback AI limits are provisional: Trial/Free 100, Pro 1,000, Agency 5,000 actions per calendar month. Explicit existing `config/plans.aiLimits` values win and the configuration migration preserves them. Owner-facing usage meters or token/cost prices are not added.

## Validation

673 assertions pass across 17 suites, including 147 Pass 11 assertions: 69 lifecycle, 44 corrections, 22 schedule DOM, and 12 publishing-status DOM. The actual service code is exercised with an isolated Firestore transaction/query model; the actual browser scripts are exercised with jsdom. Existing Pass 06–10 and earlier review/photo/setup suites pass.

Coverage includes calendar anchors and DST, once and recurring stop counts, concurrent queue claims, failed atomic writes, explicit approval, stale revision rejection, lost-response save identity, per-run copy immutability, manual confirmation/skip/lapse counting, business isolation, reminder timing and send-boundary cancellation, preference suppression, paused schedules, zero-AI reuse, refresh fallback, and durable first-use presentation. Correction checks cover missing/invalid rollout configuration, unchanged historical work, Timestamp approval dates, idempotent/concurrent migration, 500 far-future Ads with zero lifecycle transactions, AI purpose attribution, plan fallbacks and overrides, and safe HTTP errors.

Release parsing/structure checks, generated schedule/platform authority checks, endpoint-reference scanner self-tests, and whitespace checks also pass. `validation.json` and `release-check.txt` contain the outputs.

Limits of this verification: no real customer posts, provider calls, billing operations, or emails were sent. No Firestore emulator or complete signed-in browser acceptance run was performed. jsdom does not prove mobile visual layout. New functions, indexes, rules, and configuration are not yet deployed. These are review/release acceptance items, not hidden claims of live completion.

## Decisions retained from the specification

The first-three approval count remains in force; the optional N-day safety-period limit is still undecided. A stricter free-tier Refire restriction is not silently introduced: the current all-plan feature policy is preserved. AI limits are provisional/configurable. Changed upcoming copy/images require a fresh owner review. Seven-day manual lapse is configurable. V2 calendar, generated imagery, timing optimizer, analytics, reminder timing editor, and manual undo remain excluded.

## Review and release

1. Review the source overlay, `changes.patch` (all Pass 11 changes), `corrections.patch` (since the original BB11 candidate), this report, PASS11-CORRECTIONS.md, and validation outputs. Corrections remain Pass 11 corrections.
2. Overlay changed files onto the full repository based on the recorded Main commit; preserve all upstream binary/static assets. This archive's source tree is the recovered text-source checkout, not a replacement for the complete remote tree.
3. Run the included release and regression checks; merge only the reviewed candidate through the established Main process.
4. Use `FlubaDesigns/fluba-designs/.github/workflows/blastybiz-release.yml` and `deployment/blastybiz-release.json`, after the exact target Main check succeeds. Do not restore a direct Firebase-token deploy route.
5. Deploy indexes and await the new collection-group indexes (`ads.schedule.enabled`, `listingDrafts.status`) as well as existing schedule indexes. Deploy rules before new clients/backend, then the required functions, configuration, and hosting. The Engine's existing index wait helper must include these new group indexes before workers are enabled.
6. Run `node scripts/migrate-pass11.cjs` for a dry-run, then `--apply` under the existing Engine identity. It sets remindersStartAt to apply time only when absent, and adds missing lapse/plan defaults. It never posts or replays work. Before this migration is applied, the new backend fails closed for manual reminders and lapse. Reruns preserve the original cutoff and configured plan limits. Never backdate the cutoff to include historical work.
7. Stamp the exact target SHA, deploy hosting, run the endpoint probe and `verify-live-release.cjs` on both domains.
8. Complete signed-in acceptance on a designated test business: same-Ad Run Again without AI, isolated derived Ad, scheduled mixed auto/manual Blast with explicit approval, retry/skip, manual reminder cancellation, override versus source preservation, and business switching. Check phone layout and first-use completion once. External posting acceptance must use destinations the owner has authorized.

Changed/new function deployment targets: `manageBlast`, `observeBlastResult`, `resumePublishJob`, `adminAiCostRollups`, `scheduledPostingCheck`, `scheduledDraftPreview`, `approveDraft`, `manageAd`; and every existing AI endpoint that uses shared logging/allowance defaults: `generateEnrichmentQuestions`, `suggestCategory`, `previewAds`, `extractBizContext`, `adaptListing`, `resolveCategories`, `suggestPlatforms`, `chatCampaign`, `scoreFact`. Retain the existing release's other required targets. The scheduled functions now also require the existing Resend and AI secret bindings declared in source.
