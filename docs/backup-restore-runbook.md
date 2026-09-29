# BlastyBiz recovery and deletion replay

Recovery drills are explicit Main operations. Normal releases keep `repairBackend: false` and `retireLegacy: false`. No recurring drill is enabled by this change.

## Dedicated backup identity

The scheduled export runs as `firestore-backup@blastybiz-9523e.iam.gserviceaccount.com`. Its custom role has export, database metadata, operation read, and entity get/create/update permissions. The entity permissions support the existing `backupRuns` progress journal. It has no import, entity deletion, or IAM administration permission. Firestore IAM permissions apply at the database level, not only to that journal. Firestore's service agent retains the existing private backup-bucket access.

An owner first runs `python3 scripts/configure-backup-identity.py --setup` while signed into the correct Google Cloud account. This creates the reviewed identity/role and grants the existing Engine deployment identity permission to attach only this service account. It does not remove the old runtime role or deploy code. Main runs `--check` before any deployment and stops if the prerequisite is missing.

After deployment, run backup verification. The backup worker makes a new export when the day's earlier completion belongs to the old shared runtime identity. The verifier checks the deployed function identity and waits for a completion recorded by the dedicated worker. Only after this succeeds should the owner run `python3 scripts/configure-backup-identity.py --remove-shared-role`. That command checks the deployed function and a fresh completed export before removing `roles/datastore.importExportAdmin` from `745597683278-compute@developer.gserviceaccount.com`. Other grants are preserved. Recheck project/inherited policies for any other broad role that could still confer import/export permission.

## Restore drill

Use the existing Authorization Engine Main recovery action only after an explicit drill request. The script never imports into `(default)`. Before exporting it captures exact aggregate counts for accounts, businesses, drafts and publishing jobs, plus hashes of the plan and pricing configuration. After import it compares the isolated restore against that baseline. Accounts and small groups must match exactly. Larger groups allow at most 1% drift, capped at two documents. This is an aggregate check, not proof of full document equality.

Successful temporary restores are deleted immediately. Failed copies are retained for diagnosis and become eligible for cleanup after seven days. At the start of the next explicit recovery run, only old, unprotected, same-project `bb-restore-check-<numeric run ID>` databases are removed after identity rechecking. There is no automatic seven-day timer; if no drill is run, an owner must arrange cleanup. Neither customer databases nor the current run's database are selected.

## Actual disaster recovery: prevent deleted accounts returning

1. Keep the application offline. Before restoring, preserve the latest production `accountDeletions` journal independently of the selected old export/PITR snapshot. Include completed deletions that occurred after that snapshot. An old backup's own journal is insufficient.
2. Restore into an isolated database and compare configuration, counts and representative document contents. Do not enable application access yet.
3. For every current journal entry marked `completed`, erase that UID's restored user tree (including descendants below missing parent documents), its owned business data, private platform credentials, saved copies, import jobs, OAuth nonces, pending actions and other user-owned collections. Reapply deletion to any restored Storage objects. Use an owner-reviewed administrative cleanup against the explicitly selected restore target; never reset the live tombstone to bypass checks.
4. The ordinary `purgeUserData` helper deliberately skips a completed journal entry. Calling it unchanged is **not** a deletion replay. The recovery operator must use a reviewed restore-target cleanup and confirm those UID-owned paths are absent. Preserve minimal completed tombstones so later imports and stale events cannot recreate the accounts. Keep required billing/webhook accounting ledgers restricted.
5. Verify current deletion requests and completed tombstones are present in the recovered system, verify erased accounts and tokens remain absent, then authorize cutover and application access. Do not recreate deleted Auth users from a database export.

Private export objects are scheduled for lifecycle deletion after 35 days. PITR is enabled with its configured retention window (up to seven days). Restore copies follow the drill cleanup process above. Privacy copy describes these recovery exceptions; it does not promise immediate erasure of immutable backups.

## Subscription plan changes

Existing paying customers are directed to support until an in-place subscription plan-change flow is reviewed and built. Do not create a second subscription and then cancel the first. A future implementation must confirm Square's effective change date, proration and webhook ordering from current official documentation and preserve existing subscription linkage rules.

References: https://docs.cloud.google.com/firestore/native/docs/security/iam and https://developer.squareup.com/reference/square/objects/Subscription
