# Pass 09 corrections — BB09R

Verified against BB09 source before changing code. This is a correction to Pass 09, not a new numbered pass. Main and production have not been changed by this review task.

| Finding | Verification and correction |
| --- | --- |
| P9-1 | Confirmed: photoCap returned Infinity and handleImages accepted the whole batch. Restored 20 photos for each campaign/global-library view on every plan, clear capacity feedback, and reservations to prevent overlapping picker batches exceeding the limit. Existing over-cap libraries are not deleted; removal creates room. This restores the uploader capacity check, not a new server storage-quota system. |
| P9-2 | Confirmed stale Free/Pro/Agency wording on the AI help page. Replaced with every-plan access and capacity/AI-budget differences. |
| P9-3 | Confirmed old pending plan-held jobs could remain upgrade-blocked. Extended the existing config migration, dry-run by default, to identify those jobs and transactionally make them manual_required with Action needed and copy-ready wording. No publisher call or replay; existing payload, attempts and history remain intact. |
| P9-4 | Confirmed default welcome emails and onboarding defaults embedded 3/10. Email trigger now reads getPlanConfig().bizLimits. Login and admin default messages omit fixed counts. Custom saved templates/messages remain untouched. Added businessCreatedTrigger to deployment targets. |
| P9-5 | Confirmed prior suitability guidance disappeared from the suggestion prompt. Restored it to each canonical platform record and regenerated the identical browser source; the prompt now uses those records. Removed the old subjective Instagram wording. Pinterest uses its existing visual-purpose guidance. No delivery claims or second scoring system added. |
| Smaller copy item | Pro card now leads with its AI budget and business capacity; shared auto-posting appears afterward. |

## Migration

Deploy the included planGated collection-group index before running the migration. Existing config migration CLI remains:

```
node scripts/migrate-platform-config.cjs --project=blastybiz-9523e
node scripts/migrate-platform-config.cjs --project=blastybiz-9523e --apply
```

The first command lists config changes and exact eligible job paths without writes. The second applies config changes atomically and rechecks each job in its own transaction. Interrupted runs may be rerun safely; the whole multi-page migration is not one transaction. Only planGated=true, status=pending jobs are converted. Completed, failed and ungated jobs are excluded. No live migration was run for this candidate.

## Validation

All existing Pass 09-era regression suites pass, plus 35 correction assertions. Actual uploader code tests cover 21 files, overlapping selections, all plans and both scopes. Migration tests cover 205 jobs across pages, dry-run/no changes, exact payload/history preservation, safe rerun, failed transactions and concurrent status changes. Actual welcome trigger runs with edited limits 7/22 in isolated fixtures; outgoing email is mocked. Actual suggestion prompt includes Angi and LinkedIn suitability.

Platform/source synchronization, release checks (live endpoint probe skipped) and whitespace validation pass. See validation.json / VALIDATION.txt. No live AI call, customer email, live publishing, migration or authenticated mobile test was performed; model suggestions are not claimed deterministic. The unresolved recurring-Refire plan policy remains unchanged.

The same confirmed corrections are carried into BB10R. Pass 10's shared guidance defaults receive the same number-free wording. The BB10R package is still a Pass 10 review candidate, with its prior browser/production acceptance limits.
