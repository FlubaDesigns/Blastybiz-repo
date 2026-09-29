# Pass 08 verified review corrections

Review input: `BlastyBiz-Pass08-Review.zip`, received 2026-09-29. These are corrections to Pass 08, not a new repair pass. Pass 08 remains a local review candidate; it has not been pushed or deployed.

Before editing, the actual Dashboard handler, older Onboarding save wrapper and signed Square webhook failed four independent reproduction scenarios. The new correction suite initially reported four failures. It now passes 30 assertions; the preceding 334 assertions also pass (364 total).

| Finding | Verification and correction |
| --- | --- |
| P8-1 / R30 | Confirmed: Dashboard called direct `deleteDoc`, which owners cannot use under the archive rules. It now POSTs to the authenticated `deleteCampaign` endpoint, rejects non-OK/non-JSON failures, and reloads after success. The confirmation explains that scheduled posts stop and history is kept. Tests execute the real Dashboard handler through the real archive endpoint and verify the campaign and draft schedule records. |
| P8-2 / R02 | Confirmed: older Onboarding omitted `bizId`. The proposed ID-only fix was incomplete: default first-time setup also sent `isNew: false`, which the server rejects for a nonexistent business. New sessions now retain one UUID across retries and send creation mode. Ordinary onboarding resumes the existing active/legacy unfinished business when present. No new business schema fields were added. Tests cover first setup, Add New capacity, resumed setup, sign-out, and a response lost after a successful commit. |
| P8-3 / R21 | Confirmed: missing checkout links and shared-customer conflicts threw on every delivery. A missing link remains retryable while the signed event is under 24 hours old; at 24 hours it records `completed`, `unlinked: true`, a reason and reconciliation IDs. A shared customer records `needs_review`, with the checkout account and existing linked account. Both acknowledge only after the ledger transaction commits and log an error. Redelivery of either terminal state performs no further writes. Missing/invalid event timestamps are retained as `needs_review` rather than discarded or retried indefinitely. |

## Payment boundaries

- A database failure still returns 503, including failure to write an unlinked/review receipt. Signature verification is unchanged.
- A shared-customer conflict does not move customer ownership, grant entitlements to either account, mark the checkout fulfilled, or send a paid-welcome email. Manual reconciliation remains necessary; this correction stops endless retries and preserves the evidence, not the underlying ambiguity.
- An old unlinked payment does not receive automated entitlements if its checkout linkage appears later. Its stored order/payment/customer IDs support manual reconciliation.
- Error logging occurs after commit, outside the transaction retry callback. The ledger is the durable record; notification delivery is not claimed.

## Verification and prior corrections

All eight suites pass: review 52, photo 29, setup 42, Pass 06 49, Pass 07 57, Pass 07 corrections 51, Pass 08 54, Pass 08 corrections 30. Backend and both changed pages' seven executable inline scripts parse. Release consistency and shared schedule checks pass; `git diff --check` passes. External endpoint checks are skipped locally. No live posts, emails or payments were generated; no authenticated rules emulator or provider acceptance is claimed.

The corrected ZIP includes the current affected source for Passes 06–08 and the Pass 06/07 correction reports/tests so the earlier fixes can be inspected. They remain attributed to their original passes. `changes.patch` contains only Pass 08 relative to corrected Main Pass 07; `corrections.patch` contains only this review correction relative to the original BB08 candidate.

Corrected Pass 07 is already on Main as `91dc188d09bf8532ea483fa72c7e9807af17f5d1` and deployed through the Authorization Engine. The scheduler permission issue was resolved. Backend, rules, indexes and Hosting succeeded; the workflow's immediate version check saw the old cached marker, then the unchanged verifier passed on both public domains with the correct SHA and reviewed page markers. This is deployment evidence, not an authenticated end-to-end acceptance claim.

## Pass 08 rollout requirements

1. Deploy the new `listingDrafts` collection-group index first and confirm it is READY before deploying the workers that query it. Issuing the index deploy command alone is insufficient.
2. Use the existing Authorization Engine with the reviewed Pass 08 Main SHA and its affected backend targets; deploy backend/rules/Hosting after the index is ready. Pass 08 is not authorized for deployment by this review package alone.
3. Legacy enabled schedules without a saved destination selection pause visibly until the owner selects destinations. Manual destinations produce an Action needed job each cycle.
4. Owner communications require Dave's authorization before sending. Suggested notice: “Please check your scheduled campaigns and select the destinations you want to use. Older schedules without a saved selection will pause until you do. Your campaign history will be kept.” No notices have been sent.

Pass 09 remains R28 (settled plan gates) and R29 (canonical platform facts/labels), only. Recurring plan enforcement is still the R28 work item. None of these review corrections count as a new pass or complete the assessment's separate V1 packages.
