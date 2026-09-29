# Remaining backend audit repairs — September 29, 2026

Baseline: b58dee625e3939cb5740b69d3e9e4c52e892bf76. B05/B06 were addressed by
the previous verified legacy retirement. This batch addresses B01–B04 and
B07–B12, plus the audited duplicate-checkout and AI-provider-switch gaps.

## Blast radius and acceptance criteria

- Account deletion has one canonical retryable implementation. Cancellation
  confirmation precedes Storage and recursive Firestore cleanup; Auth and the
  subscription link are removed only after cleanup. A server-only journal keeps
  cancellation evidence, prefixes, errors and a lease through failure/retry.
  Accounting ledgers remain; owned copy, deep private records and import/OAuth
  work are cleaned. No production account is purged for release acceptance.
- Activity and retention deletion serialize against current user state. A
  deletion journal prevents client writes and new authenticated activity after
  claiming deletion. Retention remains in its existing report mode.
- Direct business-parent deletion is denied; the existing server workflow owns
  pointer repair and recursive deletion. Server-side admin deletion stays intact.
- Failed/incomplete Square catalog responses preserve the full previous price
  and plan-ID set. Existing subscriptions cannot start another checkout. No live
  purchase, cancellation or price change is performed for release acceptance.
- Collection-group indexes cover the supported admin filter combinations, plus
  ordered business/job lists and the pending setup-email query. Live read-only
  query probes must succeed after indexes are ready.
- Manual imports create distinct durable jobs. OAuth selection creates its job
  in the same transaction as the connection. The existing create worker claims
  a lease, retries interrupted execution, deduplicates content and records actual
  imported/skipped/failed counts. No unrelated provider import is initiated.
- AI guards fail closed; fact scoring reserves the existing monthly allowance.
  A blocked score falls back to 5 without a paid call. Preview uses its existing
  sample fallback when budget control fails. Provider changes are restricted to
  runtime-bound providers and validated with model-metadata requests before save.
- Setup nudge records freeze payload/idempotency key and mark sent only after
  acceptance. Rejections remain retryable. Ambiguous old sends require review
  after the provider idempotency window; no duplicate-send guarantee is invented.
- Weekly exports wait for completion and record failures as failures. Recovery
  setup creates a private project-owned bucket with 35-day lifecycle retention,
  grants the Firestore service agent bucket object access, enables the standard
  Firebase Storage service-agent role needed for cross-service deletion rules, enables PITR,
  performs a managed export, restores into a newly created disposable named
  database, checks stable configuration/account counts, then removes that test
  database. Default is never an import/restore/delete target. Customer data stays
  within the private project; review artifacts contain metadata only.

## Verification boundaries

Required: exact candidate regression suite, actual Firestore/Storage emulator
boundaries, actual recursive-delete and reactivation cases in the emulator,
full Engine security gate, live endpoint/release verification, live index probes
and completed isolated restore evidence. Mocked providers test injected failures;
they do not establish real Square charging, customer posts or email delivery.

No frontend workflows are redesigned. The backend still has 75 function owners.
The existing photo worker's retry policy needs explicit Engine acknowledgement.
The recovery workflow uses only the existing Main identity and Authorization
Engine; it does not introduce a second credential path or publish backups.
