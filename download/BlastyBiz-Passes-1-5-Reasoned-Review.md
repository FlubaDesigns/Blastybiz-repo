# BlastyBiz passes 1–5: reasoned review

Reviewed September 28, 2026 (David's timezone). Starting source: Main e76c4df. This is a re-review and correction of existing work, not a new numbered pass.

## Conclusion

The original fixes generally address real defects. They do not establish that all five passes, or the complete V1 specification, are finished end to end. Syntax repair, honest empty/error displays, shared validation and transactional publishing claims are necessary. Several interactions still needed correction, including mistakes in the preceding reconciliation.

Every numbered fix below was checked against the current cumulative code and its producers, consumers, callbacks or persistence rules. All five supplied review responses were reread. Original Profile, Story and Media requirements were compared with the implementation; historical migration assumptions were checked against the actual existing campaign records.

## Findings corrected in this review

1. **A completed job could be reopened by an uncertainty flag.** Recovery accepted any status with `publicationUncertain`, even `manual_completed`. A focused test reproduced an actual provider call from that state. Recovery now requires a stale processing claim or an uncertain manual state; manual completion clears the flag. Completed/closed states cannot use that escape hatch.
2. **Normal dispatch still duplicated a provider-accepted post after a database error.** The preceding correction protected admin retry only. The ordinary dispatcher put the job back into pending and threw, allowing event redelivery to republish. It now records manual-required/uncertain after the provider has returned, and never schedules another automatic attempt for that outcome. If the fallback write also fails, the processing claim remains for operator recovery. This does not solve ambiguous provider timeouts or implement provider-level idempotency.
3. **Dispatch used an old event payload after checking a newer document.** The transaction now returns the current document and that is what the publisher consumes. A fixture with different event/current copy verifies the current copy is sent.
4. **Pause could undo a live processing claim.** An old pending row could write paused after dispatch had claimed processing; Resume could then publish concurrently. Queue pause/close/completion now validate the current state inside a transaction. The stale-processing completion option cannot overwrite a newer active claim.
5. **Manual follow-up undermined both visibility and concurrency.** The endpoint writes `manual_followup`, but Failed Jobs excluded it and Queue Manager treated it as pending. Both views now recognize it as manual attention. The endpoint also refuses to replace a currently publishing or completed state, using the same transaction pattern. Otherwise bulk follow-up could erase the claim that prevents duplicate publication.
6. **Mixed photo storage hid older photos.** The loader used subcollection records OR the old embedded array, so the first newer upload hid every legacy photo. It now combines both sources and deduplicates by URL, preferring current records. No migration or second repository was created.
7. **Guided Back skipped newly typed answers.** The skip predicate treated any valid answer as restored data. Only fields known at initialization are now skipped; answers entered during this session remain reachable with Back. The test failed before correction and passes now.
8. **Saved-photo deletion contradicted the original history requirement.** The Media handoff section 8 explicitly forbids repository retirement from destroying assets needed by historical Blasts. Existing publishing payloads retain Storage URLs. Unconditional file deletion could break those references. Removing a saved photo now deletes its library representations and clears its matching featured field while retaining the stored bytes. Failed, unsaved uploads still receive best-effort file cleanup. **Tradeoff:** saved-file storage is retained until safe reference accounting/garbage collection exists. This is deliberate preservation, not a claim that all orphan cleanup is implemented.

## All 50 fixes: decision and reason

“Keep” means the scoped change is justified by source/behavior, not that the whole page is certified. “Extended” identifies an interaction corrected in this review. Rule/index conclusions are source-level; deployment and live enforcement remain blocked/unverified.

| Fix | Decision | Reason and remaining boundary |
| --- | --- | --- |
| 01 | Keep | Removing the orphan brace makes Failed Jobs executable; it does not repair every button on the page. |
| 02 | Keep | Logs had the same real parse failure. Shared escaping remains the sole helper. |
| 03 | Keep | Subscriptions had a real parse failure. Billing correctness needs separate reasoning below. |
| 04 | Keep | Users had a real parse failure; authenticating and reading actual records are separate requirements. |
| 05 | Keep | Module-level return was illegal. An if/else preserves redirect versus rendering without inventing another business manager. |
| 06 | Keep | Empty picker MIME is not evidence that bytes are not an image; existing byte checks/decoder still decide. Physical S21 support is not proven. |
| 07 | Keep | A Storage upload alone is not a saved library record. Saved state correctly waits for the record ID. |
| 08 | Keep | Empty failed-job snapshots must clear mobile cards and action data as well as the desktop table. |
| 09 | Keep | Sample activity cannot stand in for real data. Current renderer now uses actual writer fields too. |
| 10 | Keep | An AI-usage read error means unavailable, not zero spend. Successful empty data can still total zero. |
| 11 | Keep | Desktop/mobile checkboxes represent the same jobs; deduplication prevents duplicated requests from Select All. It is not backend exactly-once delivery. |
| 12 | Keep | No dispatcher consumes status-only retry_pending changes. Calling the existing retry endpoint actually runs the retry. |
| 13 | Keep | The provider's manualFallback result is not successful publication. Both callers must preserve that distinction. |
| 14 | Keep | Existing loaded-array identity correctly rejects an obsolete name-lookup render, without another sequence system. |
| 15 | Keep | Log display must consume note/action/businessId/draftId written by the real producer. |
| 16 | Keep | createdAt is the current writer's timestamp. UID plus createdAt index matches the optional filtered query. Old timestamp-only records are not migrated. |
| 17 | Keep | One renderer filters the latest 50 loaded records. It does not promise archive-wide search. |
| 18 | Keep | Zero active must not be replaced with total businesses. Unknown subscription states must stay unknown. |
| 19 | Keep | Queue maps must be replaced on each snapshot so disappeared jobs cannot be operated on from stale memory. |
| 20 | Keep | Email business identity must come from the trigger path, not the owner's first business or untrusted job fields. No test email sent. |
| 21 | Keep | A failed business read invalidates business totals, rows and export cache. Independent AI usage can still update. |
| 22 | Keep | Invented revenue/accounts on a loading page are misleading even if a successful snapshot later replaces them. |
| 23 | Keep | Failed Jobs needs visible read errors and stale-result invalidation. Current shared state identity covers both. |
| 24 | Keep with scope | Counts describe loaded job states. Legacy retry status is the truthful label because no current dispatcher queues that old status. |
| 25 | Corrected policy | Record-first removal is right; unconditional deletion of persisted bytes was wrong against the history requirement. See finding 8. |
| 26 | Keep | Failed database removal must leave the tile actionable; busy state prevents repeated removal. |
| 27 | Keep | Generic binary MIME still needs actual image decoding. HEIC brand detection fills the missing-format case; no device success claim. |
| 28 | Keep | Global-library upload does not logically need a campaign. Campaign upload still does. Broader plan-entitlement redesign is outside this repair. |
| 29 | Extended | One scope loader and stale-read ownership are correct; mixed legacy/current photos must also coexist. See finding 6. |
| 30 | Keep | Index-based selection cannot carry into another grid. Restoring the existing featured URL is appropriate for the current one-feature-per-business model. |
| 31 | Keep | listingName and platform exist in current logs and should be displayed and searchable. |
| 32 | Keep | A changed filter should render immediately, especially on a phone. No extra query is needed. |
| 33 | Keep | Queue read failure must replace stale data; Completed in this list is accurate for a query without a today constraint. |
| 34 | Extended | allSettled accurately reports every bulk result. The resulting manual_followup state also has to remain visible and respect active claims. See finding 5. |
| 35 | Keep with limits | Missing trial/past-due coverage cannot imply zero. Incomplete means explicit false. Revenue is a labeled monthly-rate estimate of loaded active owners, not audited Square revenue. |
| 36 | Keep; deployment required | The admin collection-group read rule uses the existing predicate and adds no new write permission. Live enforcement was not tested. |
| 37 | Keep; deployment required | businessName ascending group index matches both admin queries and preserves default collection index modes. It does not include name-only legacy businesses. |
| 38 | Keep; deployment required | Delete requests have no upload resource metadata; separating owner-only delete from size/type-constrained upload is appropriate. It remains useful for failed-upload/account cleanup. |
| 39 | Extended | Transactional publishing claims are necessary but insufficient if other actions erase them or success-write failures auto-retry. Findings 1–5 close these demonstrated gaps. |
| 40 | Keep; deployment required | Queue's unfiltered updatedAt group query needs its declared single-field group index, distinct from filtered composite indexes. |
| 41 | Keep | Editing established business knowledge should preserve its existing campaign. Creating a first campaign remains separate initial-setup behavior. |
| 42 | Keep | The account's active-business pointer belongs in the same atomic creation batch as the business/campaign. |
| 43 | Keep | Canonical businessName/aiContext must win over stale duplicate Story fields, including explicit empty canonical values. |
| 44 | Keep within scope | Two location options match the Profile document. Website Yes/No and Online-required branching remain missing; this fix alone is not Profile completion. |
| 45 | Keep with prior correction | Direct and Guided use the same actual input validity; website normalization prevents rejecting ordinary bare domains. |
| 46 | Keep | Required initial Story and explicit Nothing yet/Nothing else follow the original Story specification. Existing profiles are not forced through first-time onboarding. |
| 47 | Extended | Waiting for saved data avoids overwrites; visible load failure is necessary. Only initially restored answers should be skipped, not newly typed ones. See finding 7. |
| 48 | Keep | Removing the second section-locking guide keeps Direct accessible while retaining the canonical form and GuidedSetup. Real screen-reader behavior remains untested. |
| 49 | Keep | Saving setup is not going live. Confetti before a successful Blast contradicts the Story requirement. |
| 50 | Keep with limits | One in-flight flag and stable new IDs prevent repeated page-session creates. This is not cross-device idempotency. |

## Suggestions not followed blindly

- No duplicate log collection, second image library, parallel guide or migration was added.
- The old handoff's claim that campaigns do not exist is stale for this checkout; creating another campaign system would be wrong.
- No force-retry bypass was added. A transaction sharing the dispatcher's processing state is stronger than checking status once before publishing.
- Existing featured-photo storage remains per business. A complete per-Ad image model is separate work, not silently mixed into these fixes.
- Physical deletion of every removed saved photo was rejected because it conflicts with preserving historical references.
- Real recorded zero and unavailable coverage remain distinct. The revenue display is an estimate, not a financial ledger.

## Verification and honest limits

123 focused assertions pass: 52 review/admin/publishing assertions, 29 photo assertions and 42 setup assertions. These execute current source with substituted DOM/Firebase/provider dependencies. Three new regression assertions were run against the preceding source and failed before the fixes: terminal-state recovery, mixed photo storage and Guided Back. Expanded checks exercise dispatcher event redelivery after accepted-post/write failure, total write outage, current-payload selection, pause/follow-up races, manual-state rendering, actual log writer shapes, read-error recovery, record/cache deletion behavior and preservation of saved files.

All 134 executable inline scripts parse. Backend JavaScript parses. The existing static release checks pass. Endpoint checks succeeded in the preceding reconciliation; this local review does not relabel those as validation of new backend behavior. GitHub's full release checks run on the new Main commit. No real social posts, email sends, payments or customer writes were used as tests.

**Known remaining limits:** Firebase deployment credential is missing; changes are not live until deployment succeeds. Firestore/Storage rules and index builds remain unverified live. Provider timeouts can be ambiguous, and manually confirmed stale recovery is not provider-level exactly-once delivery. Saved media bytes are intentionally retained. Phone HEIC decoding and real browser/accessibility flows remain unverified. Older name-only business records are outside the named-business query. The wider website branching, pre-email progress, Ad/occurrence/history model and plan-entitlement migration remain unfinished.

Existing unrelated controls also need later work: Queue search/receipt/instructions controls are not fully wired; Notify currently records a flag rather than sending a customer message; recovery-email request/response fields still differ from the backend. These are reported gaps, not silently counted as completed fixes or expanded into this review.
