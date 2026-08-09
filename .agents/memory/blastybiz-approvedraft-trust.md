
## The draft is authoritative for WHICH platforms publish

`platformKeys` from the client is a *filter*, never a source of truth. The eligible set
is derived from the draft doc: a platform publishes only if it has non-empty generated
copy, and — when the draft carries a per-platform status map — only if that map marks it
approved. A requested platform that is excluded, ungenerated or simply invented must not
produce a job.

**Why:** without this, a caller could name any platform and get a job created with empty
content, which for the auto-posting platforms would actually be dispatched. Approval is
also made idempotent (an already-approved draft is rejected) so a double-click or a
replayed request cannot queue a second full set of jobs.

**How to apply:** drafts written before the status map existed have no map — treat a
missing map as "all generated platforms are eligible" so old drafts still publish.

## Approval must be a transactional claim, not check-then-write

Reading the draft, seeing `status !== 'approved'`, and then committing a batch is
NOT idempotent. Two requests that arrive together both read the draft as
unapproved and both commit, so the owner's ad goes out twice. The status check,
the status write, and the publish-job creation all have to happen inside a single
`db.runTransaction`.

**Why:** a double-click or a retried request is the normal case here, not an edge
case — the Send It button fires a network call and users click it again when it
feels slow.

**How to apply:** inside the transaction, `tx.get` the draft, throw a sentinel
error for the already-approved / nothing-eligible / not-yours cases, and map those
sentinels to 409 / 400 / 403 in the catch outside. Never dispatch jobs before the
claim commits.
