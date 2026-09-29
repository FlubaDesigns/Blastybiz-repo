# Pass 10 corrections and release

All six findings in BlastyBiz-Pass10-Review.zip were confirmed against the candidate source.

- P10-1: config/blasty now permits public reads and retains admin-only writes. No customer records are exposed.
- P10-2: the main Schedule tab uses a schedule-only bridge, writing schedule and updatedAt without changing creative revision. Frozen packet rules remain strict.
- P10-3: server ignores reviewed. Creative-input changes invalidate unchanged platform copy; a platform's changed copy may retain explicit same-save approval. Browser review status refreshes from the server response. The same guard covers This Run Only overrides.
- P10-4: dismissing failed uploads makes no Storage delete call and produces no false stored-file warning. Account deletion remains responsible for storage cleanup.
- P10-5: list performs authorized ordinary reads without a transaction; packet counts use a single pass over campaign runs. Writes stay transactional. Events retain only the newest 200 entries.
- P10-6: unchanged retries retain their Blast identity; changed override values get a new identity and the latest copy.

Includes every previously verified P9-1 through P9-5 correction. These are corrections to the existing passes, not a new pass.

Validation: isolated actual-service tests cover stale approvals, per-platform exceptions, later reapproval, This Run Only bypass prevention, event retention, nontransactional listing and the schedule bridge. DOM tests execute changed/unchanged failed-override retries. Existing photo dismissal tests now verify no storage delete/warning. All earlier suites are retained. Rules visibility is checked structurally; no full rules emulator or authenticated customer browser session was available.

Release workflow uses existing Firebase authorization. Rules/indexes precede backend; the platform migration previews then applies only non-publishing changes; Hosting follows. Historical packets/copy are preserved. Live release markers now test the canonical setup redirects rather than the retired forms. V11–V18 remain outside this release.
