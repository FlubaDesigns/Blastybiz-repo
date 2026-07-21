# BlastyBiz — To-Do List (Pass 4 Maintainability Items)

These are not bugs. They are engineering debt items to action when time allows.
None of them block shipping.

## HIGH — Admin step editor: single editable field per step (no default/override split)
Each step card in the admin currently shows a read-only "default" label plus a separate override input — two parallel sources of truth. Replace with one editable text field per step. On first load, pre-fill with the hardcoded JS default as a starting point. On save, that text becomes the truth written to Firestore. The JS hardcoded message becomes a last-resort fallback only (first paint before Firestore loads). Eventually: pull all step text out of JS entirely and load from Firestore at start.
Applies to both OB1 (BlastyBiz-Admin-OnboardSteps.html OB1 tab) and OB2 (OB2 tab).

## HIGH — Shared service modules
Do this alongside the BlastyBiz.html modularization (full-site handoff, Finding 17).
Create four thin service modules that every page imports:
- `aiAdaptationService` — wraps adaptListing / regeneration CF calls
- `publishingService` — wraps approveDraft CF + status polling
- `storageService` — photo/document upload (currently duplicated between wizard and Business Context)
- `notificationService` — toasts + email-trigger calls

Every page should call a service, never a raw fetch/Firestore call directly for these four concerns.

## MEDIUM — Naming convention document
Write a one-page doc covering:
- kebab-case for HTML IDs and CSS classes
- camelCase for functions and variables
- single leading-underscore for module-private state only
Apply going forward as files are touched — no big-bang rename sweep.

## LOW — Architecture & data model doc
Write after the canonical listingDraft schema is stable (Pass 2 Phase A is done).
Cover: listingDrafts, platformConnections, campaigns collections; allowed platform sub-states;
state-transition diagram from blast creation through publish.
