# Backend ownership and legacy retirement

`functions/index.js` selects the owned modules. `scripts/check-backend-ownership.cjs`
derives their deployable functions, checks page callers, and rejects duplicate
owners or reintroduced retired endpoints. The release gate compares this derived
inventory with Firebase's actual runtime endpoint metadata; it is not a minimum
function-count check.

## September 29, 2026 blast-radius review

The reviewed app baseline was `1ab29cd75771d1e86e435c8d487aa44ef04aa1c3`.
Read-only Engine run 36614243168 found 92 deployed functions. Fifteen belonged to
recovered September 4 source outside current Main. Current source also exported
two unused manual-platform endpoints that could overwrite another platform's job.
The explicit retirement manifest pins all 17 candidates to their observed update
times. The resulting owned inventory contains 75 functions and 41 page-called
endpoints. Absence of a page caller alone does not justify removal: webhooks,
OAuth callbacks, operators and background workers remain supported.

At 18:45 UTC, complete bounded collection scans found zero old advertising,
blastRuns or onboardingDrafts records; zero publish jobs with legacy runId; and
zero enabled legacy draft schedules. Seven days of successful HTTP request logs
contained no requests for the candidates. This is a bounded observation, not a
guarantee that no historical third-party caller exists. One obsolete hourly
canonicalScheduleCheck scheduler remained; the other three retired scheduled
functions had no Scheduler job.

The 42 saved drafts, 35 publishing-history records, accounts, businesses and
connections are preserved. Current draft compatibility and pending-post flows
are retained because current code still references them. Retired advertising
client writes are closed by the rules change; no collection is deleted. The
one-time apply-withauth transformation script had no repository/CI callers and
targeted the obsolete monolithic entry point, so it is removed.

## Release safeguards

The Authorization Engine deploys only the derived current owners and verifies
both Hosting domains. An explicitly requested retirement then reruns the live
inventory, data, scheduler and traffic checks before any deletion. Changed
candidate versions, nonzero old data, incomplete scans, caller traffic, or an
unexpected scheduler target stop retirement. The script deletes only named
function resources and their matching obsolete Scheduler jobs. It never writes
customer data or modifies IAM. Final verification requires exactly the 75
reviewed functions ACTIVE and the retired names/schedules absent.

The recovered legacy source and original source-bundle generations are retained
in BlastyBiz-Legacy-Rollback.zip. Current-source handlers can be recovered from the
baseline Git commit. Recovery is a reviewed Engine release, not a tested instant
rollback. Other audit findings (billing, purge completeness, admin indexes,
retention and backup recovery) remain separate work.
