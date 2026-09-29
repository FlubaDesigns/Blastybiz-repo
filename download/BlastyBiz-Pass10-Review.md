# BlastyBiz Pass 10 — review candidate

Candidate implementing assessment packages V01–V10 on the reviewed BB09 source candidate. Not pushed to Main or deployed. Review this ZIP before promoting it. Verified review corrections belong to Pass 10.

## Source and authority

- Source: BB09 candidate c64d87e94dd59efbc3edd7436d6669b64b19c048, not the live Main tree.
- Previously verified Main: 1a4398971c1f04b308b6ea8714e7f6f2e2acc51c (corrected Pass 08 plus workflow change).
- Requirements: BlastyBiz(9).zip, consolidated bb_v1 master Parts 0–11, including 6A/6B/6D/11B/11C overrides, and the V1 assessment packages V01–V18.
- This ZIP is a text-source review bundle. Binary assets, installed dependencies, credentials and previous bundles are omitted as in BB09. Apply changes to the actual repository; do not replace the deployed repository with this source subset.

## Changes to review

| Package | Candidate behavior |
| --- | --- |
| V01 | Shared five pre-email fields and validation; persisted setup handoff; canonical CreateBiz form for guided/direct setup and later edits. Former Profile/Story/Onboarding routes preserve query parameters and lead to that form. First Campaign and first Ad are created atomically for initial setup. |
| V02 | Shared Blasty runtime, event/field registry, admin editor, configurable message/behavior/animation and persisted ONCE state. Registry includes 72 reconciled events, four image events, one recovery event and 27 fields. Existing setup/login/campaign guidance moved into shared modules; current Ad, setup, connection and publish entry points emit events. |
| V03 | Sixteen independently callable gestures; hand/eye actions do not switch the full-body mood. Reduced-motion/static gates apply. Cone spin includes B travel. Returning owners skip acknowledged ONCE events. |
| V04 | Ads under the existing Campaign; authenticated transaction service; dry-run legacy preview, stable source digest and idempotent lazy materialization. Existing draft/history records remain intact. Ad list includes date, platforms, status and prepared Blast count. |
| V05 | Ad owns name, offer, price, CTA, context, mentions, platform selections, copy and approvals. Campaign persistence strips these creative fields. Initial creation routes seed a first Ad. |
| V06 | Business image references can enter Campaign repository; tap and drag select images for an Ad; selection removal is scoped; retirement preserves stored bytes and historical snapshots. |
| V07 | Server-owned prepared packet freezes copy, images/metadata, platform choices and Ad/Campaign attribution. Existing publisher and scheduled queue consume packets and retain job attribution. Client rules reject packet rewrites. |
| V08 | Run Again / Run As-Is prepares a new Blast under the same Ad, forces reuse, and makes no AI call. Stable request identity prevents duplicate retries. |
| V09 | Use As Starting Point creates a new Ad with sourceAdId, copies creative, requires review, and leaves source creative/history unchanged. |
| V10 | This Run Only freezes an override without changing the Ad. Update the Ad increments revision and appends changed-field events. Prepared Blasts remain unchanged unless Update It Too is explicitly chosen. Sent packets cannot be changed. |

## Verification

480 behavior assertions across eleven suites, including 51 new service assertions and 25 DOM integration assertions. All suites pass. Release validation, platform/schedule source synchronization, endpoint-checker self-test, JavaScript syntax checks and git diff whitespace checks pass. See VALIDATION.txt and validation.json for command outputs.

Backend tests run actual handler/service code against isolated Firestore fixtures. DOM tests run the actual Ad workspace and mascot code against jsdom with the actual Ad service and mocked network/storage. They cover create/select/save, lost-response retry, derive/source preservation, scoped image removal, scope controls, all sixteen gesture targets and reduced-motion behavior.

Existing regression fixtures were updated for the shared form and retired redirects. The earlier Profile/Onboarding implementation tests no longer apply; canonical setup tests retain validation and save coverage. Tests are not production acceptance.

## Acceptance limits and follow-up

- No authenticated production test, Firebase emulator rule test, provider publishing, payment operation or live data migration was performed. No browser visual/mobile acceptance was possible because Chromium installation failed; jsdom does not validate layout or SVG appearance. Phone/browser visual review remains required.
- The central registry includes future V11–V18 schedule/activity guidance. Those product paths are not claimed implemented by registering their IDs. Legacy login admin configuration remains a compatibility fallback; canonical five-field overrides take precedence.
- Existing historical drafts without packets retain their legacy publishing path. This change freezes newly prepared Ad Blasts and packet-backed scheduled runs; it does not rewrite old history.
- Already-sent packets are immutable. Updating an unsent packet still requires explicit Send; unresolved master approval-policy decisions are not silently resolved here.
- Existing free-tier recurring restrictions remain unchanged. V11–V18 schedule, activity and remaining packages are for the next pass.
- Review against the real repository before Main promotion, particularly the pre-email verification round trip, existing-business edits, tap/drag image selection, legacy image rendering, per-platform approvals, scheduled receipt history and Firestore/Storage rules.

## Reproduce

Use Node 22 and run `npm ci` in functions. Run the commands in VALIDATION.txt from source root. For DOM tests, install jsdom@26.1.0 in a temporary directory and set JSDOM_PATH to its node_modules/jsdom path. The GitHub workflow includes that isolated install and test. No production writes are needed for the tests.
