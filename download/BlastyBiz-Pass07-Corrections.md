# Pass 07 review: verified findings and corrections

Each proposed finding was checked against the implementation and reproduced with production functions running against isolated services before editing production code. These are corrections to Pass 07, not another numbered pass. The five previously confirmed Pass 06 corrections are included in the working source and remain covered by their tests.

| Finding | Determination and evidence | Correction |
| --- | --- | --- |
| P7-1 | Confirmed. Executing runAdaptation for a new draft reported `generationDraftId is not defined`; no request reached adaptListing. | Move preparation of the draft ID into runAdaptation immediately before its request. Remove the unused allocation from regeneration. Verify the request and saved draft use the same ID, including a repeat generation. |
| P7-2 | Confirmed for posting, with a different preview symptom. An invalid timeSlot before a valid due draft caused zero posts. The preview worker sent both previews, including the invalid draft, because it did not validate recurrence. | Isolate every draft in both workers. Use the canonical recurrence function for validation. Pause invalid schedules with a reason; continue even if recording that pause fails. Errors after successful recurrence validation are logged without disabling a valid schedule. |
| P7-3 | Confirmed. A simulated ENOTFOUND error was marked as potentially published. | Keep ENOTFOUND, ECONNREFUSED and EAI_AGAIN on the ordinary failure path. Preserve publication uncertainty for the requested timeout/reset/broken-pipe codes, HTTP 408 and HTTP 5xx. |
| P7-4 | Confirmed against the existing setup behavior. An established online business with an active campaign and empty stored website could not save an unrelated edit. | Allow an empty website for that established business. New/incomplete setup and businesses with a stored website still require it. The guide still asks the website question. |
| P7-5 | Confirmed. The validator rejected example.com:8080 because the normalizer treated the hostname as a scheme. | Recognize an explicit scheme with :// and add https:// to bare hostnames with ports. Keep rejection of unsupported schemes and embedded credentials. |

## Verification

- Before production edits, the new correction scenarios failed against the original code. The preview test specifically demonstrated two emails instead of only the valid draft's email.
- After edits: 51 correction assertions, 57 original Pass 07 assertions, 49 corrected Pass 06 assertions, 52 prior review assertions, 29 photo assertions and 42 setup assertions pass: **280 total**.
- Invalid timezone, weekday and month-day schedules are covered in both workers, as is failure to persist the invalid schedule's pause.
- Local release consistency, shared schedule asset synchronization, changed JavaScript syntax and whitespace checks pass. Local live-endpoint probing was skipped.
- The correction suite runs in the existing release-check workflow.

These checks use isolated DOM, database, network and provider doubles. They are not live publishing, a signed-in browser acceptance run, or an authenticated Firestore rules emulator run. No live posts, emails or customer records were created by these tests.

## Release scope

Corrected Pass 06 is on main at c5bf8be390fb3a096809391a33cdfb52f949d59c. Its GitHub checks passed, but its deployment failed at the missing FIREBASE_TOKEN credential step. This corrected Pass 07 package is prepared for review and has not been pushed or deployed. The existing workflow's backend target list remains the Pass 06 list; Pass 07 rollout must use the complete affected-target list and the authenticated rules verification described in its original review notes.

The reviewer listed Pass 06 issues as open because the original BB07.zip predated their corrections. That is no longer true in this combined source. Other earlier-pass findings that were merely absent from the review delta are not newly claimed fixed here.
