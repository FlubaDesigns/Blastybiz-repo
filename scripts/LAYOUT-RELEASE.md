# Pre-beta layout releases

Dave authorized a focused route for the current pre-beta layout work. Batch related layout requests into one release. Use the existing Authorization Engine and Main environment; do not create another deployment identity or publish social content.

The source gate automatically selects layout checks only for modified CSS/bitmap assets and presentation-only HTML whose scripts, handlers, URLs, IDs and form/control attributes remain unchanged. Account, admin, payment and onboarding pages, JavaScript behavior, backend, rules, dependencies, workflow changes and unknown changes use the full gate. Missing history also uses the full gate.

For a layout candidate, run the classifier tests, shared header/business-selector browser checks and publishing/workspace mobile checks. Preserve the exact source SHA and `layout-scope.json` evidence. Do not repeat successful checks on unchanged source.

After the exact Main source gate passes, submit the existing `deploy-hosting` descriptor with no functions, repairs or retirement. A descriptor-only Fluba change verifies the source gate and live Hosting baseline without rebuilding unrelated Fluba applications. Mixed changes use full CI. Production still verifies current Main, the live baseline, both release markers and the live phone layout. Report fixture checks separately from signed-in live actions.
