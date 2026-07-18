# BlastyBiz — To-Do List (Pass 4 Maintainability Items)

These are not bugs. They are engineering debt items to action when time allows.
None of them block shipping.

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
